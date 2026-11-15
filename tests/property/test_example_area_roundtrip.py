# Feature: harmonized-fire-calendar, Property 53: Example-area config round trip and validation
"""Property 53: for any valid list of 3 to 5 example areas, loading the config and reading
`/api/v1/meta` returns the same names, descriptions and geometries in the same order. A list
with a defect (count outside 3 to 5, blank or long name, long description, open or
self-intersecting ring, outside the extent) is rejected with the entry position and field.

**Validates: Requirements 1.9, 1.10, 1.12**

Each round-trip example builds a FastAPI app (config load, DuckDB store) on a small synthetic
fixture folder (TEST FIXTURE, not NASA data) and calls `/meta` through `TestClient`. The
fixture folder is written once per module, so an example costs only the app build.
"""

from __future__ import annotations

import copy
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient
from hypothesis import given, settings
from hypothesis import strategies as st

from hotspots.api.main import create_app
from hotspots.config import (
    EXAMPLE_AREAS_MAX,
    EXAMPLE_AREAS_MIN,
    EXAMPLE_DESCRIPTION_MAX_LEN,
    EXAMPLE_NAME_MAX_LEN,
    AppConfig,
    ConfigErrors,
    validate_config,
)
from tests.fixtures import write_fixture_dir
from tests.property.strategies.config import RawConfig, app_configs, example_area

DEFECTS = (
    "too_few",
    "too_many",
    "name_blank",
    "name_long",
    "description_long",
    "open_ring",
    "self_intersecting",
    "outside_extent",
)


@pytest.fixture(scope="module")
def data_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return write_fixture_dir(tmp_path_factory.mktemp("example_area_fixture"))


@pytest.fixture(scope="module")
def yaml_path(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return tmp_path_factory.mktemp("example_area_yaml") / "app.yaml"


@st.composite
def configs_with_examples(draw: st.DrawFn, data_dir: Path) -> RawConfig:
    """A valid raw config whose `example_areas` holds 3 to 5 valid areas inside the extent."""
    cfg = draw(app_configs(data_dir))
    extent = cfg["region"]["extent"]
    cfg["example_areas"] = draw(
        st.lists(example_area(extent), min_size=EXAMPLE_AREAS_MIN, max_size=EXAMPLE_AREAS_MAX)
    )
    return cfg


def _apply_defect(cfg: RawConfig, kind: str, index: int, extra: int) -> str:
    """Inject one defect into `cfg["example_areas"]`. Returns the field it must be reported at."""
    areas: list[dict[str, Any]] = cfg["example_areas"]
    area = areas[index]
    if kind == "too_few":
        del areas[extra % EXAMPLE_AREAS_MIN :]  # 0 to 2 entries left
        return "example_areas"
    if kind == "too_many":
        while len(areas) <= EXAMPLE_AREAS_MAX + extra % 3:  # 6 to 8 entries
            areas.append(copy.deepcopy(areas[0]))
        return "example_areas"
    if kind == "name_blank":
        area["name"] = " " * (extra % 4)
        return f"example_areas[{index}].name"
    if kind == "name_long":
        area["name"] = "n" * (EXAMPLE_NAME_MAX_LEN + 1 + extra)
        return f"example_areas[{index}].name"
    if kind == "description_long":
        area["description"] = "d" * (EXAMPLE_DESCRIPTION_MAX_LEN + 1 + extra)
        return f"example_areas[{index}].description"
    ring = area["geometry"]["coordinates"][0]
    (west, south), (east, _), (_, north) = ring[0], ring[1], ring[2]
    if kind == "open_ring":
        area["geometry"]["coordinates"] = [ring[:-1]]
    elif kind == "self_intersecting":  # bow-tie over the same rectangle, still inside the extent
        bowtie = [[west, south], [east, north], [east, south], [west, north], [west, south]]
        area["geometry"]["coordinates"] = [bowtie]
    else:  # outside_extent: a small closed triangle 0.5 degree west of the region
        w = cfg["region"]["extent"]["west"] - 0.5
        triangle = [[w, south], [w + 0.4, south], [w + 0.4, south + 0.1], [w, south]]
        area["geometry"]["coordinates"] = [triangle]
    return f"example_areas[{index}].geometry"


@settings(max_examples=100)
@given(data=st.data())
def test_example_areas_round_trip_through_meta(
    data: st.DataObject, data_dir: Path, yaml_path: Path
) -> None:
    cfg = data.draw(configs_with_examples(data_dir))
    # Random record starts or excluded cells could remove every fixture row, and `/meta`
    # answers 503 without data. These keys do not affect example areas, so use their defaults.
    for key in ("record_start", "baseline", "excluded_cells"):
        cfg.pop(key, None)
    configured = cfg["example_areas"]
    assert EXAMPLE_AREAS_MIN <= len(configured) <= EXAMPLE_AREAS_MAX

    validated = validate_config(cfg)
    assert isinstance(validated, AppConfig), validated
    assert [a.name for a in validated.example_areas] == [a["name"] for a in configured]

    yaml_path.write_text(yaml.safe_dump(cfg), encoding="utf-8")
    with TestClient(create_app(yaml_path)) as client:
        response = client.get("/api/v1/meta")
    assert response.status_code == 200
    returned = response.json()["example_areas"]

    assert len(returned) == len(configured)
    for got, want in zip(returned, configured, strict=True):
        assert got["name"] == want["name"].strip()
        assert got["description"] == want["description"]
        assert got["geometry"] == want["geometry"]


@given(data=st.data())
def test_invalid_example_areas_are_rejected_with_position_and_field(
    data: st.DataObject, data_dir: Path
) -> None:
    cfg = data.draw(configs_with_examples(data_dir))
    kind = data.draw(st.sampled_from(DEFECTS))
    index = data.draw(st.integers(0, len(cfg["example_areas"]) - 1))
    extra = data.draw(st.integers(0, 40))
    expected_field = _apply_defect(cfg, kind, index, extra)

    result = validate_config(cfg)

    assert isinstance(result, ConfigErrors), kind
    assert [e.field for e in result.errors] == [expected_field], kind
    assert all(e.reason.strip() for e in result.errors)

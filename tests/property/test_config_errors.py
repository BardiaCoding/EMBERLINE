# Feature: harmonized-fire-calendar, Property 1: Configuration reports every invalid field
"""Property 1: for a valid config with a set E of injected defects, validation reports errors
for exactly the fields in E (each with a reason) when E is not empty, and returns a config
when E is empty. No data file is opened before validation finishes.

**Validates: Requirements 1.2, 1.5, 1.6, 1.8, 1.10**

Data files are synthetic fixtures (TEST FIXTURE, not NASA data).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
import yaml
from hypothesis import given
from hypothesis import strategies as st

from hotspots.config import (
    DETECTIONS_FILENAME,
    GRID_FILENAME,
    AppConfig,
    ConfigErrors,
    load_config,
    validate_config,
)
from tests.fixtures import write_fixture_dir
from tests.property.strategies.config import app_configs, catalogue, mutations


@pytest.fixture(scope="module")
def data_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return write_fixture_dir(tmp_path_factory.mktemp("config_fixture"))


@pytest.fixture(scope="module")
def empty_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return tmp_path_factory.mktemp("config_empty")


@pytest.fixture(scope="module")
def yaml_path(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return tmp_path_factory.mktemp("config_yaml") / "app.yaml"


@given(data=st.data())
def test_configuration_reports_every_invalid_field(
    data: st.DataObject, data_dir: Path, empty_dir: Path, yaml_path: Path
) -> None:
    cfg = data.draw(app_configs(data_dir))
    chosen = data.draw(mutations(empty_dir=empty_dir))
    applied = [m for m in chosen if m.applicable(cfg)]
    for mutation in applied:
        mutation.apply(cfg)
    expected = {f for m in applied for f in m.fields}

    result = validate_config(cfg)
    yaml_path.write_text(yaml.safe_dump(cfg), encoding="utf-8")
    loaded = load_config(yaml_path)

    if not expected:
        assert isinstance(result, AppConfig), (
            result.format() if isinstance(result, ConfigErrors) else result
        )
        assert loaded == result
        return

    assert isinstance(result, ConfigErrors), [m.name for m in applied]
    assert {e.field for e in result.errors} == expected, [m.name for m in applied]
    assert all(e.reason.strip() for e in result.errors)
    assert isinstance(loaded, ConfigErrors)
    assert loaded.as_pairs() == result.as_pairs()


def test_catalogue_names_are_unique(empty_dir: Path) -> None:
    names = [m.name for m in catalogue(empty_dir)]
    assert len(names) == len(set(names))


def test_valid_config_is_accepted_without_opening_data_files(tmp_path: Path) -> None:
    """Both files exist but are not Parquet: validation only checks that they exist."""
    (tmp_path / GRID_FILENAME).write_bytes(b"not parquet")
    (tmp_path / DETECTIONS_FILENAME).write_bytes(b"not parquet")
    cfg: dict[str, Any] = {
        "region": {
            "name": "California region",
            "extent": {"west": -124.4, "south": 32.5, "east": -114.0, "north": 42.2},
        },
        "data_dir": str(tmp_path),
    }
    assert isinstance(validate_config(cfg), AppConfig)


def test_outside_extent_reported_when_only_region_name_is_invalid(data_dir: Path) -> None:
    ring = [[-130.0, 33.0], [-129.0, 33.0], [-129.0, 34.0], [-130.0, 33.0]]
    area = {
        "name": "Outside",
        "description": "",
        "geometry": {"type": "Polygon", "coordinates": [ring]},
    }
    cfg: dict[str, Any] = {
        "region": {
            "name": "  ",
            "extent": {"west": -124.4, "south": 32.5, "east": -114.0, "north": 42.2},
        },
        "data_dir": str(data_dir),
        "example_areas": [area, area, area],
    }
    result = validate_config(cfg)
    assert isinstance(result, ConfigErrors)
    fields = {e.field for e in result.errors}
    assert fields == {
        "region.name",
        "example_areas[0].geometry",
        "example_areas[1].geometry",
        "example_areas[2].geometry",
    }

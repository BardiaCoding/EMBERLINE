"""The shipped `config/app.yaml` defines the four default example areas (Requirement 1.11).

The shipped `data_dir` may not exist where tests run, so the data folder is swapped for a
synthetic fixture folder. TEST FIXTURE, not NASA data.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from hotspots.config import (
    EXAMPLE_DESCRIPTION_MAX_LEN,
    AppConfig,
    ConfigErrors,
    validate_config,
)
from tests.fixtures import write_fixture_dir

SHIPPED_CONFIG = Path(__file__).resolve().parents[2] / "config" / "app.yaml"

EXPECTED_NAMES = (
    "Central Valley farmland",
    "Sierra Nevada forest",
    "Southern California chaparral",
    "North Coast and Klamath",
)


def _raw_shipped(tmp_path: Path) -> dict[str, Any]:
    raw = yaml.safe_load(SHIPPED_CONFIG.read_text(encoding="utf-8"))
    raw["data_dir"] = str(write_fixture_dir(tmp_path))
    return raw


def test_shipped_config_has_four_valid_example_areas(tmp_path: Path) -> None:
    result = validate_config(_raw_shipped(tmp_path))
    assert isinstance(result, AppConfig), (
        result.format() if isinstance(result, ConfigErrors) else result
    )
    areas = result.example_areas
    assert tuple(a.name for a in areas) == EXPECTED_NAMES
    for area in areas:
        assert 0 < len(area.description) <= EXAMPLE_DESCRIPTION_MAX_LEN
        assert area.geometry["type"] == "Polygon"
        ring = area.geometry["coordinates"][0]
        assert ring[0] == ring[-1]


def test_shipped_polygons_match_requirements_table(tmp_path: Path) -> None:
    result = validate_config(_raw_shipped(tmp_path))
    assert isinstance(result, AppConfig)
    rings = {a.name: a.geometry["coordinates"][0] for a in result.example_areas}
    assert rings["Sierra Nevada forest"] == [
        [-121.0, 39.6],
        [-120.0, 39.6],
        [-118.3, 36.2],
        [-119.2, 36.2],
        [-121.0, 39.6],
    ]
    assert len(rings["Central Valley farmland"]) == 7
    assert len(rings["Southern California chaparral"]) == 5
    assert len(rings["North Coast and Klamath"]) == 5


def test_shipped_example_areas_are_marked_default_and_unverified() -> None:
    text = SHIPPED_CONFIG.read_text(encoding="utf-8")
    block = text[text.index("example_areas:") - 600 :]
    assert block.count("DEFAULT (confirm)") >= 5
    assert "unverified" in block

"""Unit tests for example areas and the watch threshold in `/api/v1/meta` (task 9.5).

Requirements 1.12 and 11.16. Data are synthetic (`tests/fixtures.py`, TEST FIXTURE, not NASA
data). The example areas come from the shipped `config/app.yaml`.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from fastapi.testclient import TestClient

from hotspots.api.main import create_app
from tests.fixtures import write_fixture_dir

SHIPPED_CONFIG = Path(__file__).resolve().parents[2] / "config" / "app.yaml"

EXPECTED_NAMES = [
    "Central Valley farmland",
    "Sierra Nevada forest",
    "Southern California chaparral",
    "North Coast and Klamath",
]


def _shipped_raw() -> dict[str, Any]:
    raw = yaml.safe_load(SHIPPED_CONFIG.read_text(encoding="utf-8"))
    assert isinstance(raw, dict)
    return raw


def _get_meta(tmp_path: Path, raw: dict[str, Any]) -> dict[str, Any]:
    raw["data_dir"] = str(write_fixture_dir(tmp_path))
    config_path = tmp_path / "app.yaml"
    config_path.write_text(yaml.safe_dump(raw), encoding="utf-8")
    with TestClient(create_app(config_path)) as client:
        response = client.get("/api/v1/meta")
    assert response.status_code == 200
    body: dict[str, Any] = response.json()
    return body


def test_meta_returns_the_four_shipped_example_areas_in_config_order(tmp_path: Path) -> None:
    shipped = _shipped_raw()["example_areas"]
    areas = _get_meta(tmp_path, _shipped_raw())["example_areas"]

    assert [a["name"] for a in areas] == EXPECTED_NAMES
    assert len(areas) == len(shipped) == 4
    for returned, configured in zip(areas, shipped, strict=True):
        assert returned["name"] == configured["name"]
        assert returned["description"] == configured["description"]
        assert returned["description"]
        assert returned["geometry"] == configured["geometry"]
        assert returned["geometry"]["type"] == "Polygon"


def test_meta_example_areas_empty_when_key_is_null(tmp_path: Path) -> None:
    raw = _shipped_raw()
    raw["example_areas"] = None
    assert _get_meta(tmp_path, raw)["example_areas"] == []


def test_meta_example_areas_empty_when_key_is_absent(tmp_path: Path) -> None:
    raw = _shipped_raw()
    del raw["example_areas"]
    assert _get_meta(tmp_path, raw)["example_areas"] == []


def test_meta_watch_threshold_from_shipped_config(tmp_path: Path) -> None:
    body = _get_meta(tmp_path, _shipped_raw())
    assert body["watch_threshold"] == _shipped_raw()["watch_threshold"] == 90


def test_meta_watch_threshold_follows_config_override(tmp_path: Path) -> None:
    raw = _shipped_raw()
    raw["watch_threshold"] = 82.5
    assert _get_meta(tmp_path, raw)["watch_threshold"] == 82.5

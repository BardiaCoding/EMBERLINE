"""Unit tests for `POST /api/v1/map-layer` (task 22.3, Requirement 11.5).

Data are synthetic (`tests/fixtures.py`, TEST FIXTURE, not NASA data).
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient

from hotspots.api.main import create_app
from hotspots.api.routes import map as map_route
from tests.fixtures import default_grid_rows, make_detection_row, write_fixture_dir

PROJECT_CONFIG = Path(__file__).resolve().parents[2] / "config" / "app.yaml"
URL = "/api/v1/map-layer"
FULL_RANGE = {"start": "2000-01-01", "end": "2026-12-31"}


def _rect(west: float, south: float, east: float, north: float) -> dict[str, Any]:
    return {
        "type": "Polygon",
        "coordinates": [
            [[west, south], [east, south], [east, north], [west, north], [west, south]]
        ],
    }


def _det(lat: float, lon: float, day: int, month: int = 7) -> dict[str, Any]:
    return make_detection_row(lat, lon, datetime(2020, month, day, 20, 30, 5))


def _rows() -> list[dict[str, Any]]:
    rows = [
        _det(34.5, -118.5, 10),
        _det(34.6, -118.6, 11),
        _det(34.7, -118.7, 12, month=8),
        _det(36.0, -118.5, 10),  # outside the test area
        # 2020-07-31 21:00 UTC is local 2020-07-31 13:00; 2020-08-01 07:00 UTC is local 07-31 23:00
        make_detection_row(34.8, -118.8, datetime(2020, 8, 1, 7, 0, 0)),
    ]
    return sorted(rows, key=lambda r: (r["acq_date_local"], r["acq_datetime_utc"]))


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    data_dir = write_fixture_dir(tmp_path, detections_rows=_rows())
    raw = yaml.safe_load(PROJECT_CONFIG.read_text(encoding="utf-8"))
    raw["data_dir"] = str(data_dir)
    cfg = tmp_path / "app.yaml"
    cfg.write_text(yaml.safe_dump(raw), encoding="utf-8")
    with TestClient(create_app(cfg)) as c:
        yield c


AREA = _rect(-119.0, 34.0, -118.0, 35.0)


def test_points_mode_returns_filtered_raw_detections(client: TestClient) -> None:
    body = client.post(URL, json={**FULL_RANGE, "geometry": AREA}).json()
    assert body["mode"] == "points"
    assert body["total"] == 4 == len(body["points"])
    assert body["cells"] == []
    assert body["label"] == "Filtered raw detections, not harmonized"
    assert "UTC-8" in body["time_convention"]
    point = body["points"][0]
    assert set(point) == {"lat", "lon", "satellite", "local_date", "frp"}
    assert point["satellite"] == "SNPP"


def test_local_dates_use_utc_minus_8(client: TestClient) -> None:
    body = client.post(URL, json={**FULL_RANGE, "geometry": AREA}).json()
    by_lat = {p["lat"]: p["local_date"] for p in body["points"]}
    assert by_lat[34.8] == "2020-07-31"  # 2020-08-01 07:00 UTC


def test_month_narrows_the_range(client: TestClient) -> None:
    body = client.post(URL, json={**FULL_RANGE, "geometry": AREA, "month": "2020-08"}).json()
    assert body["total"] == 1
    assert body["month"] == "2020-08"


def test_month_outside_range_is_empty(client: TestClient) -> None:
    body = client.post(
        URL, json={"start": "2020-07-01", "end": "2020-07-31", "month": "2021-01"}
    ).json()
    assert body["mode"] == "points"
    assert body["total"] == 0


def test_full_region_when_no_geometry(client: TestClient) -> None:
    body = client.post(URL, json=FULL_RANGE).json()
    assert body["total"] == 5


def test_density_mode_above_the_cap(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(map_route, "MAX_MAP_POINTS", 2)
    body = client.post(URL, json={**FULL_RANGE, "geometry": AREA}).json()
    assert body["mode"] == "density"
    assert body["total"] == 4
    assert body["points"] == []
    assert body["max_points"] == 2
    cell = next(c for c in body["cells"] if c["raw_modis"] > 0)
    assert cell["count"] == cell["raw_modis"] + cell["raw_viirs"]
    # Fixture cells A and B (lat 34.0 and 34.1, lon -118.1) have centres inside AREA.
    assert {round(c["lat"], 2) for c in body["cells"]} <= {34.05, 34.15}
    expected = sum(
        r["count_raw_modis"] + r["count_raw_viirs"]
        for r in default_grid_rows()
        if r["cell_id"] in {"34.0000_-118.1000", "34.1000_-118.1000"}
        and (r["year"], r["month"]) >= (2000, 11)
    )
    assert sum(c["count"] for c in body["cells"]) == expected


def test_density_month_filter(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(map_route, "MAX_MAP_POINTS", 1)
    body = client.post(URL, json={**FULL_RANGE, "geometry": AREA, "month": "2012-07"}).json()
    assert body["mode"] == "points"  # no detections in 2012-07 for this fixture
    assert body["total"] == 0


def test_invalid_inputs(client: TestClient) -> None:
    assert client.post(URL, json={**FULL_RANGE, "month": "2020-13"}).status_code == 422
    assert client.post(URL, json={"start": "2020-02-01", "end": "2020-01-01"}).status_code == 422
    far = _rect(10.0, 10.0, 11.0, 11.0)
    resp = client.post(URL, json={**FULL_RANGE, "geometry": far})
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "outside_coverage"

"""Unit tests for `POST /api/v1/export/hotspots/estimate` (task 19.27).

Requirements 17.6, 17.9, 17.10, 17.11, 17.13. Data are synthetic (`tests/fixtures.py`,
TEST FIXTURE, not NASA data).
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from hotspots.api.main import create_app
from hotspots.api.routes import export as export_route
from hotspots.export import hotspots_csv
from tests.fixtures import make_detection_row, write_fixture_dir

PROJECT_CONFIG = Path(__file__).resolve().parents[2] / "config" / "app.yaml"
ESTIMATE_URL = "/api/v1/export/hotspots/estimate"
EXPORT_URL = "/api/v1/export/hotspots"
FULL_RANGE = {"start": "2000-01-01", "end": "2026-12-31"}
AVG_BYTES = 100.0


def _rect(west: float, south: float, east: float, north: float) -> dict[str, Any]:
    return {
        "type": "Polygon",
        "coordinates": [
            [[west, south], [east, south], [east, north], [west, north], [west, south]]
        ],
    }


AREA = _rect(-119.0, 34.0, -118.0, 35.0)


def _det(lat: float, lon: float, day: int = 10) -> dict[str, Any]:
    return make_detection_row(lat, lon, datetime(2020, 7, day, 20, 30, 5))


def _rows() -> list[dict[str, Any]]:
    """Four detections inside AREA (west edge counts, east edge does not), two outside."""
    rows = [
        _det(34.5, -118.5),
        _det(34.5, -119.0),  # west edge: included
        _det(34.5, -118.0),  # east edge: excluded
        _det(36.0, -118.5),  # outside
        _det(34.6, -118.6, day=20),
        _det(34.7, -118.7, day=11),
    ]
    return sorted(rows, key=lambda r: (r["acq_date_local"], r["acq_datetime_utc"]))


def _config(tmp_path: Path, data_dir: Path, **overrides: Any) -> Path:
    raw = yaml.safe_load(PROJECT_CONFIG.read_text(encoding="utf-8"))
    raw["data_dir"] = str(data_dir)
    raw["csv_avg_bytes_per_row"] = AVG_BYTES
    raw.update(overrides)
    path = tmp_path / "app.yaml"
    path.write_text(yaml.safe_dump(raw), encoding="utf-8")
    return path


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    data_dir = write_fixture_dir(tmp_path, detections_rows=_rows())
    with TestClient(create_app(_config(tmp_path, data_dir))) as c:
        yield c


def _body(geometry: dict[str, Any] | None = AREA, **extra: Any) -> dict[str, Any]:
    body: dict[str, Any] = {**FULL_RANGE, **extra}
    if geometry is not None:
        body["geometry"] = geometry
    return body


def _exported_rows(client: TestClient, body: dict[str, Any]) -> int:
    text = client.post(EXPORT_URL, json=body).text
    footer = next(ln for ln in text.split("\n") if ln.startswith("# rows:"))
    return int(footer.removeprefix("# rows:"))


def test_estimate_equals_exported_rows(client: TestClient) -> None:
    body = _body()
    response = client.post(ESTIMATE_URL, json=body)
    assert response.status_code == 200
    data = response.json()
    assert data["rows"] == _exported_rows(client, body) == 4
    assert data["over_limit"] is False
    assert data["limit"] == 2_000_000


def test_estimate_matches_export_for_full_region_and_date_range(client: TestClient) -> None:
    for body in (
        _body(None),
        _body(start="2020-07-10", end="2020-07-10"),
        _body(None, start="2001-01-01", end="2001-01-31"),
    ):
        rows = client.post(ESTIMATE_URL, json=body).json()["rows"]
        assert rows == _exported_rows(client, body)


def test_approx_bytes_is_rows_times_average_plus_header(client: TestClient) -> None:
    body = _body()
    data = client.post(ESTIMATE_URL, json=body).json()
    header_part = data["approx_bytes"] - data["rows"] * AVG_BYTES
    # The header part is the real comment block, the column row and a footer at limit width.
    lines = client.post(EXPORT_URL, json=body).text.split("\n")
    column_row = next(i for i, ln in enumerate(lines) if ln.startswith("sensor_family"))
    head_bytes = len("\n".join(lines[: column_row + 1]).encode("utf-8")) + 1
    footer_bytes = len(f"# rows: {hotspots_csv.MAX_EXPORT_ROWS}\n")
    assert header_part == head_bytes + footer_bytes


def test_over_limit_flag_and_export_agree(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(hotspots_csv, "MAX_EXPORT_ROWS", 3)
    data = client.post(ESTIMATE_URL, json=_body()).json()
    assert data["rows"] == 4 and data["over_limit"] is True and data["limit"] == 3
    assert client.post(EXPORT_URL, json=_body()).status_code == 422

    monkeypatch.setattr(hotspots_csv, "MAX_EXPORT_ROWS", 4)
    data = client.post(ESTIMATE_URL, json=_body()).json()
    assert data["rows"] == 4 and data["over_limit"] is False
    assert client.post(EXPORT_URL, json=_body()).status_code == 200


def test_zero_average_uses_the_measured_fallback(tmp_path: Path) -> None:
    data_dir = write_fixture_dir(tmp_path, detections_rows=_rows())
    config = _config(tmp_path, data_dir, csv_avg_bytes_per_row=0)
    with TestClient(create_app(config)) as c:
        data = c.post(ESTIMATE_URL, json=_body()).json()
    fallback = export_route.FALLBACK_CSV_AVG_BYTES_PER_ROW
    assert fallback > 0
    assert data["approx_bytes"] > data["rows"] * fallback


def test_invalid_geometry_is_422(client: TestClient) -> None:
    bowtie = {
        "type": "Polygon",
        "coordinates": [[[-119, 34], [-118, 35], [-118, 34], [-119, 35], [-119, 34]]],
    }
    response = client.post(ESTIMATE_URL, json=_body(bowtie))
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_geometry"


def test_end_before_start_is_422(client: TestClient) -> None:
    response = client.post(ESTIMATE_URL, json=_body(start="2020-07-10", end="2020-07-09"))
    assert response.status_code == 422


@settings(max_examples=20, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(
    west=st.floats(-119.5, -118.5),
    width=st.floats(0.1, 1.0),
    day=st.integers(1, 28),
)
def test_estimate_rows_equal_export_rows_for_random_boxes(
    client: TestClient, west: float, width: float, day: int
) -> None:
    body = _body(
        _rect(west, 33.9, west + width, 35.1),
        start=f"2020-07-{day:02d}",
        end="2020-07-28",
    )
    assert client.post(ESTIMATE_URL, json=body).json()["rows"] == _exported_rows(client, body)

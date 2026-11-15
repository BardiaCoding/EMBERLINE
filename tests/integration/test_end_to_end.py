"""End-to-end integration test on synthetic fixtures (task 20.1).

TEST FIXTURE, not NASA data. `tests/fixtures.py` writes the Parquet files into `tmp_path`, the
config points at them, and the real app (`create_app`) answers through `TestClient`. No network
and no delivered data. Requirements 30.4, 31.3, 31.6.
"""

from __future__ import annotations

import csv
import io
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient

from tests.fixtures import FIXTURE_DIRNAME, FIXTURE_LABEL, write_fixture_dir

PROJECT_CONFIG = Path(__file__).resolve().parents[2] / "config" / "app.yaml"
RANGE = {"start": "2000-01-01", "end": "2026-12-31"}
TOLERANCE = 1e-6


def _box(west: float, south: float, east: float, north: float) -> dict[str, Any]:
    ring = [[west, south], [east, south], [east, north], [west, north], [west, south]]
    return {"type": "Polygon", "coordinates": [ring]}


FULL_EXTENT = _box(-124.4, 32.5, -114.0, 42.2)
# Cell centres sit at x.x5, so a split at -119.0 touches no centre.
WEST_HALF = _box(-124.4, 32.5, -119.0, 42.2)
EAST_HALF = _box(-119.0, 32.5, -114.0, 42.2)


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    from hotspots.api.main import create_app

    data_dir = write_fixture_dir(tmp_path)
    assert data_dir.name == FIXTURE_DIRNAME
    raw = yaml.safe_load(PROJECT_CONFIG.read_text(encoding="utf-8"))
    raw["data_dir"] = str(data_dir)
    config_path = tmp_path / "app.yaml"
    config_path.write_text(yaml.safe_dump(raw), encoding="utf-8")
    with TestClient(create_app(config_path)) as test_client:
        yield test_client


def _calendar(client: TestClient, geometry: dict[str, Any] | None) -> dict[str, Any]:
    response = client.post("/api/v1/calendar", json={**RANGE, "geometry": geometry})
    assert response.status_code == 200, response.text
    return response.json()  # type: ignore[no-any-return]


def _month_map(body: dict[str, Any]) -> dict[tuple[int, int], float]:
    return {(m["year"], m["month"]): m["harmonized"] for m in body["months"]}


def test_fixture_is_labelled_synthetic(client: TestClient, tmp_path: Path) -> None:
    assert FIXTURE_LABEL == "TEST FIXTURE, not NASA data"
    assert "not_NASA_data" in FIXTURE_DIRNAME
    assert (tmp_path / FIXTURE_DIRNAME).is_dir()


def test_meta(client: TestClient) -> None:
    response = client.get("/api/v1/meta")
    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "California region"
    assert body["record_start"] == "2000-11"
    assert body["latest_month"] == "2026-11"
    assert body["latest_month_incomplete"] is True
    assert body["latest_complete_month"] == "2026-10"
    assert "UTC-8" in body["time_convention"]


def test_calendar_full_extent_and_split_polygons_agree(client: TestClient) -> None:
    full_region = _calendar(client, None)
    full = _calendar(client, FULL_EXTENT)
    west = _calendar(client, WEST_HALF)
    east = _calendar(client, EAST_HALF)

    # Record rules: October 2000 and the excluded cell never appear.
    labels = [(m["year"], m["month"]) for m in full_region["months"]]
    assert labels[0] == (2000, 11)
    assert (2000, 10) not in labels
    assert full_region["provisional_months"] == ["2026-11"]
    assert full_region["n_cells"] == full["n_cells"] == west["n_cells"] + east["n_cells"]
    assert west["n_cells"] > 0 and east["n_cells"] > 0

    full_map, west_map, east_map = _month_map(full), _month_map(west), _month_map(east)
    assert full_map.keys() == west_map.keys() == east_map.keys()
    for key, value in full_map.items():
        assert abs(value - (west_map[key] + east_map[key])) <= TOLERANCE
    assert full_map.keys() == _month_map(full_region).keys()
    for key, value in _month_map(full_region).items():
        assert abs(value - full_map[key]) <= TOLERANCE

    # The fixture has activity (cell C in the west half; cells A, B, D in the east half).
    assert sum(west_map.values()) > 0
    assert sum(east_map.values()) > 0


def test_stats(client: TestClient) -> None:
    response = client.post("/api/v1/stats", json=RANGE)
    assert response.status_code == 200, response.text
    body = response.json()
    calendar = _calendar(client, None)
    assert body["n_cells"] == calendar["n_cells"]
    assert body["summary"]["n_months"] == calendar["coverage"]["n_months"]
    assert body["summary"]["includes_provisional"] is True
    assert body["provisional_months"] == ["2026-11"]
    assert len(body["seasonal_profile"]) == 12
    yearly = sum(round(y["harmonized"], 1) for y in calendar["years"])
    assert abs(body["summary"]["total_harmonized"] - yearly) <= 0.05


def _data_rows(text: str) -> tuple[list[str], list[list[str]], str]:
    lines = text.splitlines()
    assert lines[0].startswith("#")
    footer = lines[-1]
    body = [line for line in lines if not line.startswith("#")]
    rows = list(csv.reader(io.StringIO("\n".join(body))))
    return lines, rows[1:], footer


def test_estimate_and_export_agree(client: TestClient) -> None:
    query = {**RANGE, "geometry": None}
    estimate = client.post("/api/v1/export/hotspots/estimate", json=query)
    assert estimate.status_code == 200, estimate.text
    est = estimate.json()
    assert est["over_limit"] is False
    assert est["rows"] > 0

    export = client.post("/api/v1/export/hotspots", json=query)
    assert export.status_code == 200
    assert export.headers["content-type"].startswith("text/csv")
    lines, rows, footer = _data_rows(export.text)
    assert footer == f"# rows: {est['rows']}"
    assert len(rows) == est["rows"]
    assert "raw" in export.text.lower()
    assert "UTC-8" in export.text


def test_second_call_returns_identical_results(client: TestClient) -> None:
    calls = [
        ("get", "/api/v1/meta", None),
        ("post", "/api/v1/calendar", {**RANGE, "geometry": WEST_HALF}),
        ("post", "/api/v1/stats", RANGE),
        ("post", "/api/v1/export/hotspots/estimate", {**RANGE, "geometry": None}),
    ]
    for method, url, payload in calls:
        first = client.request(method, url, json=payload)
        second = client.request(method, url, json=payload)
        assert first.status_code == second.status_code == 200
        assert first.json() == second.json(), url

    query = {**RANGE, "geometry": None}
    first_csv = client.post("/api/v1/export/hotspots", json=query).text
    second_csv = client.post("/api/v1/export/hotspots", json=query).text
    _, rows_a, footer_a = _data_rows(first_csv)
    _, rows_b, footer_b = _data_rows(second_csv)
    assert rows_a == rows_b
    assert footer_a == footer_b

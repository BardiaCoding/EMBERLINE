"""Unit tests for `POST /api/v1/calendar` (task 9.3).

Requirements 9.1, 9.2, 9.6, 9.8, 15.1, 16.1, 29.5. Data are synthetic (`tests/fixtures.py`,
TEST FIXTURE, not NASA data). Cells in the default fixture: A (34.0, -118.1), B (34.1, -118.1),
C (37.5, -120.5), D (32.5, -114.6). The excluded cell `38.7000_-117.4000` carries a non-zero
count in 2005-05 here, so a leak would show.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient

from hotspots.api.main import create_app
from tests.fixtures import (
    EXCLUDED_CELL_INDEX,
    default_grid_rows,
    make_grid_row,
    write_fixture_dir,
)

PROJECT_CONFIG = Path(__file__).resolve().parents[2] / "config" / "app.yaml"
URL = "/api/v1/calendar"
FULL_RANGE = {"start": "2000-01-01", "end": "2026-12-31"}


def _rect(west: float, south: float, east: float, north: float) -> dict[str, Any]:
    return {
        "type": "Polygon",
        "coordinates": [
            [[west, south], [east, south], [east, north], [west, north], [west, south]]
        ],
    }


AREA_A = _rect(-118.2, 34.0, -118.0, 34.1)
"""Contains only the centre of cell A (34.05, -118.05)."""
EMPTY_AREA = _rect(-120.0, 36.0, -119.9, 36.05)
"""Inside the region extent, no cell centre."""


def _config(tmp_path: Path, data_dir: Path) -> Path:
    raw = yaml.safe_load(PROJECT_CONFIG.read_text(encoding="utf-8"))
    raw["data_dir"] = str(data_dir)
    path = tmp_path / "app.yaml"
    path.write_text(yaml.safe_dump(raw), encoding="utf-8")
    return path


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    rows = [
        *default_grid_rows(),
        make_grid_row(*EXCLUDED_CELL_INDEX, 2005, 5, 99.0),
        make_grid_row(340, -1181, 2005, 5, 6.44),
    ]
    data_dir = write_fixture_dir(tmp_path, rows)
    with TestClient(create_app(_config(tmp_path, data_dir))) as c:
        yield c


def _post(client: TestClient, geometry: dict[str, Any] | None, **extra: Any) -> Any:
    body: dict[str, Any] = {**FULL_RANGE, **extra}
    if geometry is not None:
        body["geometry"] = geometry
    return client.post(URL, json=body)


def _month(body: dict[str, Any], year: int, month: int) -> dict[str, Any]:
    (row,) = [m for m in body["months"] if (m["year"], m["month"]) == (year, month)]
    return row


def test_full_extent_without_geometry(client: TestClient) -> None:
    response = _post(client, None)
    assert response.status_code == 200
    body = response.json()
    assert body["n_cells"] == 4
    assert body["notice"] is None
    assert body["clipped_percent"] is None
    assert (body["months"][0]["year"], body["months"][0]["month"]) == (2000, 11)
    assert (body["months"][-1]["year"], body["months"][-1]["month"]) == (2026, 11)
    assert len(body["baseline_by_month"]) == 12
    assert body["baseline_year"] is not None
    assert body["coverage"]["first_month"] == "2000-11"
    assert body["coverage"]["last_month"] == "2026-11"
    assert body["coverage"]["n_months"] == len(body["months"])
    assert {y["year"] for y in body["years"]} == set(range(2000, 2027))


def test_full_region_polygon_equals_no_geometry(client: TestClient) -> None:
    whole = _rect(-124.4, 32.5, -114.0, 42.2)
    assert _post(client, whole).json()["months"] == _post(client, None).json()["months"]


def test_polygon_selects_only_cells_with_centre_inside(client: TestClient) -> None:
    body = _post(client, AREA_A).json()
    assert body["n_cells"] == 1
    assert body["clipped_percent"] == 0.0
    assert _month(body, 2001, 7)["harmonized"] == 5.0
    assert _month(body, 2013, 7)["harmonized"] == 0.0  # cell B only


def test_rounding_one_decimal_and_integer_raw_counts(client: TestClient) -> None:
    body = _post(client, AREA_A).json()
    july = _month(body, 2012, 7)
    assert july["harmonized"] == 6.4
    assert july["raw_viirs"] == 8 and isinstance(july["raw_viirs"], int)
    assert july["raw_modis"] == 0
    assert _month(body, 2005, 5)["harmonized"] == 6.4  # 6.44 rounded
    assert _month(body, 2018, 8)["frp_sum_mw"] == 387.5


def test_october_2000_and_excluded_cell_never_appear(client: TestClient) -> None:
    body = _post(client, None).json()
    assert all((m["year"], m["month"]) != (2000, 10) for m in body["months"])
    assert _month(body, 2000, 11)["harmonized"] == 3.0  # A 2.0 + B 1.0, not the October row
    assert _month(body, 2005, 5)["harmonized"] == 6.4  # the excluded cell's 99.0 is absent
    assert all(y["harmonized"] < 99 for y in body["years"])


def test_provisional_month_is_flagged_without_anomaly(client: TestClient) -> None:
    body = _post(client, None).json()
    assert body["provisional_months"] == ["2026-11"]
    latest = _month(body, 2026, 11)
    assert latest["provisional"] is True
    assert latest["anomaly"] is None
    assert latest["lower_bound"] is None and latest["upper_bound"] is None
    assert _month(body, 2026, 10)["anomaly"] is not None
    year_2026 = next(y for y in body["years"] if y["year"] == 2026)
    assert year_2026["provisional"] is True and year_2026["anomaly"] is None


def test_empty_selection_gives_zero_months_and_notice(client: TestClient) -> None:
    response = _post(client, EMPTY_AREA)
    assert response.status_code == 200
    body = response.json()
    assert body["n_cells"] == 0
    assert body["notice"] == "no_cells"
    assert body["months"]
    assert all(m["harmonized"] == 0.0 and m["raw_modis"] == 0 for m in body["months"])


def test_partly_outside_is_clipped_and_reports_share(client: TestClient) -> None:
    body = _post(client, _rect(-128.4, 34.0, -118.0, 34.1)).json()
    assert 0 < body["clipped_percent"] < 100
    assert body["n_cells"] == 1  # only cell A has its centre in the clipped strip


def test_area_km2_is_geodesic_area_of_the_clipped_selection(client: TestClient) -> None:
    # 1 x 1 degree at about 34 N is roughly 111 km x 92 km.
    body = _post(client, _rect(-120.0, 34.0, -119.0, 35.0)).json()
    assert 9_500 < body["area_km2"] < 10_500
    full = _post(client, None).json()
    assert full["area_km2"] > body["area_km2"] > 0
    clipped = _post(client, _rect(-128.4, 34.0, -118.0, 34.1)).json()
    inside = _post(client, _rect(-124.4, 34.0, -118.0, 34.1)).json()
    assert clipped["area_km2"] == inside["area_km2"] > 0


def test_date_range_cutting_a_month_returns_the_whole_month(client: TestClient) -> None:
    body = _post(client, AREA_A, start="2001-07-15", end="2001-07-20").json()
    assert [(m["year"], m["month"]) for m in body["months"]] == [(2001, 7)]
    assert body["coverage"]["starts_mid_month"] is True
    assert body["coverage"]["ends_mid_month"] is True


def test_range_before_the_record_has_no_months(client: TestClient) -> None:
    body = _post(client, None, start="1990-01-01", end="1990-12-31").json()
    assert body["months"] == []
    assert body["coverage"]["before_record"] is True


def test_baseline_years_changes_the_baseline_only(client: TestClient) -> None:
    default = _post(client, AREA_A).json()
    custom = _post(client, AREA_A, baseline_years=[2005, 2009]).json()
    assert custom["months"][0]["harmonized"] == default["months"][0]["harmonized"]
    may = next(b for b in custom["baseline_by_month"] if b["month"] == 5)
    assert may["n_years"] == 5
    assert may["median"] == 0.0 and may["p90"] > 0


@pytest.mark.parametrize(
    ("years", "needle"),
    [([2010, 2012], "at least 5"), ([1980, 2000], "complete in-record years")],
)
def test_baseline_years_limits_are_422_and_named(
    client: TestClient, years: list[int], needle: str
) -> None:
    response = _post(client, AREA_A, baseline_years=years)
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "invalid_baseline_years"
    assert needle in error["message"]
    assert error["fields"][0]["field"] == "baseline_years"


def test_baseline_years_over_30_is_422(client: TestClient) -> None:
    response = _post(client, None, baseline_years=[2001, 2032])
    assert response.status_code == 422


BOWTIE = {
    "type": "Polygon",
    "coordinates": [[[-118, 34], [-117, 35], [-117, 34], [-118, 35], [-118, 34]]],
}
LINE = {"type": "Polygon", "coordinates": [[[-118, 34], [-117, 34], [-116, 34], [-118, 34]]]}
TWO_POINTS = {"type": "Polygon", "coordinates": [[[-118, 34], [-117, 34], [-118, 34]]]}
UNCLOSED = {
    "type": "Polygon",
    "coordinates": [[[-118, 34], [-117, 34], [-117, 35], [-118, 35]]],
}


@pytest.mark.parametrize(
    ("geometry", "reason"),
    [
        (BOWTIE, "self_intersection"),
        (LINE, "zero_area"),
        (TWO_POINTS, "too_few_vertices"),
        (UNCLOSED, "malformed_geometry"),
    ],
)
def test_invalid_geometry_is_422_with_reason(
    client: TestClient, geometry: dict[str, Any], reason: str
) -> None:
    response = _post(client, geometry)
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "invalid_geometry"
    assert error["fields"] == [{"field": "geometry", "reason": reason}]
    assert error["request_id"]


def test_entirely_outside_the_extent_is_outside_coverage(client: TestClient) -> None:
    response = _post(client, _rect(0.0, 0.0, 1.0, 1.0))
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "outside_coverage"
    assert error["fields"] == [{"field": "geometry", "reason": "outside_extent"}]


def test_too_many_vertices_is_422(client: TestClient) -> None:
    ring = [[-118.0 + i * 1e-5, 34.0 + (i % 2) * 1e-5] for i in range(1001)]
    response = _post(client, {"type": "Polygon", "coordinates": [[*ring, ring[0]]]})
    assert response.status_code == 422


@pytest.mark.parametrize(
    "body",
    [
        {"start": "2001-01-01'; DROP TABLE grid;--", "end": "2001-12-31"},
        {"start": "2001-01-01", "end": "2001-12-31", "geometry": {"type": "Polygon'; --"}},
        {
            "start": "2001-01-01",
            "end": "2001-12-31",
            "geometry": {"type": "Polygon", "coordinates": [[["-118'; --", "34"]]]},
        },
        {"start": "2001-01-01", "end": "2001-12-31", "geometry": "' OR 1=1 --"},
        {"start": "2001-01-01", "end": "2001-12-31", "baseline_years": ["1); --", 2005]},
        {"start": "2001-01-01", "end": "2001-12-31", "sql": "1; DROP TABLE x"},
        {"start": "2001-12-31", "end": "2001-01-01"},
    ],
)
def test_injection_style_and_invalid_bodies_are_rejected(
    client: TestClient, body: dict[str, Any]
) -> None:
    response = client.post(URL, json=body)
    assert response.status_code == 422
    text = response.text
    assert "DROP TABLE" not in text and "OR 1=1" not in text
    assert response.json()["error"]["code"] == "validation_error"


def test_calendar_503_without_data(tmp_path: Path) -> None:
    config = _config(tmp_path, tmp_path / "missing")
    with TestClient(create_app(config)) as c:
        response = c.post(URL, json=FULL_RANGE)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "data_unavailable"

"""Unit tests for `POST /api/v1/stats` (task 18.6).

Requirements 9.1, 10.3, 16.1, 16.2, 16.3, 16.5, 16.10, 29.4. Data are synthetic
(`tests/fixtures.py`, TEST FIXTURE, not NASA data). Cells in the default fixture: A (34.0, -118.1),
B (34.1, -118.1), C (37.5, -120.5), D (32.5, -114.6). Cell A also has 6.44 in 2005-05 here, and the
excluded cell carries 99.0 in 2005-05, so a leak would show. The latest month 2026-11 is
provisional.
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
URL = "/api/v1/stats"
CALENDAR_URL = "/api/v1/calendar"
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
AREA_AB = _rect(-118.2, 34.0, -118.0, 34.2)
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


def _body(geometry: dict[str, Any] | None, **extra: Any) -> dict[str, Any]:
    body: dict[str, Any] = {**FULL_RANGE, **extra}
    if geometry is not None:
        body["geometry"] = geometry
    return body


def _stats(client: TestClient, geometry: dict[str, Any] | None, **extra: Any) -> dict[str, Any]:
    response = client.post(URL, json=_body(geometry, **extra))
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def test_full_extent_summary(client: TestClient) -> None:
    body = _stats(client, None)
    assert body["n_cells"] == 4
    assert body["notice"] is None
    assert body["clipped_percent"] is None
    assert body["watch"]["period"] == "2026-10"  # details in test_api_watch.py
    summary = body["summary"]
    assert set(summary) == {
        "total_harmonized",
        "raw_modis",
        "raw_viirs",
        "frp_sum_mw",
        "n_months",
        "includes_provisional",
    }
    assert summary["n_months"] == 313  # 2000-11 to 2026-11
    assert summary["includes_provisional"] is True
    assert summary["total_harmonized"] < 99  # the excluded cell never leaks
    assert body["provisional_months"] == ["2026-11"]


def test_polygon_totals_and_separate_raw_counts(client: TestClient) -> None:
    body = _stats(client, AREA_A)
    assert body["n_cells"] == 1
    assert body["clipped_percent"] == 0.0
    summary = body["summary"]
    # 2.0 + 5.0 + 6.44 + 6.4 + 31.0 + 4.0 + 3.0, as the yearly totals are shown (one decimal).
    assert summary["total_harmonized"] == 57.8
    assert summary["raw_modis"] == 13  # 2000-11, 2001-07 and 2005-05 (MODIS era only)
    assert summary["raw_viirs"] == 56  # 8 + 39 + 5 + 4 (VIIRS era only)
    assert isinstance(summary["raw_modis"], int) and isinstance(summary["raw_viirs"], int)
    assert summary["frp_sum_mw"] is not None


@pytest.mark.parametrize("geometry", [None, AREA_A, AREA_AB, EMPTY_AREA])
@pytest.mark.parametrize(
    "span",
    [
        FULL_RANGE,
        {"start": "2005-03-15", "end": "2020-09-02"},
        {"start": "2012-01-01", "end": "2012-12-31"},
    ],
)
def test_total_equals_the_sum_of_the_yearly_values(
    client: TestClient, geometry: dict[str, Any] | None, span: dict[str, str]
) -> None:
    stats = _stats(client, geometry, **span)
    calendar = client.post(CALENDAR_URL, json=_body(geometry, **span)).json()
    yearly = [y["harmonized"] for y in calendar["years"]]
    assert stats["summary"]["total_harmonized"] == pytest.approx(sum(yearly), abs=0.01)
    assert stats["summary"]["raw_modis"] == sum(y["raw_modis"] for y in calendar["years"])
    assert stats["summary"]["raw_viirs"] == sum(y["raw_viirs"] for y in calendar["years"])
    assert stats["summary"]["n_months"] == len(calendar["months"])


def test_rankings_exclude_the_provisional_month_and_year(client: TestClient) -> None:
    body = _stats(client, AREA_A)
    months = body["top_months"]
    assert len(months) == 10
    assert (months[0]["year"], months[0]["month"], months[0]["harmonized"]) == (2018, 8, 31.0)
    assert all((m["year"], m["month"]) != (2026, 11) for m in months)
    counts = [m["harmonized"] for m in months]
    assert counts == sorted(counts, reverse=True)
    # 2026-10 (4.0) is a complete month and is ranked.
    assert (2026, 10) in {(m["year"], m["month"]) for m in months}
    # Ties (zero months) are listed earlier date first.
    zeros = [(m["year"], m["month"]) for m in months if m["harmonized"] == 0.0]
    assert zeros == sorted(zeros)

    years = body["top_years"]
    assert [y["year"] for y in years[:5]] == [2018, 2005, 2012, 2001, 2000]
    assert 2026 not in {y["year"] for y in years}
    assert len(years) == 10
    assert years[0]["n_months"] == 12 and years[4]["n_months"] == 2  # 2000 starts in November


def test_rankings_have_fewer_entries_for_a_short_range(client: TestClient) -> None:
    body = _stats(client, AREA_A, start="2018-06-01", end="2018-08-31")
    assert [(m["year"], m["month"]) for m in body["top_months"]] == [
        (2018, 8),
        (2018, 6),
        (2018, 7),
    ]
    assert [y["year"] for y in body["top_years"]] == [2018]
    assert body["top_years"][0]["n_months"] == 3


def test_current_month_is_the_provisional_month_without_comparison(client: TestClient) -> None:
    body = _stats(client, AREA_A, end="2026-11-30")
    current = body["current_month"]
    assert (current["year"], current["month"]) == (2026, 11)
    assert current["provisional"] is True
    assert current["harmonized"] == 3.0
    assert current["baseline_median"] is None
    assert current["anomaly"] is None
    year = body["current_year"]
    assert year["year"] == 2026 and year["provisional"] is True
    assert year["harmonized"] == 7.0
    assert year["baseline_median"] is None
    assert year["percentile_rank"] is None and year["anomaly"] is None


def test_end_after_the_latest_month_has_no_current_month(client: TestClient) -> None:
    body = _stats(client, AREA_A)  # the range ends in 2026-12, the grid ends in 2026-11
    assert body["current_month"] is None
    assert body["coverage"]["after_latest"] is True
    assert body["current_year"]["year"] == 2026  # the year still has months in the result


def test_current_month_against_a_zero_median(client: TestClient) -> None:
    body = _stats(client, AREA_A, start="2026-01-01", end="2026-10-31")
    current = body["current_month"]
    assert (current["year"], current["month"], current["harmonized"]) == (2026, 10, 4.0)
    assert current["provisional"] is False
    assert current["baseline_median"] == 0.0
    assert current["baseline_n_years"] == 26
    anomaly = current["anomaly"]
    assert anomaly["absolute"] == 4.0
    assert anomaly["percent"] is None
    assert anomaly["percent_text"] == "no typical fires in this month"
    # The year is partial (10 months), so it has no yearly comparison.
    year = body["current_year"]
    assert year["n_months"] == 10
    assert year["provisional"] is False
    assert year["baseline_median"] is None and year["anomaly"] is None


def test_current_year_against_the_yearly_baseline(client: TestClient) -> None:
    body = _stats(client, AREA_A, start="2000-01-01", end="2018-12-31")
    year = body["current_year"]
    assert (year["year"], year["harmonized"], year["n_months"]) == (2018, 31.0, 12)
    assert year["baseline_median"] == 0.0
    assert year["baseline_n_years"] == 25  # 2001 to 2025
    assert year["percentile_rank"] == 98.0  # 24 lower years and itself
    assert year["anomaly"]["absolute"] == 31.0
    assert year["anomaly"]["percent"] is None


def test_seasonal_profile_has_twelve_months_from_the_baseline(client: TestClient) -> None:
    stats = _stats(client, AREA_A)
    calendar = client.post(CALENDAR_URL, json=_body(AREA_A)).json()
    profile = stats["seasonal_profile"]
    assert [p["month"] for p in profile] == list(range(1, 13))
    by_month = {b["month"]: b for b in calendar["baseline_by_month"]}
    for point in profile:
        base = by_month[point["month"]]
        assert (point["median"], point["p10"], point["p90"], point["n_years"]) == (
            base["median"],
            base["p10"],
            base["p90"],
            base["n_years"],
        )
    assert profile[9]["n_years"] == 26  # October: 2001 to 2026


def test_seasonal_profile_does_not_depend_on_the_date_range(client: TestClient) -> None:
    whole = _stats(client, AREA_A)["seasonal_profile"]
    short = _stats(client, AREA_A, start="2018-06-01", end="2018-08-31")["seasonal_profile"]
    assert whole == short


def test_briefing_inputs(client: TestClient) -> None:
    briefing = _stats(client, AREA_A)["briefing_inputs"]
    assert briefing["latest_complete"] == "2026-10"
    assert briefing["latest_complete_harmonized"] == 4.0
    assert briefing["short_record"] is False
    assert briefing["provisional_months"] == ["2026-11"]
    assert briefing["baseline_all_zero"] is False
    assert briefing["peak_months"] == []  # every monthly median is 0
    rank = briefing["record_rank"]
    assert rank == {
        "month": "2026-10",
        "harmonized": 4.0,
        "rank": 1,
        "n_years": 26,
        "percentile": 98.1,
        "since_year": 2001,
    }
    ytd = briefing["year_to_date"]
    assert ytd["through"] == "2026-10"
    assert ytd["season_year"] == 2026 and ytd["month_of_season"] == 10
    assert ytd["count"] == 4.0
    assert ytd["median_cumulative"] == 0.0
    assert ytd["percent_difference"] is None
    assert ytd["direction"] == "above"


def test_empty_selection_gives_zeros_and_a_notice(client: TestClient) -> None:
    response = client.post(URL, json=_body(EMPTY_AREA, end="2026-11-30"))
    assert response.status_code == 200
    body = response.json()
    assert body["n_cells"] == 0
    assert body["notice"] == "no_cells"
    summary = body["summary"]
    assert summary["total_harmonized"] == 0.0
    assert summary["raw_modis"] == 0 and summary["raw_viirs"] == 0
    assert body["current_month"]["harmonized"] == 0.0
    assert body["briefing_inputs"]["baseline_all_zero"] is True
    assert body["briefing_inputs"]["peak_months"] == []
    assert len(body["seasonal_profile"]) == 12
    assert all(m["harmonized"] == 0.0 for m in body["top_months"])


def test_partly_outside_is_clipped_and_reports_share(client: TestClient) -> None:
    body = _stats(client, _rect(-128.4, 34.0, -118.0, 34.1))
    assert 0 < body["clipped_percent"] < 100
    assert body["n_cells"] == 1


def test_range_before_the_record_has_no_current_month(client: TestClient) -> None:
    body = _stats(client, None, start="1990-01-01", end="1990-12-31")
    assert body["summary"]["n_months"] == 0
    assert body["summary"]["total_harmonized"] == 0.0
    assert body["current_month"] is None and body["current_year"] is None
    assert body["top_months"] == [] and body["top_years"] == []
    assert body["coverage"]["before_record"] is True
    assert body["briefing_inputs"]["latest_complete"] is None
    assert body["briefing_inputs"]["year_to_date"] is None


def test_baseline_years_change_the_baseline_only(client: TestClient) -> None:
    default = _stats(client, AREA_A)
    custom = _stats(client, AREA_A, baseline_years=[2005, 2009])
    assert custom["summary"] == default["summary"]
    assert custom["top_months"] == default["top_months"]
    may = custom["seasonal_profile"][4]
    assert may["n_years"] == 5 and may["p90"] > 0


@pytest.mark.parametrize(
    ("years", "needle"),
    [([2010, 2012], "at least 5"), ([1980, 2000], "complete in-record years")],
)
def test_invalid_baseline_years_are_422_and_named(
    client: TestClient, years: list[int], needle: str
) -> None:
    response = client.post(URL, json=_body(AREA_A, baseline_years=years))
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "invalid_baseline_years"
    assert needle in error["message"]


@pytest.mark.parametrize(
    ("geometry", "code", "reason"),
    [
        (
            {
                "type": "Polygon",
                "coordinates": [[[-118, 34], [-117, 35], [-117, 34], [-118, 35], [-118, 34]]],
            },
            "invalid_geometry",
            "self_intersection",
        ),
        (_rect(0.0, 0.0, 1.0, 1.0), "outside_coverage", "outside_extent"),
    ],
)
def test_invalid_area_is_422_with_reason(
    client: TestClient, geometry: dict[str, Any], code: str, reason: str
) -> None:
    response = client.post(URL, json=_body(geometry))
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == code
    assert error["fields"] == [{"field": "geometry", "reason": reason}]


def test_end_before_start_is_422(client: TestClient) -> None:
    response = client.post(URL, json={"start": "2001-12-31", "end": "2001-01-01"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_503_without_data(tmp_path: Path) -> None:
    config = _config(tmp_path, tmp_path / "missing")
    with TestClient(create_app(config)) as c:
        response = c.post(URL, json=FULL_RANGE)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "data_unavailable"

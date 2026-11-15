# Feature: harmonized-fire-calendar, Property 31: Summary total equals the yearly sums
"""Property 31: for any query result, the total harmonized count on the summary card equals the
sum of the yearly bar values within 0.01 after rounding.

Two checks, both with synthetic data only (TEST FIXTURE, not NASA data):

- `test_summary_equals_yearly_sums_on_random_grids` runs the route logic without the HTTP layer
  (`compute_area_result`, `briefing_inputs`, `serialize_stats`, `serialize_area_result`, which are
  exactly what `POST /api/v1/stats` and `POST /api/v1/calendar` call) on grids from
  `tests/property/strategies/grids.py`, with random areas and date ranges.
- `test_summary_equals_yearly_sums_through_the_api` builds the app once on the default fixture
  files (`write_fixture_dir`) and varies only the request body (area and date range).

The yearly bars are the `years[].harmonized` values of the calendar response. The summary also
keeps raw MODIS and raw VIIRS as separate sums of the yearly raw values, and reports whether the
range includes the provisional month.

**Validates: Requirements 16.10**
"""

from __future__ import annotations

import math
from collections.abc import Iterator
from datetime import date
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient
from hypothesis import assume, given
from hypothesis import strategies as st
from shapely.geometry import box

from hotspots.api import schemas
from hotspots.api.main import create_app
from hotspots.api.serialize import COUNT_DECIMALS, serialize_area_result, serialize_stats
from hotspots.areastats import compute_area_result
from hotspots.data.grid import GridDataError, build_grid_arrays
from hotspots.data.types import YearMonth
from hotspots.stats import briefing_inputs
from tests.fixtures import (
    EXCLUDED_CELL_ID,
    RECORD_START,
    grid_table,
    write_fixture_dir,
)
from tests.property.strategies.grids import grids

PROJECT_CONFIG = Path(__file__).resolve().parents[2] / "config" / "app.yaml"
RECORD_START_TEXT = f"{RECORD_START[0]:04d}-{RECORD_START[1]:02d}"
START = YearMonth(*RECORD_START)
TOLERANCE = 0.01
ROUNDING_STEP = 10.0**-COUNT_DECIMALS

# Area extent of the fixtures (measured extent of the delivered grid).
LAT_RANGE = (32.5, 42.2)
LON_RANGE = (-124.4, -114.0)


# --- generators ---------------------------------------------------------------------------


@st.composite
def date_ranges(draw: st.DrawFn) -> tuple[date, date]:
    """A local date range, including ones that cut months, start before the record or end late."""
    low, high = date(2000, 8, 1), date(2027, 3, 31)
    if draw(st.booleans()):
        return date(2000, 11, 1), date(2026, 11, 30)
    a = draw(st.dates(min_value=low, max_value=high))
    b = draw(st.dates(min_value=low, max_value=high))
    return min(a, b), max(a, b)


@st.composite
def rectangles(draw: st.DrawFn) -> tuple[float, float, float, float]:
    """`(west, south, east, north)` inside the extent, at least 0.02 degrees on each side."""
    lons = sorted(draw(st.lists(st.floats(*LON_RANGE), min_size=2, max_size=2, unique=True)))
    lats = sorted(draw(st.lists(st.floats(*LAT_RANGE), min_size=2, max_size=2, unique=True)))
    assume(lons[1] - lons[0] >= 0.02 and lats[1] - lats[0] >= 0.02)
    return lons[0], lats[0], lons[1], lats[1]


def _ring(west: float, south: float, east: float, north: float) -> dict[str, Any]:
    return {
        "type": "Polygon",
        "coordinates": [
            [[west, south], [east, south], [east, north], [west, north], [west, south]]
        ],
    }


# --- the property -------------------------------------------------------------------------


def _assert_summary_matches_years(
    summary: schemas.StatsSummary | dict[str, Any],
    years: list[Any],
    n_months: int,
    provisional_months: list[str],
) -> None:
    """The summary card against the yearly bars of the same query."""
    get = (lambda k: summary[k]) if isinstance(summary, dict) else (lambda k: getattr(summary, k))
    yearly = [y["harmonized"] if isinstance(y, dict) else y.harmonized for y in years]
    raw_modis = [y["raw_modis"] if isinstance(y, dict) else y.raw_modis for y in years]
    raw_viirs = [y["raw_viirs"] if isinstance(y, dict) else y.raw_viirs for y in years]
    year_flags = [y["provisional"] if isinstance(y, dict) else y.provisional for y in years]

    # Total harmonized equals the sum of the displayed yearly values within 0.01.
    assert math.isclose(get("total_harmonized"), math.fsum(yearly), abs_tol=TOLERANCE)
    # Raw MODIS and raw VIIRS are separate integer sums of the yearly raw values.
    assert get("raw_modis") == sum(raw_modis)
    assert get("raw_viirs") == sum(raw_viirs)
    # Provisional inclusion: some yearly bar is provisional exactly when a provisional month is
    # in the range, and the card says so.
    assert get("includes_provisional") == any(year_flags)
    assert get("includes_provisional") == bool(provisional_months)
    assert get("n_months") == n_months


@given(
    rows=grids(),
    span=date_ranges(),
    rect=st.one_of(st.none(), rectangles()),
)
def test_summary_equals_yearly_sums_on_random_grids(
    rows: list[dict[str, Any]],
    span: tuple[date, date],
    rect: tuple[float, float, float, float] | None,
) -> None:
    """Pure route logic on random sparse grids, areas and date ranges."""
    assume(rows)
    try:
        grid = build_grid_arrays(grid_table(rows), RECORD_START_TEXT, (EXCLUDED_CELL_ID,))
    except GridDataError:
        assume(False)
        raise
    polygon = box(*(rect or (-125.0, 32.0, -113.0, 43.0)))
    start, end = span

    result = compute_area_result(grid, polygon, start, end, record_start=START)
    assert result.series is not None
    stats = serialize_stats(result, end, briefing_inputs(result, result.series, None))
    calendar = serialize_area_result(result)

    _assert_summary_matches_years(
        stats.summary, calendar.years, len(calendar.months), calendar.provisional_months
    )
    assert stats.provisional_months == calendar.provisional_months

    # The card is also close to the unrounded total: each yearly bar is off by at most half a
    # step, so the sum cannot drift further than that per bar.
    exact = math.fsum(y.harmonized for y in result.years)
    allowed = ROUNDING_STEP / 2 * (len(result.years) + 1) + 1e-9
    assert abs(stats.summary.total_harmonized - exact) <= allowed

    # Raw MODIS and raw VIIRS are never merged: no field holds their sum.
    assert set(schemas.StatsSummary.model_fields) >= {"raw_modis", "raw_viirs"}
    assert "raw_total" not in schemas.StatsSummary.model_fields


# --- through the API ----------------------------------------------------------------------


@pytest.fixture(scope="module")
def client(tmp_path_factory: pytest.TempPathFactory) -> Iterator[TestClient]:
    """App built once on the default fixture grid, shared by every generated request."""
    tmp_path = tmp_path_factory.mktemp("summary_consistency")
    data_dir = write_fixture_dir(tmp_path)
    raw = yaml.safe_load(PROJECT_CONFIG.read_text(encoding="utf-8"))
    raw["data_dir"] = str(data_dir)
    config_path = tmp_path / "app.yaml"
    config_path.write_text(yaml.safe_dump(raw), encoding="utf-8")
    with TestClient(create_app(config_path)) as c:
        yield c


@given(span=date_ranges(), rect=st.one_of(st.none(), rectangles()))
def test_summary_equals_yearly_sums_through_the_api(
    client: TestClient,
    span: tuple[date, date],
    rect: tuple[float, float, float, float] | None,
) -> None:
    """`/stats` summary against the `/calendar` yearly values for the same body."""
    start, end = span
    body: dict[str, Any] = {"start": start.isoformat(), "end": end.isoformat()}
    if rect is not None:
        body["geometry"] = _ring(*rect)

    stats_response = client.post("/api/v1/stats", json=body)
    calendar_response = client.post("/api/v1/calendar", json=body)
    assert stats_response.status_code == 200, stats_response.text
    assert calendar_response.status_code == 200, calendar_response.text
    stats = stats_response.json()
    calendar = calendar_response.json()

    _assert_summary_matches_years(
        stats["summary"], calendar["years"], len(calendar["months"]), calendar["provisional_months"]
    )
    assert stats["provisional_months"] == calendar["provisional_months"]

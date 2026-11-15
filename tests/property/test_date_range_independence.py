# Feature: harmonized-fire-calendar, Property 52: Baseline does not depend on the Date_Range
"""Property 52: for any grid, area and two different Date_Ranges, the baseline and the anomaly of
each month present in both results are equal.

Synthetic data only (TEST FIXTURE, not NASA data).

**Validates: Requirements 14.11, 20.15**
"""

from __future__ import annotations

from datetime import date
from typing import Any

from hypothesis import assume, given
from hypothesis import strategies as st
from shapely.geometry import box

from hotspots.areastats import compute_area_result
from hotspots.data.grid import GridDataError, build_grid_arrays
from hotspots.data.types import YearMonth
from tests.fixtures import EXCLUDED_CELL_ID, RECORD_START, grid_table
from tests.property.strategies.grids import grids

RECORD_START_TEXT = f"{RECORD_START[0]:04d}-{RECORD_START[1]:02d}"
START = YearMonth(*RECORD_START)


@st.composite
def date_ranges(draw: st.DrawFn) -> tuple[date, date]:
    """A local date range, possibly cutting months or reaching outside the record."""
    low, high = date(2000, 8, 1), date(2027, 3, 31)
    a = draw(st.dates(min_value=low, max_value=high))
    b = draw(st.dates(min_value=low, max_value=high))
    return min(a, b), max(a, b)


@st.composite
def rectangles(draw: st.DrawFn) -> tuple[float, float, float, float]:
    """`(west, south, east, north)` with at least 0.02 degrees on each side."""
    lons = sorted(draw(st.lists(st.floats(-124.4, -114.0), min_size=2, max_size=2, unique=True)))
    lats = sorted(draw(st.lists(st.floats(32.5, 42.2), min_size=2, max_size=2, unique=True)))
    assume(lons[1] - lons[0] >= 0.02 and lats[1] - lats[0] >= 0.02)
    return lons[0], lats[0], lons[1], lats[1]


@given(
    rows=grids(),
    first=date_ranges(),
    second=date_ranges(),
    rect=st.one_of(st.none(), rectangles()),
)
def test_baseline_and_anomaly_do_not_depend_on_date_range(
    rows: list[dict[str, Any]],
    first: tuple[date, date],
    second: tuple[date, date],
    rect: tuple[float, float, float, float] | None,
) -> None:
    assume(rows)
    try:
        grid = build_grid_arrays(grid_table(rows), RECORD_START_TEXT, (EXCLUDED_CELL_ID,))
    except GridDataError:
        assume(False)
        raise
    polygon = box(*(rect or (-125.0, 32.0, -113.0, 43.0)))

    a = compute_area_result(grid, polygon, *first, record_start=START)
    b = compute_area_result(grid, polygon, *second, record_start=START)

    # The baselines are the same whatever the range.
    assert a.baseline_by_month == b.baseline_by_month
    assert a.baseline_year == b.baseline_year

    # Months present in both results have equal anomalies (and equal values).
    by_key_b = {(r.year, r.month): r for r in b.months}
    for row in a.months:
        other = by_key_b.get((row.year, row.month))
        if other is None:
            continue
        assert row.harmonized == other.harmonized
        assert row.provisional == other.provisional
        assert row.anomaly == other.anomaly

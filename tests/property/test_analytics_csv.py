# Feature: harmonized-fire-calendar, Property 34: Analytics CSV matches the result
"""Property 34: for any query result, each monthly and yearly harmonized count, baseline and
anomaly value in the analytics CSV equals the API value (already rounded as displayed), raw MODIS
and raw VIIRS are separate columns, null bounds are empty, and an all-zero query still has one row
per month and year.

Runs the route logic without HTTP (`compute_area_result`, `serialize_area_result`, then
`build_analytics_csv`, as `POST /api/v1/export/analytics` does) on random synthetic grids
(TEST FIXTURE, not NASA data), areas and date ranges.

**Validates: Requirements 18.1, 18.4, 18.5**
"""

from __future__ import annotations

import csv
import io
from datetime import UTC, date, datetime
from typing import Any

from hypothesis import assume, given
from hypothesis import strategies as st
from shapely.geometry import box

from hotspots.api.schemas import CalendarOut
from hotspots.api.serialize import serialize_area_result
from hotspots.areastats import compute_area_result
from hotspots.data.grid import GridDataError, build_grid_arrays
from hotspots.data.types import YearMonth
from hotspots.export.analytics_csv import COLUMNS, build_analytics_csv
from tests.fixtures import EXCLUDED_CELL_ID, RECORD_START, grid_table
from tests.property.strategies.grids import grids

RECORD_START_TEXT = f"{RECORD_START[0]:04d}-{RECORD_START[1]:02d}"
START = YearMonth(*RECORD_START)
GENERATED_AT = datetime(2026, 11, 10, 12, 0, tzinfo=UTC)


@st.composite
def date_ranges(draw: st.DrawFn) -> tuple[date, date]:
    low, high = date(2000, 8, 1), date(2027, 3, 31)
    if draw(st.booleans()):
        return date(2000, 11, 1), date(2026, 11, 30)
    a = draw(st.dates(min_value=low, max_value=high))
    b = draw(st.dates(min_value=low, max_value=high))
    return min(a, b), max(a, b)


@st.composite
def rectangles(draw: st.DrawFn) -> tuple[float, float, float, float]:
    """`(west, south, east, north)` in the extent, so some areas hold no active cell."""
    lons = sorted(draw(st.lists(st.floats(-124.4, -114.0), min_size=2, max_size=2, unique=True)))
    lats = sorted(draw(st.lists(st.floats(32.5, 42.2), min_size=2, max_size=2, unique=True)))
    assume(lons[1] - lons[0] >= 0.02 and lats[1] - lats[0] >= 0.02)
    return lons[0], lats[0], lons[1], lats[1]


def _parse(text: str) -> tuple[list[str], list[dict[str, str]], str]:
    lines = text.splitlines()
    comments = [ln for ln in lines if ln.startswith("# ")]
    data = [ln for ln in lines if not ln.startswith("# ")]
    rows = list(csv.DictReader(io.StringIO("\n".join(data))))
    return comments[:-1], rows, comments[-1]


def _num(text: str) -> float | None:
    return None if text == "" else float(text)


def _same(text: str, expected: float | None) -> bool:
    """CSV text equals the API value (the CSV writes the already rounded value)."""
    got = _num(text)
    if expected is None:
        return got is None
    return got is not None and got == expected


def _check_result(result: CalendarOut, text: str) -> None:
    _, rows, footer = _parse(text)
    assert footer == f"# rows: {len(rows)}"
    assert len(rows) == len(result.months) + len(result.years)  # one row per month and year
    if rows:
        assert list(rows[0].keys()) == list(COLUMNS)
    assert "raw_modis_cell_days" in COLUMNS and "raw_viirs_cell_days" in COLUMNS
    assert "raw_total" not in COLUMNS

    months = [r for r in rows if r["period_type"] == "month"]
    years = [r for r in rows if r["period_type"] == "year"]
    assert len(months) == len(result.months) and len(years) == len(result.years)
    by_month = {b.month: b for b in result.baseline_by_month}

    for row, m in zip(months, result.months, strict=True):
        assert (int(row["year"]), int(row["month"])) == (m.year, m.month)
        assert _same(row["harmonized_cell_days"], m.harmonized)
        assert int(row["raw_modis_cell_days"]) == m.raw_modis
        assert int(row["raw_viirs_cell_days"]) == m.raw_viirs
        assert row["lower_bound"] == "" and row["upper_bound"] == ""
        assert row["provisional"] == ("true" if m.provisional else "false")
        base = by_month.get(m.month)
        if m.provisional or base is None:
            assert row["baseline_median"] == "" and row["anomaly_absolute"] == ""
        else:
            assert _same(row["baseline_median"], base.median)
            assert _same(row["baseline_p10"], base.p10)
            assert _same(row["baseline_p90"], base.p90)
            assert _same(row["baseline_mean"], base.mean)
        if not m.provisional and m.anomaly is not None:
            a = m.anomaly
            assert _same(row["anomaly_absolute"], a.absolute)
            assert _same(row["anomaly_percent"], a.percent)
            assert _same(row["anomaly_zscore"], a.zscore)
            assert _same(row["anomaly_percentile_rank"], a.percentile_rank)

    for row, y in zip(years, result.years, strict=True):
        assert int(row["year"]) == y.year and row["month"] == ""
        assert _same(row["harmonized_cell_days"], y.harmonized)
        assert int(row["raw_modis_cell_days"]) == y.raw_modis
        assert int(row["raw_viirs_cell_days"]) == y.raw_viirs
        assert row["lower_bound"] == "" and row["upper_bound"] == ""
        assert row["provisional"] == ("true" if y.provisional else "false")
        if not y.provisional and result.baseline_year is not None:
            assert _same(row["baseline_median"], result.baseline_year.median)
        if not y.provisional and y.anomaly is not None:
            assert _same(row["anomaly_absolute"], y.anomaly.absolute)
            assert _same(row["anomaly_percent"], y.anomaly.percent)
            assert _same(row["anomaly_zscore"], y.anomaly.zscore)
            assert _same(row["anomaly_percentile_rank"], y.anomaly.percentile_rank)


@given(
    rows=grids(),
    span=date_ranges(),
    rect=st.one_of(st.none(), rectangles()),
)
def test_analytics_csv_matches_result(
    rows: list[dict[str, Any]],
    span: tuple[date, date],
    rect: tuple[float, float, float, float] | None,
) -> None:
    assume(rows)
    try:
        grid = build_grid_arrays(grid_table(rows), RECORD_START_TEXT, (EXCLUDED_CELL_ID,))
    except GridDataError:
        assume(False)
        raise
    polygon = box(*(rect or (-125.0, 32.0, -113.0, 43.0)))
    start, end = span
    result = serialize_area_result(
        compute_area_result(grid, polygon, start, end, record_start=START)
    )
    text = build_analytics_csv(
        result,
        query_description="synthetic query",
        start=start,
        end=end,
        generated_at=GENERATED_AT,
    )
    _check_result(result, text)


@given(rows=grids(max_cells=3), span=date_ranges())
def test_all_zero_query_keeps_one_row_per_period(
    rows: list[dict[str, Any]], span: tuple[date, date]
) -> None:
    """An area with no active cell still yields a row per month and per year, all zero."""
    assume(rows)
    try:
        grid = build_grid_arrays(grid_table(rows), RECORD_START_TEXT, (EXCLUDED_CELL_ID,))
    except GridDataError:
        assume(False)
        raise
    # Rows are drawn on lat 32.5 to 42.2; this 0.2 degree box sits in the extent, off the cells
    # whenever it selects none of them.
    polygon = box(-124.39, 32.51, -124.37, 32.53)
    start, end = span
    result = serialize_area_result(
        compute_area_result(grid, polygon, start, end, record_start=START)
    )
    assume(result.n_cells == 0 or all(m.harmonized == 0 for m in result.months))
    text = build_analytics_csv(
        result,
        query_description="synthetic query",
        start=start,
        end=end,
        generated_at=GENERATED_AT,
    )
    _check_result(result, text)
    _, parsed, _ = _parse(text)
    assert all(float(r["harmonized_cell_days"]) == 0 for r in parsed)

# Feature: harmonized-fire-calendar, Property 22: Temporal consistency and query determinism
"""Property 22: for any grid, area and date range, the sum of the unrounded monthly harmonized
sums equals the sum of the unrounded yearly sums within 1e-6, raw counts per sensor family are
equal exactly, and running the same query twice on the same data returns identical results.

The same generators also check that a month with no row in the area is returned as 0.0 (raw
counts 0), not omitted (requirement 9.8). The expected months come from an independent oracle
over the sparse rows. Every row is synthetic (TEST FIXTURE, not NASA data).

**Validates: Requirements 9.1, 9.4, 9.8, 9.9**
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from typing import Any

import pytest
from hypothesis import assume, given
from hypothesis import strategies as st
from shapely.geometry import box

from hotspots.areastats import AreaResult, compute_area_result
from hotspots.data.grid import GridArrays, GridDataError, build_grid_arrays
from hotspots.data.types import YearMonth
from tests.fixtures import (
    EXCLUDED_CELL_ID,
    RECORD_START,
    grid_table,
    make_grid_row,
)
from tests.property.strategies.grids import LAT_IDX_RANGE, LON_IDX_RANGE, grids

RECORD_START_TEXT = f"{RECORD_START[0]:04d}-{RECORD_START[1]:02d}"
START = YearMonth(*RECORD_START)
START_N = RECORD_START[0] * 12 + RECORD_START[1] - 1

Row = dict[str, Any]


def _n(year: int, month: int) -> int:
    """Months since year 0, for plain integer month arithmetic in the oracle."""
    return year * 12 + month - 1


@dataclass(frozen=True)
class Query:
    """Sparse rows, the area as half-open cell-index bounds, and the local date range."""

    rows: list[Row]
    lat_lo: int
    lat_hi: int
    lon_lo: int
    lon_hi: int
    start: date
    end: date

    @property
    def polygon(self) -> Any:
        """Rectangle on cell edges, so no cell centre ever lies on its boundary."""
        return box(self.lon_lo / 10, self.lat_lo / 10, self.lon_hi / 10, self.lat_hi / 10)

    def selects(self, cell_id: str) -> bool:
        """Oracle selection from the SW corner index in the cell id (not from the grid)."""
        lat_text, lon_text = cell_id.split("_")
        lat_idx, lon_idx = round(float(lat_text) * 10), round(float(lon_text) * 10)
        return self.lat_lo <= lat_idx < self.lat_hi and self.lon_lo <= lon_idx < self.lon_hi


def _cell_index(row: Row) -> tuple[int, int]:
    lat_text, lon_text = row["cell_id"].split("_")
    return round(float(lat_text) * 10), round(float(lon_text) * 10)


@st.composite
def queries(draw: st.DrawFn) -> Query:
    """Non-empty grid rows, a rectangle (often around a drawn cell) and a date range."""
    rows = draw(grids())
    assume(rows)
    lat_min, lat_max = LAT_IDX_RANGE[0], LAT_IDX_RANGE[1] + 1
    lon_min, lon_max = LON_IDX_RANGE[0], LON_IDX_RANGE[1] + 1
    kind = draw(st.sampled_from(["full", "around_cell", "random"]))
    if kind == "full":
        lat_lo, lat_hi, lon_lo, lon_hi = lat_min, lat_max, lon_min, lon_max
    elif kind == "around_cell":
        lat_idx, lon_idx = _cell_index(draw(st.sampled_from(rows)))
        lat_lo = lat_idx - draw(st.integers(min_value=0, max_value=3))
        lat_hi = lat_idx + 1 + draw(st.integers(min_value=0, max_value=3))
        lon_lo = lon_idx - draw(st.integers(min_value=0, max_value=3))
        lon_hi = lon_idx + 1 + draw(st.integers(min_value=0, max_value=3))
    else:
        lat_lo = draw(st.integers(min_value=lat_min, max_value=lat_max - 1))
        lat_hi = draw(st.integers(min_value=lat_lo + 1, max_value=lat_max))
        lon_lo = draw(st.integers(min_value=lon_min, max_value=lon_max - 1))
        lon_hi = draw(st.integers(min_value=lon_lo + 1, max_value=lon_max))

    # Ranges may start before the record or end after the latest month (2026-11).
    low, high = date(2000, 8, 1), date(2027, 3, 31)
    if draw(st.booleans()):
        start, end = date(2000, 11, 1), date(2026, 11, 30)
    else:
        a = draw(st.dates(min_value=low, max_value=high))
        b = draw(st.dates(min_value=low, max_value=high))
        start, end = min(a, b), max(a, b)
    return Query(rows, lat_lo, lat_hi, lon_lo, lon_hi, start, end)


def _grid(query: Query) -> GridArrays:
    return build_grid_arrays(grid_table(query.rows), RECORD_START_TEXT, (EXCLUDED_CELL_ID,))


def _run(query: Query, grid: GridArrays) -> AreaResult:
    return compute_area_result(grid, query.polygon, query.start, query.end, record_start=START)


@given(query=queries())
def test_monthly_sums_equal_yearly_sums(query: Query) -> None:
    """Months and years agree: harmonized within 1e-6, raw MODIS and raw VIIRS exactly."""
    try:
        grid = _grid(query)
    except GridDataError:
        assume(False)
    result = _run(query, grid)

    months, years = result.months, result.years
    assert math.fsum(m.harmonized for m in months) == pytest.approx(
        math.fsum(y.harmonized for y in years), abs=1e-6
    )
    assert sum(m.raw_modis for m in months) == sum(y.raw_modis for y in years)
    assert sum(m.raw_viirs for m in months) == sum(y.raw_viirs for y in years)
    assert sum(y.n_months for y in years) == len(months)

    # Each year equals the months of that year, and every month belongs to exactly one year.
    assert [y.year for y in years] == sorted({m.year for m in months})
    for y in years:
        in_year = [m for m in months if m.year == y.year]
        assert y.n_months == len(in_year)
        assert y.harmonized == pytest.approx(math.fsum(m.harmonized for m in in_year), abs=1e-6)
        assert y.raw_modis == sum(m.raw_modis for m in in_year)
        assert y.raw_viirs == sum(m.raw_viirs for m in in_year)
        assert y.provisional == any(m.provisional for m in in_year)


@given(query=queries())
def test_same_query_twice_returns_identical_results(query: Query) -> None:
    """Determinism (requirement 9.9): same data and query give equal results, also on a rebuilt
    grid. `Baseline.values` is excluded from dataclass equality, so it is compared explicitly."""
    try:
        grid = _grid(query)
    except GridDataError:
        assume(False)
    first = _run(query, grid)
    second = _run(query, grid)
    rebuilt = _run(query, _grid(query))

    for other in (second, rebuilt):
        assert other == first
        assert other.months == first.months
        assert other.years == first.years
        assert other.baseline_year.values == first.baseline_year.values
        for month in range(1, 13):
            assert other.baseline_by_month[month].values == first.baseline_by_month[month].values


@given(query=queries())
def test_months_without_a_row_in_the_area_are_zero_not_omitted(query: Query) -> None:
    """Every in-record month of the range is returned, 0.0 and raw 0 where the area has no row."""
    try:
        grid = _grid(query)
    except GridDataError:
        assume(False)
    result = _run(query, grid)

    # Oracle over the sparse rows: per-month sums of the selected cells.
    harm: dict[int, list[float]] = defaultdict(list)
    modis: dict[int, int] = defaultdict(int)
    viirs: dict[int, int] = defaultdict(int)
    incomplete: set[int] = set()
    last = START_N - 1
    for row in query.rows:
        n = _n(row["year"], row["month"])
        last = max(last, n)
        if row["incomplete"]:
            incomplete.add(n)
        if query.selects(row["cell_id"]):
            harm[n].append(row["count_harmonized"])
            modis[n] += row["count_raw_modis"]
            viirs[n] += row["count_raw_viirs"]

    first_n = max(_n(query.start.year, query.start.month), START_N)
    last_n = min(_n(query.end.year, query.end.month), last)
    expected_months = list(range(first_n, last_n + 1))

    got = {_n(m.year, m.month): m for m in result.months}
    assert list(got) == expected_months
    assert len(result.months) == len(expected_months)

    n_zero_months = 0
    for n in expected_months:
        m = got[n]
        assert m.provisional == (n in incomplete)
        assert m.harmonized == pytest.approx(math.fsum(harm[n]), abs=1e-9, rel=1e-9)
        assert (m.raw_modis, m.raw_viirs) == (modis[n], viirs[n])
        if not harm[n]:
            n_zero_months += 1
            assert m.harmonized == 0.0
            assert (m.raw_modis, m.raw_viirs) == (0, 0)
    assert n_zero_months == sum(1 for n in expected_months if not harm[n])


def test_example_gap_month_is_zero_and_year_sum_matches() -> None:
    """Example: 2001-02 to 2001-12 have no row in the area. They appear as 0.0 and the 2001 total
    is the sum of the two months with rows."""
    rows = [
        make_grid_row(340, -1181, 2001, 1, 4.0),
        make_grid_row(340, -1181, 2001, 12, 2.5),
        make_grid_row(375, -1205, 2001, 6, 99.0),  # outside the area
    ]
    query = Query(rows, 330, 350, -1190, -1170, date(2001, 1, 1), date(2001, 12, 31))
    result = _run(query, _grid(query))
    assert [(m.year, m.month) for m in result.months] == [(2001, k) for k in range(1, 13)]
    assert [m.harmonized for m in result.months] == [4.0] + [0.0] * 10 + [2.5]
    assert [m.raw_modis for m in result.months] == [4] + [0] * 10 + [2]
    assert len(result.years) == 1
    assert result.years[0].harmonized == 6.5
    assert result.years[0].raw_modis == 6
    assert result.years[0].n_months == 12

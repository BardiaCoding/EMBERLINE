# Feature: harmonized-fire-calendar, Property 54: Provisional month flag
"""Property 54: for any grid, a month is provisional exactly when its `incomplete` flag is true,
and a provisional month never appears in the zero-filled series, in the baseline or in the
rankings.

Checked on `compute_area_result` and `serialize_area_result`:

- `provisional` equals the grid `incomplete` flag, also for months with no activity in the area;
- a provisional month and a year that contains one have a null anomaly, and null bounds;
- a provisional month never enters a baseline: `n_years` and `values` match an independent oracle
  over complete months, and stay unchanged when the provisional month's counts are changed.

The flags are drawn freely (any month, not only the latest one), so the property does not depend
on which month the delivered data marks incomplete. There is no rankings module yet, so the
"rankings" part of the property is not covered here. Every row is synthetic (TEST FIXTURE, not
NASA data).

**Validates: Requirements 15.18, 15.19**
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from typing import Any

import numpy as np
import pytest
from hypothesis import assume, given
from hypothesis import strategies as st
from shapely.geometry import box

from hotspots.api.serialize import serialize_area_result
from hotspots.areastats import AreaResult, compute_area_result, select_cells, zero_filled_series
from hotspots.data.grid import GridArrays, GridDataError, build_grid_arrays
from hotspots.data.types import YearMonth
from tests.fixtures import EXCLUDED_CELL_ID, RECORD_START, grid_table, make_grid_row
from tests.property.strategies.grids import grids

RECORD_START_TEXT = f"{RECORD_START[0]:04d}-{RECORD_START[1]:02d}"
START = YearMonth(*RECORD_START)
START_N = RECORD_START[0] * 12 + RECORD_START[1] - 1
FULL_AREA = box(-125.0, 32.0, -113.0, 43.0)

Row = dict[str, Any]


def _n(year: int, month: int) -> int:
    """Months since year 0, for plain integer month arithmetic in the oracle."""
    return year * 12 + month - 1


def _label(n: int) -> str:
    year, month0 = divmod(n, 12)
    return f"{year:04d}-{month0 + 1:02d}"


@dataclass(frozen=True)
class Case:
    """Grid rows (flags already applied), the incomplete months, and a local date range."""

    rows: list[Row]
    incomplete: frozenset[int]
    start: date
    end: date


@st.composite
def cases(draw: st.DrawFn) -> Case:
    """Sparse rows with a freely drawn set of incomplete months and a date range."""
    rows = draw(grids())
    assume(rows)
    present = sorted({_n(r["year"], r["month"]) for r in rows})
    incomplete = frozenset(draw(st.sets(st.sampled_from(present), max_size=4)))
    flagged = [{**r, "incomplete": _n(r["year"], r["month"]) in incomplete} for r in rows]

    low, high = date(2000, 8, 1), date(2027, 3, 31)
    if draw(st.booleans()):
        start, end = date(2000, 11, 1), date(2026, 11, 30)
    else:
        a = draw(st.dates(min_value=low, max_value=high))
        b = draw(st.dates(min_value=low, max_value=high))
        start, end = min(a, b), max(a, b)
    return Case(flagged, incomplete, start, end)


def _grid(rows: list[Row]) -> GridArrays:
    return build_grid_arrays(grid_table(rows), RECORD_START_TEXT, (EXCLUDED_CELL_ID,))


def _run(case: Case, rows: list[Row] | None = None) -> AreaResult:
    grid = _grid(case.rows if rows is None else rows)
    return compute_area_result(grid, FULL_AREA, case.start, case.end, record_start=START)


def _build(case: Case) -> GridArrays:
    try:
        return _grid(case.rows)
    except GridDataError:
        assume(False)
        raise


def _oracle_sums(rows: list[Row]) -> dict[int, float]:
    """Per-month sum of `count_harmonized` over all rows (the area covers every cell)."""
    sums: dict[int, list[float]] = defaultdict(list)
    for r in rows:
        sums[_n(r["year"], r["month"])].append(r["count_harmonized"])
    return {n: math.fsum(v) for n, v in sums.items()}


def _complete_months(case: Case) -> list[int]:
    """In-record complete months from the record start to the last month with a row."""
    last = max(_n(r["year"], r["month"]) for r in case.rows)
    return [n for n in range(START_N, last + 1) if n not in case.incomplete]


@given(case=cases())
def test_provisional_flag_equals_grid_incomplete_flag(case: Case) -> None:
    """`provisional` is the grid flag for every returned month, in the result and the response."""
    _build(case)
    result = _run(case)
    out = serialize_area_result(result)
    last = max(_n(r["year"], r["month"]) for r in case.rows)

    for rows_, label in ((result.months, "result"), (out.months, "response")):
        assert len(rows_) == len(result.months), label
        for m in rows_:
            n = _n(m.year, m.month)
            assert START_N <= n <= last
            assert m.provisional == (n in case.incomplete), label

    expected = [
        _label(_n(m.year, m.month)) for m in result.months if _n(m.year, m.month) in case.incomplete
    ]
    assert out.provisional_months == expected
    assert [str(ym) for ym in result.provisional_months] == expected
    # Every incomplete month in the date range and the record is reported.
    first_n = max(_n(case.start.year, case.start.month), START_N)
    last_n = min(_n(case.end.year, case.end.month), last)
    assert expected == [_label(n) for n in sorted(case.incomplete) if first_n <= n <= last_n]


@given(case=cases())
def test_provisional_months_and_years_have_null_anomaly_and_bounds(case: Case) -> None:
    """No anomaly for a provisional month or a year containing one, and bounds always null."""
    _build(case)
    result = _run(case)
    out = serialize_area_result(result)

    for m in (*result.months, *out.months):
        assert m.lower_bound is None
        assert m.upper_bound is None
        if m.provisional:
            assert m.anomaly is None

    provisional_years = {m.year for m in result.months if m.provisional}
    for y in (*result.years, *out.years):
        assert y.provisional == (y.year in provisional_years)
        if y.year in provisional_years:
            assert y.anomaly is None


@given(case=cases())
def test_provisional_months_never_enter_series_or_baselines(case: Case) -> None:
    """Baseline `n_years` and `values` come from complete months only, matching the oracle."""
    grid = _build(case)
    result = _run(case)
    complete = _complete_months(case)
    sums = _oracle_sums(case.rows)

    # Zero-filled series: exactly the in-record complete months, none of the provisional ones.
    series = zero_filled_series(
        grid.harm,
        select_cells(grid.centre_lat, grid.centre_lon, FULL_AREA),
        grid.months,
        ~grid.incomplete,
        START,
        raw_modis=grid.raw_modis,
        raw_viirs=grid.raw_viirs,
        frp_sum=grid.frp_sum,
        frp_known=grid.frp_known,
    )
    assert [_n(m.year, m.month) for m in series.months] == complete
    assert {_n(p.month.year, p.month.month) for p in series.provisional} == case.incomplete

    # Monthly baselines.
    for month in range(1, 13):
        expected = [sums.get(n, 0.0) for n in complete if n % 12 == month - 1]
        baseline = result.baseline_by_month[month]
        assert baseline.n_years == len(expected)
        assert list(baseline.values) == pytest.approx(expected, abs=1e-9, rel=1e-9)

    # Year baseline: only calendar years whose 12 months are all complete and in the record.
    complete_set = set(complete)
    years = [y for y in range(2000, 2028) if all(_n(y, k) in complete_set for k in range(1, 13))]
    assert result.baseline_year.n_years == len(years)


@given(case=cases(), factor=st.floats(min_value=2.0, max_value=50.0), shift=st.floats(1.0, 100.0))
def test_baselines_unchanged_when_provisional_counts_change(
    case: Case, factor: float, shift: float
) -> None:
    """Changing the counts of provisional months leaves every baseline value unchanged."""
    assume(case.incomplete)
    _build(case)
    changed = [
        {**r, "count_harmonized": r["count_harmonized"] * factor + shift} if r["incomplete"] else r
        for r in case.rows
    ]
    before = _run(case)
    after = _run(case, changed)

    for month in range(1, 13):
        b, a = before.baseline_by_month[month], after.baseline_by_month[month]
        assert a == b
        assert a.values == b.values
    assert after.baseline_year == before.baseline_year
    assert after.baseline_year.values == before.baseline_year.values

    # The provisional month itself is reported (flagged), not dropped, and has no anomaly.
    assert after.provisional_months == before.provisional_months
    assert all(m.anomaly is None for m in after.months if m.provisional)


def test_example_latest_month_is_provisional() -> None:
    """Example: 2026-11 is incomplete, reported with a null anomaly, absent from its baseline."""
    rows = [make_grid_row(340, -1181, y, 11, float(y % 7 + 1)) for y in range(2001, 2026)]
    rows.append(make_grid_row(340, -1181, 2026, 11, 1000.0))  # flagged incomplete by default
    case = Case(rows, frozenset({_n(2026, 11)}), date(2025, 11, 1), date(2026, 11, 30))
    result = _run(case)
    out = serialize_area_result(result)

    latest = out.months[-1]
    assert (latest.year, latest.month, latest.provisional) == (2026, 11, True)
    assert latest.anomaly is None
    assert (latest.lower_bound, latest.upper_bound) == (None, None)
    assert out.provisional_months == ["2026-11"]
    assert out.years[-1].provisional is True
    assert out.years[-1].anomaly is None
    # November baseline has the 2000 to 2025 complete months (2000-11 is zero-filled), not 2026.
    assert result.baseline_by_month[11].n_years == 26
    assert max(result.baseline_by_month[11].values) < 1000.0
    assert np.isfinite(latest.harmonized)

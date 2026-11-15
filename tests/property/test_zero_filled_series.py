# Feature: harmonized-fire-calendar, Property 56: Zero-filled area series
"""Property 56: for any grid, area and set of in-record complete months, the area series has
exactly one value per month, in order, equals the sum of `count_harmonized` over the selected
cells for months with rows, equals 0.0 for months with no row in the area, never includes
months before `RECORD_START` or incomplete months, and its length equals the number of
in-record complete months.

The expected values come from an independent oracle over the sparse rows (a LEFT JOIN of the
calendar of in-record complete months with the per-month area sums, missing filled with 0), not
from the dense arrays. Every row is synthetic (TEST FIXTURE, not NASA data).

**Validates: Requirements 9.8, 9.11, 9.12, 10.1**
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass
from typing import Any

import numpy as np
import pyarrow as pa
import pytest
from hypothesis import given
from hypothesis import strategies as st
from shapely.geometry import Polygon, box

from hotspots.areastats import select_cells, zero_filled_series
from hotspots.data.grid import GridArrays, build_grid_arrays
from hotspots.data.types import YearMonth
from tests.fixtures import (
    EXCLUDED_CELL_ID,
    EXCLUDED_CELL_INDEX,
    RECORD_START,
    grid_table,
    make_grid_row,
)
from tests.property.strategies.grids import (
    LAT_IDX_RANGE,
    LON_IDX_RANGE,
    cells,
    counts,
    grids,
    year_months,
)

RECORD_START_TEXT = f"{RECORD_START[0]:04d}-{RECORD_START[1]:02d}"
START = YearMonth(*RECORD_START)
START_N = RECORD_START[0] * 12 + RECORD_START[1] - 1
FULL_AREA = box(-125.0, 32.0, -113.0, 43.0)

Row = dict[str, Any]


def _n(year: int, month: int) -> int:
    """Months since year 0, for plain integer month arithmetic in the oracle."""
    return year * 12 + month - 1


def _ym(n: int) -> tuple[int, int]:
    year, month0 = divmod(n, 12)
    return year, month0 + 1


@dataclass(frozen=True)
class Case:
    """Sparse rows plus which `frp_sum` values are null, and the area as cell-index bounds."""

    rows: list[Row]
    frp_null: frozenset[int]
    lat_lo: int
    lat_hi: int
    lon_lo: int
    lon_hi: int

    @property
    def polygon(self) -> Polygon:
        """Rectangle on cell edges, so no cell centre ever lies on its boundary."""
        return box(self.lon_lo / 10, self.lat_lo / 10, self.lon_hi / 10, self.lat_hi / 10)

    def selects(self, cell_id: str) -> bool:
        """Oracle selection, from the SW corner index in the cell id (not from the grid)."""
        lat_text, lon_text = cell_id.split("_")
        lat_idx, lon_idx = round(float(lat_text) * 10), round(float(lon_text) * 10)
        return self.lat_lo <= lat_idx < self.lat_hi and self.lon_lo <= lon_idx < self.lon_hi


@st.composite
def areas(draw: st.DrawFn) -> tuple[int, int, int, int]:
    """Cell-index bounds `(lat_lo, lat_hi, lon_lo, lon_hi)` with lo < hi, half-open."""
    full = (LAT_IDX_RANGE[0], LAT_IDX_RANGE[1] + 1, LON_IDX_RANGE[0], LON_IDX_RANGE[1] + 1)
    if draw(st.booleans()):
        return full
    lat_lo = draw(st.integers(min_value=full[0], max_value=full[1] - 1))
    lat_hi = draw(st.integers(min_value=lat_lo + 1, max_value=full[1]))
    lon_lo = draw(st.integers(min_value=full[2], max_value=full[3] - 1))
    lon_hi = draw(st.integers(min_value=lon_lo + 1, max_value=full[3]))
    return lat_lo, lat_hi, lon_lo, lon_hi


@st.composite
def cases(draw: st.DrawFn) -> Case:
    """Grid rows with October 2000, excluded-cell rows, extra incomplete months and null FRP."""
    rows = list(draw(grids()))
    # October 2000 rows: before RECORD_START, must never appear.
    for lat_idx, lon_idx in draw(st.lists(cells(), max_size=3, unique=True)):
        rows.append(make_grid_row(lat_idx, lon_idx, 2000, 10, draw(counts())))
    # Rows of the excluded cell in complete months, with a large count.
    for year, month in draw(st.lists(year_months(max_ym=(2026, 10)), max_size=3, unique=True)):
        rows.append(make_grid_row(*EXCLUDED_CELL_INDEX, year, month, 50.0, incomplete=False))
    # Extra incomplete months beyond the latest one.
    for k in draw(st.lists(st.integers(min_value=0, max_value=max(len(rows) - 1, 0)), max_size=3)):
        if rows:
            rows[k] = {**rows[k], "incomplete": True}
    rows = draw(st.permutations(rows))
    frp_null = draw(st.sets(st.integers(min_value=0, max_value=max(len(rows) - 1, 0)), max_size=4))
    frp_null = {k for k in frp_null if k < len(rows)}
    lat_lo, lat_hi, lon_lo, lon_hi = draw(areas())
    return Case(rows, frozenset(frp_null), lat_lo, lat_hi, lon_lo, lon_hi)


def _table(case: Case) -> pa.Table:
    table = grid_table(case.rows)
    frp = [None if k in case.frp_null else r["frp_sum"] for k, r in enumerate(case.rows)]
    index = table.schema.get_field_index("frp_sum")
    return table.set_column(index, "frp_sum", pa.array(frp, type=pa.float64()))


@dataclass
class Expected:
    """Oracle result: calendar of in-record complete months plus the provisional months."""

    months: list[tuple[int, int]]
    harmonized: list[float]
    raw_modis: list[int]
    raw_viirs: list[int]
    frp: list[float | None]
    provisional: dict[tuple[int, int], tuple[float, int, int, float | None]]


def oracle(
    case: Case,
    calendar_rows: list[tuple[int, Row]],
    sum_excluded: frozenset[str] = frozenset(),
) -> Expected:
    """LEFT JOIN of the in-record complete calendar with per-month area sums, zero filled.

    `calendar_rows` are the `(position, row)` pairs that define the span of months and which
    months are incomplete (any row flagged incomplete makes the month incomplete). Sums use the
    rows the area selects, except cells in `sum_excluded`.
    """
    harm: dict[int, list[float]] = defaultdict(list)
    modis: dict[int, int] = defaultdict(int)
    viirs: dict[int, int] = defaultdict(int)
    frp: dict[int, list[float]] = defaultdict(list)
    incomplete: set[int] = set()
    last = START_N - 1
    for position, row in calendar_rows:
        n = _n(row["year"], row["month"])
        if n < START_N:
            continue
        last = max(last, n)
        if row["incomplete"]:
            incomplete.add(n)
        if case.selects(row["cell_id"]) and row["cell_id"] not in sum_excluded:
            harm[n].append(row["count_harmonized"])
            modis[n] += row["count_raw_modis"]
            viirs[n] += row["count_raw_viirs"]
            if position not in case.frp_null:
                frp[n].append(row["frp_sum"])

    def frp_total(n: int) -> float | None:
        return math.fsum(frp[n]) if frp[n] else None

    expected = Expected([], [], [], [], [], {})
    for n in range(START_N, last + 1):
        if n in incomplete:
            expected.provisional[_ym(n)] = (
                math.fsum(harm[n]),
                modis[n],
                viirs[n],
                frp_total(n),
            )
            continue
        expected.months.append(_ym(n))
        expected.harmonized.append(math.fsum(harm[n]))
        expected.raw_modis.append(modis[n])
        expected.raw_viirs.append(viirs[n])
        expected.frp.append(frp_total(n))
    return expected


def _series(grid: GridArrays, mask: np.ndarray) -> Any:
    return zero_filled_series(
        grid.harm,
        mask,
        grid.months,
        ~grid.incomplete,
        START,
        raw_modis=grid.raw_modis,
        raw_viirs=grid.raw_viirs,
        frp_sum=grid.frp_sum,
        frp_known=grid.frp_known,
    )


def _check(series: Any, expected: Expected) -> None:
    n = len(expected.months)
    assert [tuple(m) for m in series.months] == expected.months
    assert len(series.months) == n
    assert series.harmonized.shape == series.raw_modis.shape == series.frp_sum_mw.shape == (n,)
    assert series.raw_viirs.shape == (n,)
    assert series.harmonized.tolist() == pytest.approx(expected.harmonized, rel=1e-9, abs=1e-9)
    assert series.raw_modis.tolist() == expected.raw_modis
    assert series.raw_viirs.tolist() == expected.raw_viirs
    for got, want in zip(series.frp_sum_mw.tolist(), expected.frp, strict=True):
        if want is None:
            assert math.isnan(got)
        else:
            assert got == pytest.approx(want, rel=1e-9, abs=1e-9)
    got_prov = {tuple(p.month): p for p in series.provisional}
    assert set(got_prov) == set(expected.provisional)
    for key, (harmonized, modis, viirs, frp) in expected.provisional.items():
        p = got_prov[key]
        assert p.harmonized == pytest.approx(harmonized, rel=1e-9, abs=1e-9)
        assert (p.raw_modis, p.raw_viirs) == (modis, viirs)
        if frp is None:
            assert p.frp_sum_mw is None
        else:
            assert p.frp_sum_mw == pytest.approx(frp, rel=1e-9, abs=1e-9)
    # Never an incomplete or pre-record month in the series.
    assert not set(got_prov) & {tuple(m) for m in series.months}
    assert all(m >= START for m in series.months)


def _grid_and_mask(
    case: Case, record_start: str, excluded: tuple[str, ...]
) -> tuple[GridArrays, np.ndarray] | None:
    """Dense grid and the area mask. None when the grid would be empty (nothing to test)."""
    keep = [r for r in case.rows if r["cell_id"] not in excluded]
    if not any(_n(r["year"], r["month"]) >= _n(*map(int, record_start.split("-"))) for r in keep):
        return None
    grid = build_grid_arrays(_table(case), record_start, excluded)
    excluded_mask = np.array([cid == EXCLUDED_CELL_ID for cid in grid.cell_ids], dtype=np.bool_)
    mask = select_cells(grid.centre_lat, grid.centre_lon, case.polygon, excluded_mask)
    return grid, mask


@given(case=cases())
def test_series_equals_oracle_with_excluded_cell_and_october_dropped_at_load(case: Case) -> None:
    """Excluded cell dropped at load, October 2000 kept in the grid and dropped by the series."""
    built = _grid_and_mask(case, "2000-10", (EXCLUDED_CELL_ID,))
    if built is None:
        return
    grid, mask = built
    assert EXCLUDED_CELL_ID not in grid.cell_ids
    calendar = [(k, r) for k, r in enumerate(case.rows) if r["cell_id"] != EXCLUDED_CELL_ID]
    expected = oracle(case, calendar)
    series = _series(grid, mask)
    _check(series, expected)
    # October 2000 is on the grid axis but never in the series or the provisional list.
    assert grid.months[0] == YearMonth(2000, 10)
    assert YearMonth(2000, 10) not in series.months
    assert all(p.month != YearMonth(2000, 10) for p in series.provisional)


@given(case=cases())
def test_series_equals_oracle_with_record_start_applied_at_load(case: Case) -> None:
    built = _grid_and_mask(case, RECORD_START_TEXT, (EXCLUDED_CELL_ID,))
    if built is None:
        return
    grid, mask = built
    calendar = [(k, r) for k, r in enumerate(case.rows) if r["cell_id"] != EXCLUDED_CELL_ID]
    _check(_series(grid, mask), oracle(case, calendar))


@given(case=cases())
def test_excluded_cell_never_contributes_when_masked_instead_of_dropped(case: Case) -> None:
    """The excluded cell stays on the grid here, and `select_cells` keeps it out of every sum."""
    built = _grid_and_mask(case, RECORD_START_TEXT, ())
    if built is None:
        return
    grid, mask = built
    if EXCLUDED_CELL_ID in grid.cell_ids:
        assert not mask[grid.cell_ids.index(EXCLUDED_CELL_ID)]
    # The calendar and incomplete flags come from every row, the sums from the other cells only.
    everyone = list(enumerate(case.rows))
    _check(_series(grid, mask), oracle(case, everyone, sum_excluded=frozenset({EXCLUDED_CELL_ID})))


@given(case=cases())
def test_empty_selection_gives_zeros_for_every_in_record_complete_month(case: Case) -> None:
    built = _grid_and_mask(case, RECORD_START_TEXT, (EXCLUDED_CELL_ID,))
    if built is None:
        return
    grid, _ = built
    none = np.zeros(grid.n_cells, dtype=np.bool_)
    series = _series(grid, none)
    complete_in_record = [m for m, inc in zip(grid.months, grid.incomplete, strict=True) if not inc]
    assert series.months == complete_in_record
    assert len(series.months) == int((~grid.incomplete).sum())
    assert not series.harmonized.any()
    assert series.harmonized.tolist() == [0.0] * len(series.months)
    assert not series.raw_modis.any()
    assert not series.raw_viirs.any()
    assert np.isnan(series.frp_sum_mw).all()
    assert all(p.harmonized == 0.0 and p.frp_sum_mw is None for p in series.provisional)


@given(case=cases())
def test_empty_polygon_outside_the_data_selects_nothing_and_gives_zeros(case: Case) -> None:
    built = _grid_and_mask(case, RECORD_START_TEXT, (EXCLUDED_CELL_ID,))
    if built is None:
        return
    grid, _ = built
    far = select_cells(grid.centre_lat, grid.centre_lon, box(0.0, 0.0, 1.0, 1.0))
    assert not far.any()
    series = _series(grid, far)
    assert not series.harmonized.any()
    assert len(series.months) == int((~grid.incomplete).sum())


@given(case=cases())
def test_whole_area_series_sums_every_cell_and_month_counts_match(case: Case) -> None:
    """Selecting everything: the series total plus provisional total is the sparse total."""
    built = _grid_and_mask(case, RECORD_START_TEXT, (EXCLUDED_CELL_ID,))
    if built is None:
        return
    grid, _ = built
    mask = select_cells(grid.centre_lat, grid.centre_lon, FULL_AREA)
    series = _series(grid, mask)
    in_record = [r for r in case.rows if r["cell_id"] != EXCLUDED_CELL_ID]
    in_record = [r for r in in_record if _n(r["year"], r["month"]) >= START_N]
    total = math.fsum(r["count_harmonized"] for r in in_record)
    got = math.fsum(series.harmonized.tolist()) + math.fsum(
        p.harmonized for p in series.provisional
    )
    assert got == pytest.approx(total, rel=1e-9, abs=1e-9)


def test_example_missing_month_is_zero_and_provisional_is_separate() -> None:
    """Example: 2000-12 has no row (zero) and 2001-02 is provisional (kept out of the series)."""
    rows = [
        make_grid_row(340, -1181, 2000, 10, 1.0),
        make_grid_row(340, -1181, 2000, 11, 2.0),
        make_grid_row(340, -1181, 2001, 1, 4.0),
        make_grid_row(340, -1181, 2001, 2, 8.0, incomplete=True),
        make_grid_row(*EXCLUDED_CELL_INDEX, 2000, 12, 50.0, incomplete=False),
    ]
    grid = build_grid_arrays(grid_table(rows), "2000-10", (EXCLUDED_CELL_ID,))
    mask = select_cells(grid.centre_lat, grid.centre_lon, box(-119.0, 33.0, -118.0, 35.0))
    series = _series(grid, mask)
    assert series.months == [YearMonth(2000, 11), YearMonth(2000, 12), YearMonth(2001, 1)]
    assert series.harmonized.tolist() == [2.0, 0.0, 4.0]
    assert [(p.month, p.harmonized) for p in series.provisional] == [(YearMonth(2001, 2), 8.0)]

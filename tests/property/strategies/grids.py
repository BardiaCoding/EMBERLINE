"""Hypothesis generators for sparse grid rows. All values are synthetic (not NASA data).

`grids()` draws rows with the contract schema (see `tests/fixtures.py`). Zero rows are omitted,
as in the delivered grid (a missing row means zero cell-days).
"""

from __future__ import annotations

from typing import Any

from hypothesis import strategies as st

from tests.fixtures import (
    EXCLUDED_CELL_INDEX,
    LATEST_MONTH,
    RECORD_START,
    make_grid_row,
)

# Measured extent: cells span lat 32.5 to 42.2 and lon -124.4 to -114.0 (SW corners plus 0.1).
LAT_IDX_RANGE = (325, 421)
LON_IDX_RANGE = (-1244, -1141)


def _ym_index(year: int, month: int) -> int:
    return year * 12 + (month - 1)


def year_months(
    min_ym: tuple[int, int] = RECORD_START,
    max_ym: tuple[int, int] = LATEST_MONTH,
) -> st.SearchStrategy[tuple[int, int]]:
    """`(year, month)` tuples between `min_ym` and `max_ym`, inclusive.

    The defaults span the in-record months (2000-11 to 2026-11). Pass `(2000, 10)` as `min_ym`
    to include October 2000.
    """
    low, high = _ym_index(*min_ym), _ym_index(*max_ym)
    return st.integers(min_value=low, max_value=high).map(lambda i: (i // 12, i % 12 + 1))


def cells(
    lat_range: tuple[int, int] = LAT_IDX_RANGE,
    lon_range: tuple[int, int] = LON_IDX_RANGE,
    *,
    include_excluded: bool = False,
) -> st.SearchStrategy[tuple[int, int]]:
    """`(lat_idx, lon_idx)` of a 0.1 degree cell, in units of 0.1 degree."""
    strategy = st.tuples(
        st.integers(min_value=lat_range[0], max_value=lat_range[1]),
        st.integers(min_value=lon_range[0], max_value=lon_range[1]),
    )
    if include_excluded:
        return strategy
    return strategy.filter(lambda c: c != EXCLUDED_CELL_INDEX)


def counts() -> st.SearchStrategy[float]:
    """Positive cell-day counts: whole numbers (native) or fractions (calibrated)."""
    whole = st.integers(min_value=1, max_value=500).map(float)
    fraction = st.floats(min_value=0.25, max_value=500.0, allow_nan=False, allow_infinity=False)
    return st.one_of(whole, fraction)


@st.composite
def grids(
    draw: st.DrawFn,
    max_cells: int = 6,
    max_rows_per_cell: int = 12,
    min_ym: tuple[int, int] = RECORD_START,
    max_ym: tuple[int, int] = LATEST_MONTH,
) -> list[dict[str, Any]]:
    """Sparse grid rows with the contract schema. Zero rows are omitted.

    Each (cell, year, month) appears at most once. The latest month (2026-11) is flagged
    `incomplete`. Some calibrated rows have a null `frp_mean`. The excluded cell is not drawn
    (build it by hand to test exclusion). Lat/lon float noise comes from `cell_coords`.
    """
    cell_list = draw(st.lists(cells(), min_size=0, max_size=max_cells, unique=True))
    rows: list[dict[str, Any]] = []
    for lat_idx, lon_idx in cell_list:
        months = draw(
            st.lists(
                year_months(min_ym, max_ym),
                min_size=1,
                max_size=max_rows_per_cell,
                unique=True,
            )
        )
        for year, month in sorted(months):
            rows.append(
                make_grid_row(
                    lat_idx,
                    lon_idx,
                    year,
                    month,
                    draw(counts()),
                    frp_mean_null=draw(st.booleans()),
                )
            )
    return rows

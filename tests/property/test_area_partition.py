# Feature: harmonized-fire-calendar, Property 21: Area partition (spatial)
"""Property 21: for any grid and any rectangle split into non-overlapping parts along lines
(including lines through cell centres), the unrounded `harmonized` sum of the whole equals the
sum of the parts within an absolute tolerance of 1e-6 for every month, the raw MODIS and raw
VIIRS cell-days equal the sum of the parts exactly, and no cell is selected in two parts.

Areas come from `rect_splits()` (lattice lines, shared edges) and from a second generator whose
cut lines are multiples of 0.05 degree, so odd multiples run exactly through 0.1 degree cell
centres. Every row is synthetic (TEST FIXTURE, not NASA data).

**Validates: Requirements 9.1, 9.2, 9.3, 9.7**
"""

from __future__ import annotations

import calendar
import math
from datetime import date
from typing import Any

import numpy as np
from hypothesis import given
from hypothesis import strategies as st
from shapely.geometry import Polygon, box

from hotspots.areastats import AreaResult, compute_area_result, select_cells
from hotspots.data.grid import GridArrays, build_grid_arrays
from tests.fixtures import RECORD_START, grid_table, make_grid_row
from tests.property.strategies.geometry import rect_splits
from tests.property.strategies.grids import cells, counts, year_months

RECORD_START_TEXT = f"{RECORD_START[0]:04d}-{RECORD_START[1]:02d}"
TOLERANCE = 1e-6

# Cell indices (units of 0.1 degree) around the lattice region of `strategies/geometry.py`
# (lon -120.0 to -119.5, lat 36.0 to 36.5), one cell wider on every side.
REGION_LAT = (359, 365)
REGION_LON = (-1201, -1195)

Row = dict[str, Any]


@st.composite
def region_rows(draw: st.DrawFn) -> list[Row]:
    """Sparse synthetic grid rows for cells in and just around the lattice region."""
    cell_list = draw(st.lists(cells(REGION_LAT, REGION_LON), min_size=1, max_size=14, unique=True))
    rows: list[Row] = []
    for lat_idx, lon_idx in cell_list:
        months = draw(st.lists(year_months(), min_size=1, max_size=10, unique=True))
        for year, month in sorted(months):
            rows.append(make_grid_row(lat_idx, lon_idx, year, month, draw(counts())))
    return rows


def _grid(rows: list[Row]) -> GridArrays:
    return build_grid_arrays(grid_table(rows), RECORD_START_TEXT)


def _range(grid: GridArrays) -> tuple[date, date]:
    """Whole record held by the grid, first day of the first month to last day of the last."""
    first, last = grid.months[0], grid.months[-1]
    return date(first.year, first.month, 1), date(
        last.year, last.month, calendar.monthrange(last.year, last.month)[1]
    )


def assert_partition(grid: GridArrays, whole: Polygon, parts: list[Polygon]) -> AreaResult:
    """Parts select disjoint cells that add up to the whole, and every month adds up."""
    whole_mask = select_cells(grid.centre_lat, grid.centre_lon, whole)
    part_masks = [select_cells(grid.centre_lat, grid.centre_lon, p) for p in parts]
    times_selected = np.sum([m.astype(int) for m in part_masks], axis=0)
    assert times_selected.max(initial=0) <= 1, "a cell is selected in two parts"
    assert (times_selected == whole_mask.astype(int)).all(), "parts do not cover the whole"

    start, end = _range(grid)
    total = compute_area_result(grid, whole, start, end)
    results = [compute_area_result(grid, p, start, end) for p in parts]

    assert sum(r.n_cells for r in results) == total.n_cells == int(whole_mask.sum())
    for r in results:
        assert len(r.months) == len(total.months)
    for i, month in enumerate(total.months):
        pieces = [r.months[i] for r in results]
        assert all((p.year, p.month) == (month.year, month.month) for p in pieces)
        assert abs(math.fsum(p.harmonized for p in pieces) - month.harmonized) <= TOLERANCE
        assert sum(p.raw_modis for p in pieces) == month.raw_modis
        assert sum(p.raw_viirs for p in pieces) == month.raw_viirs
    return total


@given(rows=region_rows(), split=rect_splits())
def test_lattice_split_parts_add_up_to_the_whole(
    rows: list[Row], split: tuple[Polygon, list[Polygon]]
) -> None:
    whole, parts = split
    assert 2 <= len(parts) <= 4
    assert_partition(_grid(rows), whole, parts)


@st.composite
def centre_line_splits(draw: st.DrawFn) -> tuple[Polygon, list[Polygon]]:
    """Rectangle on multiples of 0.05 degree, split once or twice on such lines.

    Odd multiples of 0.05 are cell centres of the 0.1 degree grid, so cuts there run exactly
    through centres. Lon -120.0 is unit -2400 and lat 36.0 is unit 720.
    """
    west = draw(st.integers(min_value=-2402, max_value=-2392))
    south = draw(st.integers(min_value=718, max_value=728))
    east = west + draw(st.integers(min_value=2, max_value=10))
    north = south + draw(st.integers(min_value=2, max_value=10))
    x_cuts = sorted(draw(st.sets(st.integers(west + 1, east - 1), min_size=0, max_size=1)))
    y_cuts = sorted(draw(st.sets(st.integers(south + 1, north - 1), min_size=0, max_size=1)))
    if not x_cuts and not y_cuts:
        x_cuts = [draw(st.integers(west + 1, east - 1))]
    xs, ys = [west, *x_cuts, east], [south, *y_cuts, north]

    def edge(unit: int) -> float:
        return round(unit * 0.05, 6)

    parts = [
        box(edge(xs[i]), edge(ys[j]), edge(xs[i + 1]), edge(ys[j + 1]))
        for i in range(len(xs) - 1)
        for j in range(len(ys) - 1)
    ]
    return box(edge(west), edge(south), edge(east), edge(north)), parts


@given(rows=region_rows(), split=centre_line_splits())
def test_split_through_cell_centres_adds_up_to_the_whole(
    rows: list[Row], split: tuple[Polygon, list[Polygon]]
) -> None:
    whole, parts = split
    assert_partition(_grid(rows), whole, parts)


def test_example_vertical_cut_through_two_cell_centres() -> None:
    """Four cells in a 2 x 2 block; the cut at lon -119.95 passes through two centres."""
    rows = [
        make_grid_row(lat_idx, lon_idx, 2015, 6, 10.0 * (k + 1))
        for k, (lat_idx, lon_idx) in enumerate(
            [(360, -1200), (360, -1199), (361, -1200), (361, -1199)]
        )
    ]
    grid = _grid(rows)
    whole = box(-120.0, 36.0, -119.8, 36.2)
    parts = [box(-120.0, 36.0, -119.95, 36.2), box(-119.95, 36.0, -119.8, 36.2)]
    total = assert_partition(grid, whole, parts)
    june_2015 = next(m for m in total.months if (m.year, m.month) == (2015, 6))
    assert total.n_cells == 4
    assert june_2015.harmonized == 100.0

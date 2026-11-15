"""Unit tests for `build_grid_arrays` (pure, no DuckDB).

Every row comes from `tests/fixtures.py`: TEST FIXTURE, not NASA data.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pyarrow as pa
import pytest

from hotspots.data import GridArrays, GridDataError, YearMonth, build_grid_arrays
from hotspots.data.grid import GRID_COLUMNS
from tests.fixtures import (
    EXCLUDED_CELL_ID,
    LATEST_MONTH,
    RECORD_START,
    default_grid_rows,
    grid_table,
    make_grid_row,
)

RECORD_START_TEXT = f"{RECORD_START[0]:04d}-{RECORD_START[1]:02d}"
EXPECTED_CELLS = [
    "32.5000_-114.6000",
    "34.0000_-118.1000",
    "34.1000_-118.1000",
    "37.5000_-120.5000",
]
EXPECTED_MONTHS = (LATEST_MONTH[0] - 2000) * 12 + LATEST_MONTH[1] - RECORD_START[1] + 1


def _default_grid() -> GridArrays:
    return build_grid_arrays(grid_table(default_grid_rows()), RECORD_START_TEXT, [EXCLUDED_CELL_ID])


def _col(g: GridArrays, ym: YearMonth) -> int:
    """Column of a month in the dense arrays."""
    return int(ym.index - g.month_index[0])


def _row(g: GridArrays, cell_id: str) -> int:
    return g.cell_ids.index(cell_id)


def test_default_fixture_loads_to_expected_shapes() -> None:
    g = _default_grid()
    assert g.cell_ids == EXPECTED_CELLS
    assert g.n_cells == 4
    assert g.n_months == EXPECTED_MONTHS == 313
    for matrix in (g.harm, g.raw_modis, g.raw_viirs, g.frp_sum, g.frp_known):
        assert matrix.shape == (4, 313)
    assert g.centre_lat.shape == g.centre_lon.shape == (4,)
    assert g.month_index.shape == g.incomplete.shape == (313,)
    assert len(g.source_flag) == len(g.calib_model) == len(g.provenance) == 313
    assert g.harm.dtype == np.float64
    assert g.raw_modis.dtype == g.raw_viirs.dtype == np.int32


def test_months_are_contiguous_from_record_start_to_latest() -> None:
    g = _default_grid()
    assert g.months[0] == YearMonth(*RECORD_START)
    assert g.months[-1] == YearMonth(*LATEST_MONTH)
    assert (np.diff(g.month_index) == 1).all()


def test_missing_sparse_rows_are_zero_and_dense_values_match_rows() -> None:
    g = _default_grid()
    kept = [
        r
        for r in default_grid_rows()
        if r["cell_id"] != EXCLUDED_CELL_ID and (r["year"], r["month"]) >= RECORD_START
    ]
    assert len(kept) == 13
    for r in kept:
        i, j = _row(g, r["cell_id"]), _col(g, YearMonth(r["year"], r["month"]))
        assert g.harm[i, j] == r["count_harmonized"]
        assert g.raw_modis[i, j] == r["count_raw_modis"]
        assert g.raw_viirs[i, j] == r["count_raw_viirs"]
        assert g.frp_sum[i, j] == r["frp_sum"]
        assert g.frp_known[i, j]
    assert np.count_nonzero(g.harm) == len(kept)  # every other cell-month is a zero
    assert g.harm.sum() == pytest.approx(sum(r["count_harmonized"] for r in kept))
    assert not g.frp_known[_row(g, "34.0000_-118.1000"), _col(g, YearMonth(2005, 1))]


def test_excluded_cell_never_appears() -> None:
    g = _default_grid()
    assert EXCLUDED_CELL_ID not in g.cell_ids
    # Without the exclusion the cell is present, so the exclusion is what removes it.
    unfiltered = build_grid_arrays(grid_table(default_grid_rows()), RECORD_START_TEXT, ())
    assert EXCLUDED_CELL_ID in unfiltered.cell_ids
    assert unfiltered.n_cells == 5


def test_october_2000_never_appears() -> None:
    g = _default_grid()
    assert YearMonth(2000, 10) not in g.months
    assert g.months[0] == YearMonth(2000, 11)
    assert g.harm[_row(g, "34.0000_-118.1000"), 0] == 2.0  # the 2000-11 row, not the Oct row
    # Without the record start the October row is kept, so the record start removes it.
    early = build_grid_arrays(grid_table(default_grid_rows()), "2000-10", [EXCLUDED_CELL_ID])
    assert early.months[0] == YearMonth(2000, 10)
    assert early.harm[_row(early, "34.0000_-118.1000"), 0] == 1.0


def test_incomplete_flag_only_on_latest_month() -> None:
    g = _default_grid()
    assert g.incomplete[-1]
    assert int(g.incomplete.sum()) == 1
    assert g.months[int(np.flatnonzero(g.incomplete)[0])] == YearMonth(*LATEST_MONTH)


def test_incomplete_excluded_cell_row_does_not_mark_its_month() -> None:
    rows = [make_grid_row(340, -1181, 2026, 10, 4.0), make_grid_row(340, -1181, 2026, 11, 3.0)]
    rows[1]["incomplete"] = False
    rows.append(make_grid_row(387, -1174, 2026, 11, 0.0, incomplete=True))  # excluded cell
    g = build_grid_arrays(grid_table(rows), RECORD_START_TEXT, [EXCLUDED_CELL_ID])
    assert not g.incomplete.any()


def test_months_without_rows_have_no_labels() -> None:
    g = _default_grid()
    j = _col(g, YearMonth(2005, 1))
    assert (g.source_flag[j], g.calib_model[j], g.provenance[j]) == (None, None, None)
    assert not g.harm[:, j].any()


def test_month_labels_come_from_rows() -> None:
    g = _default_grid()
    native = _col(g, YearMonth(2001, 7))
    assert g.source_flag[native] == "native"
    assert g.calib_model[native] == "none"
    assert g.provenance[native] == "Aqua+Terra"
    calibrated = _col(g, YearMonth(2012, 7))
    assert g.source_flag[calibrated] == "calibrated"
    assert g.calib_model[calibrated] == "quantile_map"
    assert g.provenance[calibrated] == "N20+N21+SNPP"


def test_cell_centre_is_sw_corner_plus_half_cell_despite_lon_noise() -> None:
    noisy = [r for r in default_grid_rows() if r["cell_id"] == "32.5000_-114.6000"]
    assert noisy[0]["disp_lon"] != -114.6  # precondition: -114.60000000000001
    g = _default_grid()
    i = _row(g, "32.5000_-114.6000")
    assert g.centre_lat[i] == pytest.approx(32.55, abs=1e-9)
    assert g.centre_lon[i] == pytest.approx(-114.55, abs=1e-9)


def test_join_is_on_cell_id_not_on_float_lon() -> None:
    clean = _default_grid()
    rows = default_grid_rows()
    for k, r in enumerate(rows):  # different float noise on every row, even within one cell
        r["disp_lon"] = r["disp_lon"] + (k % 3 - 1) * 1e-13
        r["disp_lat"] = r["disp_lat"] + (k % 2) * 1e-13
    g = build_grid_arrays(grid_table(rows), RECORD_START_TEXT, [EXCLUDED_CELL_ID])
    assert g.cell_ids == clean.cell_ids
    assert np.array_equal(g.harm, clean.harm)
    assert np.array_equal(g.raw_viirs, clean.raw_viirs)
    np.testing.assert_allclose(g.centre_lon, clean.centre_lon, atol=1e-6)
    np.testing.assert_allclose(g.centre_lat, clean.centre_lat, atol=1e-6)


def test_arrays_are_read_only() -> None:
    g = _default_grid()
    for arr in (g.harm, g.raw_modis, g.frp_sum, g.incomplete, g.centre_lat, g.month_index):
        with pytest.raises(ValueError, match="read-only"):
            arr[0] = arr[0]


def test_null_frp_sum_is_unknown_not_zero_mw() -> None:
    table = grid_table(default_grid_rows())
    values = table["frp_sum"].to_pylist()
    target = next(
        k
        for k, r in enumerate(default_grid_rows())
        if r["cell_id"] == "34.0000_-118.1000" and (r["year"], r["month"]) == (2001, 7)
    )
    values[target] = None
    table = table.set_column(table.schema.get_field_index("frp_sum"), "frp_sum", pa.array(values))
    g = build_grid_arrays(table, RECORD_START_TEXT, [EXCLUDED_CELL_ID])
    i, j = _row(g, "34.0000_-118.1000"), _col(g, YearMonth(2001, 7))
    assert not g.frp_known[i, j]
    assert g.frp_sum[i, j] == 0.0
    assert g.frp_known[i, _col(g, YearMonth(2012, 7))]
    assert g.harm[i, j] == 5.0  # the count is unaffected


def test_frp_mean_and_region_id_are_not_read() -> None:
    table = grid_table(default_grid_rows()).select(list(GRID_COLUMNS))
    assert "frp_mean" not in table.column_names
    assert "region_id" not in table.column_names
    g = build_grid_arrays(table, RECORD_START_TEXT, [EXCLUDED_CELL_ID])
    assert g.cell_ids == EXPECTED_CELLS


def test_duplicate_cell_month_raises() -> None:
    rows: list[dict[str, Any]] = [
        make_grid_row(340, -1181, 2001, 7, 5.0),
        make_grid_row(340, -1181, 2001, 7, 6.0),
    ]
    with pytest.raises(GridDataError, match="duplicate"):
        build_grid_arrays(grid_table(rows), RECORD_START_TEXT, ())


def test_no_rows_after_filtering_raises() -> None:
    only_excluded = [make_grid_row(387, -1174, 2026, 11, 0.0)]
    with pytest.raises(GridDataError, match="no grid rows"):
        build_grid_arrays(grid_table(only_excluded), RECORD_START_TEXT, [EXCLUDED_CELL_ID])
    only_early = [make_grid_row(340, -1181, 2000, 10, 1.0)]
    with pytest.raises(GridDataError, match="no grid rows"):
        build_grid_arrays(grid_table(only_early), RECORD_START_TEXT, ())

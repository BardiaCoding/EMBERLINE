"""Unit tests for `compute_area_result` (task 7.6).

The grid comes from `tests/fixtures.py`: TEST FIXTURE, not NASA data. Cell A (centre 34.05,
-118.05) has rows in 2000-10 (before the record), 2000-11, 2001-07, 2012-07, 2018-08, 2026-10 and
2026-11 (provisional). Cell B (centre 34.15, -118.05) has 2000-11, 2013-07 and 2026-11.
"""

from __future__ import annotations

import math
from datetime import date

import numpy as np
import pytest
from shapely.geometry import box

from hotspots.areastats import (
    NO_TYPICAL_FIRES_TEXT,
    NOTICE_NO_CELLS,
    AreaResult,
    MonthRow,
    compute_area_result,
    select_cells,
)
from hotspots.data import GridArrays, YearMonth, build_grid_arrays
from tests.fixtures import (
    EXCLUDED_CELL_ID,
    RECORD_START,
    default_grid_rows,
    grid_table,
)

RECORD_START_TEXT = f"{RECORD_START[0]:04d}-{RECORD_START[1]:02d}"
CELL_A = box(-118.1, 34.0, -118.0, 34.1)
CELLS_A_AND_B = box(-118.1, 34.0, -118.0, 34.2)
WHOLE_REGION = box(-125.0, 32.0, -113.0, 43.0)
FAR_AWAY = box(-122.0, 40.0, -121.9, 40.1)


@pytest.fixture(scope="module")
def grid() -> GridArrays:
    return build_grid_arrays(grid_table(default_grid_rows()), RECORD_START_TEXT, [EXCLUDED_CELL_ID])


def _month(result: AreaResult, year: int, month: int) -> MonthRow:
    return next(r for r in result.months if (r.year, r.month) == (year, month))


def test_months_are_whole_months_overlapping_the_range(grid: GridArrays) -> None:
    result = compute_area_result(grid, CELL_A, date(2012, 6, 20), date(2012, 8, 3))
    assert [(r.year, r.month) for r in result.months] == [(2012, 6), (2012, 7), (2012, 8)]
    assert result.coverage.first_month == YearMonth(2012, 6)
    assert result.coverage.last_month == YearMonth(2012, 8)
    assert result.coverage.n_months == 3
    assert result.coverage.starts_mid_month
    assert result.coverage.ends_mid_month
    assert not result.coverage.before_record
    assert not result.coverage.after_latest


def test_range_covering_whole_months_is_not_mid_month(grid: GridArrays) -> None:
    result = compute_area_result(grid, CELL_A, date(2012, 7, 1), date(2012, 7, 31))
    assert len(result.months) == 1
    assert not result.coverage.starts_mid_month
    assert not result.coverage.ends_mid_month


def test_month_values_and_grid_metadata(grid: GridArrays) -> None:
    result = compute_area_result(grid, CELL_A, date(2012, 1, 1), date(2012, 12, 31))
    assert len(result.months) == 12
    july = _month(result, 2012, 7)
    assert july.harmonized == 6.4
    assert july.raw_modis == 0
    assert july.raw_viirs == 8
    assert july.frp_sum_mw == pytest.approx(80.0)
    assert july.source_flag == "calibrated"
    assert july.calib_model == "quantile_map"
    assert july.provenance == "N20+N21+SNPP"
    assert not july.provisional
    assert july.lower_bound is None
    assert july.upper_bound is None


def test_month_without_activity_is_zero_filled_with_null_frp(grid: GridArrays) -> None:
    result = compute_area_result(grid, CELL_A, date(2012, 1, 1), date(2012, 12, 31))
    jan = _month(result, 2012, 1)
    assert jan.harmonized == 0.0
    assert (jan.raw_modis, jan.raw_viirs) == (0, 0)
    assert jan.frp_sum_mw is None
    assert jan.source_flag is None
    assert jan.provenance is None


def test_frp_is_kept_when_frp_mean_is_null(grid: GridArrays) -> None:
    result = compute_area_result(grid, CELL_A, date(2018, 8, 1), date(2018, 8, 31))
    assert _month(result, 2018, 8).frp_sum_mw == pytest.approx(31.0 * 12.5)


def test_october_2000_is_never_returned(grid: GridArrays) -> None:
    result = compute_area_result(grid, CELL_A, date(1999, 1, 1), date(2000, 12, 31))
    assert [(r.year, r.month) for r in result.months] == [(2000, 11), (2000, 12)]
    assert result.coverage.before_record
    assert _month(result, 2000, 11).harmonized == 2.0
    assert _month(result, 2000, 11).raw_modis == 2
    assert [y.year for y in result.years] == [2000]
    assert result.years[0].n_months == 2


def test_raw_counts_are_separate_and_sum_over_cells(grid: GridArrays) -> None:
    result = compute_area_result(grid, CELLS_A_AND_B, date(2000, 11, 1), date(2000, 11, 30))
    row = result.months[0]
    assert result.n_cells == 2
    assert row.harmonized == 3.0
    assert row.raw_modis == 3
    assert row.raw_viirs == 0


def test_provisional_month_is_flagged_without_anomaly(grid: GridArrays) -> None:
    result = compute_area_result(grid, CELL_A, date(2026, 10, 1), date(2026, 11, 30))
    oct_row, nov_row = result.months
    assert not oct_row.provisional
    assert oct_row.anomaly is not None
    assert nov_row.provisional
    assert nov_row.anomaly is None
    assert nov_row.harmonized == 3.0
    assert result.provisional_months == (YearMonth(2026, 11),)
    assert result.years[0].provisional
    assert result.years[0].anomaly is None


def test_provisional_month_stays_out_of_the_baseline(grid: GridArrays) -> None:
    result = compute_area_result(grid, CELL_A, date(2026, 11, 1), date(2026, 11, 30))
    november = result.baseline_by_month[11]
    assert (november.start_year, november.end_year) == (2000, 2025)
    assert november.n_years == 26  # 2000 to 2025, zero-filled; 2026-11 is provisional


def test_range_after_latest_month_is_flagged(grid: GridArrays) -> None:
    result = compute_area_result(grid, CELL_A, date(2026, 11, 1), date(2027, 3, 31))
    assert [(r.year, r.month) for r in result.months] == [(2026, 11)]
    assert result.coverage.after_latest


def test_range_outside_the_record_has_no_months(grid: GridArrays) -> None:
    result = compute_area_result(grid, CELL_A, date(1990, 1, 1), date(1990, 12, 31))
    assert result.months == ()
    assert result.years == ()
    assert result.coverage.first_month is None
    assert result.coverage.n_months == 0


def test_anomaly_against_zero_median_has_no_percent(grid: GridArrays) -> None:
    result = compute_area_result(grid, CELL_A, date(2012, 7, 1), date(2012, 7, 31))
    anomaly = result.months[0].anomaly
    assert anomaly is not None
    assert anomaly.absolute == pytest.approx(6.4)
    assert anomaly.percent is None
    assert anomaly.percent_text == NO_TYPICAL_FIRES_TEXT
    assert anomaly.percentile_rank > 90.0


def test_years_equal_the_sum_of_their_months(grid: GridArrays) -> None:
    result = compute_area_result(grid, WHOLE_REGION, date(2000, 1, 1), date(2026, 12, 31))
    for year in result.years:
        months = [r for r in result.months if r.year == year.year]
        assert year.n_months == len(months)
        assert year.harmonized == pytest.approx(sum(r.harmonized for r in months), abs=1e-9)
        assert year.raw_modis == sum(r.raw_modis for r in months)
        assert year.raw_viirs == sum(r.raw_viirs for r in months)
    assert sum(y.harmonized for y in result.years) == pytest.approx(
        sum(r.harmonized for r in result.months), abs=1e-9
    )


def test_year_anomaly_only_for_full_complete_years(grid: GridArrays) -> None:
    result = compute_area_result(grid, CELL_A, date(2000, 1, 1), date(2026, 12, 31))
    by_year = {y.year: y for y in result.years}
    assert by_year[2000].anomaly is None  # starts in November
    assert by_year[2026].anomaly is None  # provisional
    full = by_year[2012]
    assert full.n_months == 12
    assert full.anomaly is not None
    assert full.anomaly.n_years == result.baseline_year.n_years == 25  # 2001 to 2025
    assert full.anomaly.absolute == pytest.approx(6.4 - result.baseline_year.median)  # type: ignore[operator]


def test_year_cut_by_the_date_range_has_no_anomaly(grid: GridArrays) -> None:
    result = compute_area_result(grid, CELL_A, date(2012, 3, 1), date(2012, 9, 30))
    assert result.years[0].n_months == 7
    assert result.years[0].anomaly is None


def test_empty_selection_gives_zero_months_and_notice(grid: GridArrays) -> None:
    result = compute_area_result(grid, FAR_AWAY, date(2001, 1, 1), date(2003, 12, 31))
    assert result.n_cells == 0
    assert result.notice == NOTICE_NO_CELLS
    assert len(result.months) == 36
    assert all(r.harmonized == 0.0 and r.raw_modis == 0 and r.raw_viirs == 0 for r in result.months)
    assert all(r.frp_sum_mw is None for r in result.months)
    assert all(y.harmonized == 0.0 for y in result.years)


def test_non_empty_selection_has_no_notice(grid: GridArrays) -> None:
    result = compute_area_result(grid, CELL_A, date(2001, 1, 1), date(2001, 12, 31))
    assert result.notice is None
    assert result.n_cells == 1


def test_baseline_years_limit_the_baseline_not_the_rows(grid: GridArrays) -> None:
    years = [2012, 2013, 2014, 2015, 2016]
    result = compute_area_result(
        grid, CELL_A, date(2001, 7, 1), date(2001, 7, 31), baseline_years=years
    )
    assert [(r.year, r.month) for r in result.months] == [(2001, 7)]
    july = result.baseline_by_month[7]
    assert july.n_years == 5
    assert (july.start_year, july.end_year) == (2012, 2016)
    assert result.baseline_year.n_years == 5
    assert result.months[0].anomaly is not None
    assert result.months[0].anomaly.n_years == 5


def test_baseline_is_independent_of_the_date_range(grid: GridArrays) -> None:
    narrow = compute_area_result(grid, CELL_A, date(2012, 7, 1), date(2012, 7, 31))
    wide = compute_area_result(grid, CELL_A, date(2000, 1, 1), date(2026, 12, 31))
    assert narrow.baseline_by_month == wide.baseline_by_month
    assert narrow.baseline_year == wide.baseline_year
    assert narrow.months[0] == _month(wide, 2012, 7)


def test_precomputed_mask_gives_the_same_result(grid: GridArrays) -> None:
    mask = select_cells(grid.centre_lat, grid.centre_lon, CELL_A)
    via_mask = compute_area_result(grid, FAR_AWAY, date(2001, 1, 1), date(2012, 12, 31), mask=mask)
    via_polygon = compute_area_result(grid, CELL_A, date(2001, 1, 1), date(2012, 12, 31))
    assert via_mask == via_polygon


def test_mask_with_wrong_shape_is_rejected(grid: GridArrays) -> None:
    with pytest.raises(ValueError, match="mask"):
        compute_area_result(
            grid, CELL_A, date(2001, 1, 1), date(2001, 12, 31), mask=np.ones(3, dtype=np.bool_)
        )


def test_end_before_start_is_rejected(grid: GridArrays) -> None:
    with pytest.raises(ValueError, match="end"):
        compute_area_result(grid, CELL_A, date(2002, 1, 1), date(2001, 1, 1))


def test_no_infinity_or_nan_in_the_result(grid: GridArrays) -> None:
    result = compute_area_result(grid, FAR_AWAY, date(2000, 1, 1), date(2026, 12, 31))
    for row in result.months:
        values = [row.harmonized, row.frp_sum_mw]
        if row.anomaly is not None:
            values += [
                row.anomaly.absolute,
                row.anomaly.percent,
                row.anomaly.zscore,
                row.anomaly.percentile_rank,
            ]
        assert all(v is None or math.isfinite(v) for v in values)

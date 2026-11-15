"""Unit tests for the API serializer (task 18.10).

The grid comes from `tests/fixtures.py`: TEST FIXTURE, not NASA data. The latest month of that grid
(2026-11) is provisional.
"""

from __future__ import annotations

from datetime import date

import pytest
from shapely.geometry import box

from hotspots.api import schemas
from hotspots.api.serialize import round_half_up, serialize_area_result
from hotspots.areastats import (
    Anomaly,
    AreaResult,
    Baseline,
    MonthRow,
    YearRow,
    compute_area_result,
)
from hotspots.data import GridArrays, build_grid_arrays
from tests.fixtures import (
    EXCLUDED_CELL_ID,
    RECORD_START,
    default_grid_rows,
    grid_table,
)

RECORD_START_TEXT = f"{RECORD_START[0]:04d}-{RECORD_START[1]:02d}"
WHOLE_REGION = box(-125.0, 32.0, -113.0, 43.0)
FAR_AWAY = box(-122.0, 40.0, -121.9, 40.1)


@pytest.fixture(scope="module")
def grid() -> GridArrays:
    return build_grid_arrays(grid_table(default_grid_rows()), RECORD_START_TEXT, [EXCLUDED_CELL_ID])


@pytest.fixture(scope="module")
def result(grid: GridArrays) -> AreaResult:
    return compute_area_result(grid, WHOLE_REGION, date(2000, 11, 1), date(2026, 12, 31))


def _anomaly(absolute: float = 1.26) -> Anomaly:
    return Anomaly(
        absolute=absolute,
        percent=12.345,
        percent_text=None,
        zscore=1.2345,
        percentile_rank=87.654,
        baseline_start_year=2001,
        baseline_end_year=2025,
        n_years=25,
    )


def _month_row(**kw: object) -> MonthRow:
    base: dict[str, object] = {
        "year": 2020,
        "month": 7,
        "harmonized": 3.14159,
        "raw_modis": 4,
        "raw_viirs": 5,
        "frp_sum_mw": 12.345,
        "source_flag": "calibrated",
        "calib_model": "quantile_map",
        "provenance": "N20+N21+SNPP",
        "provisional": False,
        "anomaly": _anomaly(),
    }
    base.update(kw)
    return MonthRow(**base)  # type: ignore[arg-type]


def _area_result(months: tuple[MonthRow, ...], years: tuple[YearRow, ...] = ()) -> AreaResult:
    base = compute_area_result(
        build_grid_arrays(grid_table(default_grid_rows()), RECORD_START_TEXT, [EXCLUDED_CELL_ID]),
        FAR_AWAY,
        date(2012, 1, 1),
        date(2012, 12, 31),
    )
    return AreaResult(
        months=months,
        years=years,
        baseline_by_month=base.baseline_by_month,
        baseline_year=base.baseline_year,
        coverage=base.coverage,
        n_cells=base.n_cells,
        notice=None,
    )


# --- rounding ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("value", "decimals", "expected"),
    [
        (3.14159, 1, 3.1),
        (0.25, 1, 0.3),  # exact binary tie goes up, like toFixed
        (2.5, 0, 3.0),
        (-0.04, 1, 0.0),
        (-1.26, 1, -1.3),
        (0.0, 1, 0.0),
        (1.005, 2, 1.0),  # the binary value is just below the tie
    ],
)
def test_round_half_up(value: float, decimals: int, expected: float) -> None:
    assert round_half_up(value, decimals) == expected


def test_round_never_returns_negative_zero() -> None:
    import math

    assert math.copysign(1.0, round_half_up(-0.04, 1)) == 1.0


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")])
def test_round_rejects_non_finite(bad: float) -> None:
    with pytest.raises(ValueError, match="non-finite"):
        round_half_up(bad, 1)


# --- full conversion ---------------------------------------------------------------------


def test_serializes_a_real_area_result_into_calendar_out(result: AreaResult) -> None:
    out = serialize_area_result(result)
    assert isinstance(out, schemas.CalendarOut)
    assert len(out.months) == len(result.months)
    assert len(out.years) == len(result.years)
    assert out.n_cells == result.n_cells
    assert out.notice is None
    assert out.coverage.first_month == "2000-11"
    assert out.coverage.last_month == "2026-11"
    assert out.coverage.n_months == len(result.months)
    # the response is valid JSON-ready and round-trips through the schema
    assert schemas.CalendarOut.model_validate(out.model_dump(mode="json")) == out


def test_harmonized_rounds_to_one_decimal_and_counts_stay_integers(result: AreaResult) -> None:
    out = serialize_area_result(result)
    for src, dst in zip(result.months, out.months, strict=True):
        assert dst.harmonized == round_half_up(src.harmonized, 1)
        assert abs(dst.harmonized - src.harmonized) <= 0.05 + 1e-9
        assert dst.raw_modis == src.raw_modis
        assert dst.raw_viirs == src.raw_viirs
        assert isinstance(dst.raw_modis, int)
        assert isinstance(dst.raw_viirs, int)


def test_rounding_is_applied_to_values_not_to_inputs() -> None:
    row = _month_row()
    out = serialize_area_result(_area_result((row,)))
    month = out.months[0]
    assert month.harmonized == 3.1
    assert month.frp_sum_mw == 12.3
    assert month.anomaly is not None
    assert month.anomaly.absolute == 1.3
    assert month.anomaly.percent == 12.3
    assert month.anomaly.zscore == 1.23
    assert month.anomaly.percentile_rank == 87.7
    assert row.harmonized == 3.14159  # the source row is untouched


def test_frp_none_stays_null() -> None:
    out = serialize_area_result(_area_result((_month_row(frp_sum_mw=None),)))
    assert out.months[0].frp_sum_mw is None


def test_bounds_are_always_null() -> None:
    out = serialize_area_result(_area_result((_month_row(lower_bound=1.0, upper_bound=2.0),)))
    assert out.months[0].lower_bound is None
    assert out.months[0].upper_bound is None


def test_null_anomaly_fields_pass_through() -> None:
    anomaly = Anomaly(
        absolute=2.04,
        percent=None,
        percent_text="no typical fires in this month",
        zscore=None,
        percentile_rank=50.0,
        baseline_start_year=2001,
        baseline_end_year=2025,
        n_years=25,
    )
    out = serialize_area_result(_area_result((_month_row(anomaly=anomaly),)))
    got = out.months[0].anomaly
    assert got is not None
    assert got.percent is None
    assert got.percent_text == "no typical fires in this month"
    assert got.zscore is None
    assert got.absolute == 2.0


# --- provisional month (requirements 15.17 to 15.19) --------------------------------------


def test_provisional_flag_equals_incomplete_flag_of_the_grid(
    grid: GridArrays, result: AreaResult
) -> None:
    out = serialize_area_result(result)
    incomplete = {str(ym) for ym, flag in zip(grid.months, grid.incomplete, strict=True) if flag}
    assert incomplete == {"2026-11"}
    flagged = {f"{m.year:04d}-{m.month:02d}" for m in out.months if m.provisional}
    assert flagged == incomplete
    assert out.provisional_months == sorted(incomplete)


def test_provisional_month_has_null_anomaly_and_keeps_its_count(result: AreaResult) -> None:
    out = serialize_area_result(result)
    latest = next(m for m in out.months if (m.year, m.month) == (2026, 11))
    assert latest.provisional
    assert latest.anomaly is None
    assert latest.harmonized > 0
    complete = [m for m in out.months if not m.provisional]
    assert complete
    assert any(m.anomaly is not None for m in complete)


def test_provisional_month_anomaly_is_dropped_even_if_the_source_carries_one() -> None:
    row = _month_row(provisional=True, anomaly=_anomaly())
    out = serialize_area_result(_area_result((row,)))
    assert out.months[0].provisional
    assert out.months[0].anomaly is None
    assert out.provisional_months == ["2020-07"]


def test_year_with_the_provisional_month_is_flagged_without_anomaly(result: AreaResult) -> None:
    out = serialize_area_result(result)
    year_2026 = next(y for y in out.years if y.year == 2026)
    assert year_2026.provisional
    assert year_2026.anomaly is None
    assert all(not y.provisional for y in out.years if y.year != 2026)


def test_year_anomaly_is_dropped_when_provisional() -> None:
    year = YearRow(
        year=2026,
        harmonized=10.0,
        raw_modis=0,
        raw_viirs=3,
        frp_sum_mw=None,
        n_months=12,
        provisional=True,
        anomaly=_anomaly(),
    )
    out = serialize_area_result(_area_result((), (year,)))
    assert out.years[0].provisional
    assert out.years[0].anomaly is None
    assert out.years[0].n_months == 12


def test_baselines_do_not_include_the_provisional_month(
    grid: GridArrays, result: AreaResult
) -> None:
    out = serialize_area_result(result)
    november = next(b for b in out.baseline_by_month if b.month == 11)
    # 2026-11 is provisional, so the last November in the baseline is 2025 at most.
    unrounded = result.baseline_by_month[11]
    assert unrounded.end_year is not None
    assert unrounded.end_year < 2026
    assert november.n_years == unrounded.n_years
    assert all(0.0 <= b.p10 <= b.median <= b.p90 for b in out.baseline_by_month)


# --- empty and edge cases ----------------------------------------------------------------


def test_empty_selection_serializes_zero_months_with_notice(grid: GridArrays) -> None:
    empty = compute_area_result(grid, FAR_AWAY, date(2012, 1, 1), date(2012, 3, 31))
    out = serialize_area_result(empty)
    assert out.notice == "no_cells"
    assert out.n_cells == 0
    assert [m.harmonized for m in out.months] == [0.0, 0.0, 0.0]
    assert [m.raw_modis for m in out.months] == [0, 0, 0]
    assert all(m.anomaly is not None for m in out.months)


def test_empty_baseline_is_left_out() -> None:
    base = _area_result(())
    empty = Baseline(None, None, None, None, None, 0)
    result = AreaResult(
        months=(),
        years=(),
        baseline_by_month={m: empty for m in range(1, 13)},
        baseline_year=empty,
        coverage=base.coverage,
        n_cells=0,
        notice="no_cells",
    )
    out = serialize_area_result(result)
    assert out.baseline_by_month == []
    assert out.baseline_year is None


def test_coverage_fields_are_carried_over(grid: GridArrays) -> None:
    res = compute_area_result(grid, WHOLE_REGION, date(2012, 6, 20), date(2012, 8, 3))
    cov = serialize_area_result(res).coverage
    assert (cov.first_month, cov.last_month, cov.n_months) == ("2012-06", "2012-08", 3)
    assert cov.requested_start == date(2012, 6, 20)
    assert cov.requested_end == date(2012, 8, 3)
    assert cov.starts_mid_month
    assert cov.ends_mid_month
    assert not cov.before_record
    assert not cov.after_latest

"""Edge-case unit tests for baselines, anomalies and statistics (task 18.8).

Covers zero median and zero standard deviation, short records, ties in rankings and the monthly
(leap-year-free) logic. They add to `test_stats.py` and `test_areastats_baseline.py` and do not
repeat them. All values are synthetic (TEST FIXTURE, not NASA data).
"""

from __future__ import annotations

import math
from datetime import date
from itertools import permutations

import pytest
from shapely.geometry import box

from hotspots.areastats import (
    NO_TYPICAL_FIRES_TEXT,
    NOTICE_NO_CELLS,
    Baseline,
    MonthRow,
    YearRow,
    compute_area_result,
    evaluate_anomaly,
    monthly_baselines,
    yearly_baseline,
)
from hotspots.data import GridArrays, YearMonth, build_grid_arrays
from hotspots.stats import (
    TOP_N,
    baseline_all_zero,
    briefing_inputs,
    peak_months,
    record_rank,
    seasonal_profile,
    top_months,
    top_years,
    year_to_date_vs_median,
)
from tests.fixtures import EXCLUDED_CELL_ID, RECORD_START, default_grid_rows, grid_table
from tests.unit.test_stats import make_result, make_series

RECORD_START_TEXT = f"{RECORD_START[0]:04d}-{RECORD_START[1]:02d}"
FAR_AWAY = box(-122.0, 40.0, -121.9, 40.1)
CELL_A = box(-118.1, 34.0, -118.0, 34.1)


def _baseline(values: list[float], start_year: int = 2001) -> Baseline:
    """A `Baseline` built through the public function from one value per year in January."""
    series = make_series(
        lambda m: values[m.year - start_year] if m.month == 1 else 0.0,
        YearMonth(start_year, 1),
        YearMonth(start_year + len(values) - 1, 12),
    )
    return monthly_baselines(series)[1]


def _month_row(year: int, month: int, x: float, *, provisional: bool = False) -> MonthRow:
    return MonthRow(year, month, x, 0, 0, None, None, None, None, provisional)


def _year_row(year: int, x: float, *, provisional: bool = False) -> YearRow:
    return YearRow(year, x, 0, 0, None, 12, provisional)


@pytest.fixture(scope="module")
def grid() -> GridArrays:
    return build_grid_arrays(grid_table(default_grid_rows()), RECORD_START_TEXT, [EXCLUDED_CELL_ID])


# ---------------------------------------------------------------------------
# Median 0 and standard deviation 0 (requirements 10.6, 10.7)
# ---------------------------------------------------------------------------


def test_all_zero_baseline_has_zero_median_and_zero_std() -> None:
    b = _baseline([0.0] * 6)
    assert (b.median, b.mean, b.std) == (0.0, 0.0, 0.0)
    assert (b.p10, b.p90) == (0.0, 0.0)


@pytest.mark.parametrize(
    ("x", "expected_rank"),
    [(0.0, 50.0), (4.0, 100.0), (-1.0, 0.0)],
)
def test_zero_median_and_zero_std_anomaly_has_no_percent_and_no_zscore(
    x: float, expected_rank: float
) -> None:
    a = evaluate_anomaly(x, _baseline([0.0] * 6))
    assert a is not None
    assert a.absolute == x
    assert a.percent is None
    assert a.percent_text == NO_TYPICAL_FIRES_TEXT
    assert a.zscore is None
    assert a.percentile_rank == expected_rank


def test_count_equal_to_constant_nonzero_baseline_is_zero_anomaly_without_zscore() -> None:
    a = evaluate_anomaly(5.0, _baseline([5.0] * 5))
    assert a is not None
    assert (a.absolute, a.percent) == (0.0, 0.0)
    assert a.percent_text is None
    assert a.zscore is None  # std is 0: the z-score is undefined, not 0 and not infinity
    assert a.percentile_rank == 50.0


def test_zero_median_with_positive_std_keeps_the_zscore() -> None:
    b = _baseline([0.0, 0.0, 0.0, 0.0, 10.0])
    assert b.median == 0.0
    assert b.std is not None and b.std > 0
    a = evaluate_anomaly(10.0, b)
    assert a is not None
    assert a.percent is None
    assert a.percent_text == NO_TYPICAL_FIRES_TEXT
    assert a.zscore is not None and math.isfinite(a.zscore)


def test_percent_is_null_for_zero_median_even_when_count_is_zero() -> None:
    a = evaluate_anomaly(0.0, _baseline([0.0, 0.0, 0.0, 0.0, 10.0]))
    assert a is not None
    assert a.absolute == 0.0
    assert a.percent is None
    assert a.percent_text == NO_TYPICAL_FIRES_TEXT
    # Four of five baseline values tie with the count, one is higher: (0 + 0.5 * 4) / 5.
    assert a.percentile_rank == pytest.approx(40.0)


def test_area_without_cells_gets_zero_median_anomalies_for_months_and_years(
    grid: GridArrays,
) -> None:
    result = compute_area_result(grid, FAR_AWAY, date(2012, 1, 1), date(2012, 12, 31))
    assert result.n_cells == 0
    assert result.notice == NOTICE_NO_CELLS
    assert baseline_all_zero(result.baseline_by_month)
    for row in result.months:
        assert row.harmonized == 0.0
        assert row.anomaly is not None
        assert row.anomaly.percent is None
        assert row.anomaly.percent_text == NO_TYPICAL_FIRES_TEXT
        assert row.anomaly.zscore is None
        assert row.anomaly.percentile_rank == 50.0
    (year,) = result.years
    assert year.anomaly is not None
    assert year.anomaly.percent is None
    assert year.anomaly.zscore is None


def test_yearly_all_zero_baseline_matches_monthly_rules() -> None:
    series = make_series(lambda m: 0.0, YearMonth(2001, 1), YearMonth(2006, 12))
    yearly = yearly_baseline(series)
    assert (yearly.median, yearly.std, yearly.n_years) == (0.0, 0.0, 6)
    a = evaluate_anomaly(12.0, yearly)
    assert a is not None
    assert a.percent is None and a.zscore is None
    assert a.percentile_rank == 100.0


def test_all_zero_baseline_yields_no_peak_and_flat_profile() -> None:
    baselines = monthly_baselines(make_series(lambda m: 0.0))
    assert baseline_all_zero(baselines)
    assert peak_months(baselines) == ()
    assert [p.median for p in seasonal_profile(baselines)] == [0.0] * 12


def test_year_to_date_with_zero_median_and_zero_count_is_equal_without_percent() -> None:
    ytd = year_to_date_vs_median(make_series(lambda m: 0.0), YearMonth(2010, 4))
    assert ytd is not None
    assert (ytd.count, ytd.median_cumulative) == (0.0, 0.0)
    assert ytd.direction == "equal"
    assert ytd.percent_difference is None


# ---------------------------------------------------------------------------
# Short records (requirements 10.9, 10.11)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("x", "expected_rank"),
    [(1.0, 0.0), (2.0, 50.0), (3.0, 100.0)],
)
def test_single_year_baseline_has_all_statistics_equal_and_no_zscore(
    x: float, expected_rank: float
) -> None:
    b = _baseline([2.0])
    assert (b.median, b.p10, b.p90, b.mean) == (2.0, 2.0, 2.0, 2.0)
    assert b.std is None
    a = evaluate_anomaly(x, b)
    assert a is not None
    assert a.zscore is None
    assert a.absolute == x - 2.0
    assert a.percentile_rank == expected_rank
    assert (a.baseline_start_year, a.baseline_end_year, a.n_years) == (2001, 2001, 1)


def test_two_year_baseline_has_a_defined_sample_std() -> None:
    b = _baseline([2.0, 4.0])
    assert b.n_years == 2
    assert b.median == 3.0
    assert b.std == pytest.approx(math.sqrt(2.0))
    a = evaluate_anomaly(4.0, b)
    assert a is not None
    assert a.zscore == pytest.approx((4.0 - 3.0) / math.sqrt(2.0))
    assert a.percentile_rank == 75.0


def test_series_shorter_than_a_year_has_empty_months_and_no_yearly_baseline() -> None:
    series = make_series(lambda m: 1.0, YearMonth(2001, 1), YearMonth(2001, 11))
    assert yearly_baseline(series).n_years == 0
    assert evaluate_anomaly(5.0, yearly_baseline(series)) is None
    baselines = monthly_baselines(series)
    assert baselines[12].n_years == 0
    assert evaluate_anomaly(1.0, baselines[12]) is None
    assert baselines[11].n_years == 1


def test_record_rank_needs_exactly_five_years() -> None:
    four = _baseline([1.0, 2.0, 3.0, 4.0])
    five = _baseline([1.0, 2.0, 3.0, 4.0, 5.0])
    assert record_rank(YearMonth(2004, 1), 4.0, four) is None
    rr = record_rank(YearMonth(2005, 1), 5.0, five)
    assert rr is not None
    assert (rr.rank, rr.n_years, rr.since_year) == (1, 5, 2001)
    assert rr.percentile == pytest.approx(90.0)


def test_record_rank_is_none_for_an_empty_baseline() -> None:
    empty = Baseline(None, None, None, None, None, 0)
    assert record_rank(YearMonth(2005, 1), 1.0, empty) is None


def test_year_to_date_median_appears_at_exactly_five_seasons() -> None:
    series = make_series(lambda m: float(m.year - 2000), YearMonth(2001, 1), YearMonth(2005, 12))
    ytd = year_to_date_vs_median(series, YearMonth(2005, 2))
    assert ytd is not None
    assert ytd.n_seasons == 5
    assert ytd.median_cumulative == pytest.approx(6.0)  # 2 months of 1..5, the median is 3
    assert ytd.direction == "above"


def test_year_to_date_with_one_month_of_data_has_no_median() -> None:
    series = make_series(lambda m: 7.0, YearMonth(2001, 1), YearMonth(2001, 1))
    ytd = year_to_date_vs_median(series, YearMonth(2001, 1))
    assert ytd is not None
    assert (ytd.count, ytd.n_seasons) == (7.0, 0)
    assert ytd.median_cumulative is None
    assert ytd.direction is None
    assert ytd.percent_difference is None


def test_briefing_inputs_with_exactly_five_complete_years_is_not_short() -> None:
    series = make_series(lambda m: float(m.year - 2000), YearMonth(2001, 1), YearMonth(2005, 12))
    result = make_result(series, YearMonth(2005, 1), YearMonth(2005, 12))
    inputs = briefing_inputs(result, series)
    assert not inputs.short_record
    assert inputs.record_rank is not None
    assert inputs.record_rank.rank == 1


def test_briefing_inputs_with_four_years_and_a_partial_fifth_is_short() -> None:
    series = make_series(lambda m: 1.0, YearMonth(2001, 1), YearMonth(2005, 11))
    inputs = briefing_inputs(make_result(series, YearMonth(2005, 1), YearMonth(2005, 11)), series)
    assert inputs.short_record  # the fifth year has 11 months, so it is not a complete year
    assert inputs.record_rank is None
    assert inputs.latest_complete == YearMonth(2005, 11)


def test_seasonal_profile_for_a_single_year_has_equal_median_and_percentiles() -> None:
    series = make_series(lambda m: float(m.month), YearMonth(2001, 1), YearMonth(2001, 12))
    profile = seasonal_profile(monthly_baselines(series))
    assert all(p.n_years == 1 for p in profile)
    assert all(p.median == p.p10 == p.p90 == float(p.month) for p in profile)


# ---------------------------------------------------------------------------
# Ties in rankings (requirements 10.11, 16.5)
# ---------------------------------------------------------------------------


def test_top_months_all_equal_returns_the_ten_earliest_months() -> None:
    rows = [_month_row(2001 + i // 12, i % 12 + 1, 4.0) for i in range(24)]
    ranked = top_months(reversed(rows))
    assert len(ranked) == TOP_N
    assert [(r.year, r.month) for r in ranked] == [(2001, m) for m in range(1, 11)]


def test_top_months_tie_across_years_for_the_same_calendar_month() -> None:
    rows = [_month_row(2003, 3, 8.0), _month_row(2001, 3, 8.0), _month_row(2002, 3, 8.0)]
    assert [r.year for r in top_months(rows)] == [2001, 2002, 2003]


def test_top_months_tie_at_the_cutoff_keeps_the_earlier_month() -> None:
    rows = [_month_row(2001, m, 100.0 + m) for m in range(2, 11)]  # nine distinct, high
    rows += [_month_row(2002, 1, 5.0), _month_row(2001, 1, 5.0), _month_row(2003, 1, 5.0)]
    ranked = top_months(rows)
    assert len(ranked) == TOP_N
    assert (ranked[-1].year, ranked[-1].month) == (2001, 1)
    assert ranked[-1].harmonized == 5.0


def test_top_months_zero_counts_are_ranked_and_ties_still_ordered() -> None:
    rows = [_month_row(2002, 5, 0.0), _month_row(2001, 5, 0.0)]
    assert [(r.year, r.harmonized) for r in top_months(rows)] == [(2001, 0.0), (2002, 0.0)]


def test_top_months_n_zero_is_empty() -> None:
    assert top_months([_month_row(2001, 1, 1.0)], n=0) == ()


def test_provisional_month_never_displaces_a_tied_complete_month() -> None:
    rows = [_month_row(2026, 11, 9.0, provisional=True), _month_row(2001, 1, 9.0)]
    assert [(r.year, r.month) for r in top_months(rows)] == [(2001, 1)]


def test_top_years_order_does_not_depend_on_input_order() -> None:
    years = [_year_row(2004, 7.0), _year_row(2002, 7.0), _year_row(2003, 9.0)]
    expected = [(2003, 9.0), (2002, 7.0), (2004, 7.0)]
    for order in permutations(years):
        assert [(y.year, y.harmonized) for y in top_years(order)] == expected


def test_top_years_tie_at_the_cutoff_keeps_the_earlier_year() -> None:
    years = [_year_row(2000 + i, 50.0) for i in range(1, 13)]
    ranked = top_years(reversed(years))
    assert [y.year for y in ranked] == list(range(2001, 2011))


def test_top_years_provisional_year_is_dropped_even_when_it_would_win_a_tie() -> None:
    ranked = top_years([_year_row(2026, 10.0, provisional=True), _year_row(2020, 10.0)])
    assert [y.year for y in ranked] == [2020]


def test_record_rank_all_equal_values_share_rank_one_and_mid_percentile() -> None:
    rr = record_rank(YearMonth(2005, 1), 5.0, _baseline([5.0] * 5))
    assert rr is not None
    assert rr.rank == 1
    assert rr.percentile == 50.0


def test_record_rank_tie_at_the_bottom_shares_the_best_tied_rank() -> None:
    baseline = _baseline([0.0, 0.0, 0.0, 0.0, 5.0])
    rr = record_rank(YearMonth(2005, 1), 0.0, baseline)
    assert rr is not None
    assert rr.rank == 2  # one value is strictly higher, the four tied values share rank 2
    assert rr.percentile == pytest.approx(40.0)
    a = evaluate_anomaly(0.0, baseline)
    assert a is not None
    assert rr.percentile == pytest.approx(a.percentile_rank)


def test_record_rank_value_above_every_baseline_value_is_rank_one_percentile_100() -> None:
    rr = record_rank(YearMonth(2006, 1), 99.0, _baseline([1.0, 2.0, 3.0, 4.0, 5.0]))
    assert rr is not None
    assert (rr.rank, rr.percentile) == (1, 100.0)


def test_peak_months_treat_float_noise_as_a_tie() -> None:
    def base(median: float) -> Baseline:
        return Baseline(median, median, median, median, 0.0, 5, 2001, 2005, (median,) * 5)

    baselines = {1: base(0.1 + 0.2), 6: base(0.3), 9: base(0.1)}
    assert peak_months(baselines) == (1, 6)


# ---------------------------------------------------------------------------
# Leap-year-free monthly logic (requirement 10.9)
# ---------------------------------------------------------------------------


def test_february_baseline_uses_every_year_unscaled_including_leap_years() -> None:
    series = make_series(lambda m: float(m.year) if m.month == 2 else 0.0)
    feb = monthly_baselines(series)[2]
    assert feb.n_years == 10
    assert feb.values == tuple(float(y) for y in range(2001, 2011))  # 2004 and 2008 are leap
    assert feb.median == 2005.5


def test_february_of_a_leap_year_is_one_month_like_any_other() -> None:
    # A constant count in every month gives the same baseline for February as for January.
    baselines = monthly_baselines(
        make_series(lambda m: 31.0, YearMonth(2000, 11), YearMonth(2008, 12))
    )
    assert baselines[2].median == baselines[1].median == 31.0
    assert baselines[2].n_years == 8  # 2001 to 2008, February 2000 is before the record
    assert baselines[1].n_years == 8


def test_year_to_date_through_february_ignores_leap_days() -> None:
    # The same two-month cumulative in a leap year (2004) and a common year (2003).
    series = make_series(lambda m: 10.0)
    leap = year_to_date_vs_median(series, YearMonth(2004, 2))
    common = year_to_date_vs_median(series, YearMonth(2003, 2))
    assert leap is not None and common is not None
    assert leap.count == common.count == 20.0
    assert leap.month_of_season == common.month_of_season == 2
    assert leap.median_cumulative == common.median_cumulative == 20.0


def test_season_start_in_march_counts_february_of_a_leap_year_as_month_twelve() -> None:
    series = make_series(lambda m: 1.0)
    ytd = year_to_date_vs_median(series, YearMonth(2004, 2), season_start_month=3)
    assert ytd is not None
    assert (ytd.season_year, ytd.month_of_season) == (2003, 12)
    assert ytd.count == 12.0


@pytest.mark.parametrize(
    ("start", "end", "starts_mid", "ends_mid"),
    [
        (date(2004, 2, 1), date(2004, 2, 28), False, True),  # 2004 is a leap year
        (date(2004, 2, 1), date(2004, 2, 29), False, False),
        (date(2003, 2, 1), date(2003, 2, 28), False, False),
        (date(2004, 2, 29), date(2004, 3, 31), True, False),
        (date(2004, 3, 1), date(2004, 3, 1), False, True),
    ],
)
def test_coverage_mid_month_flags_follow_the_real_calendar(
    grid: GridArrays, start: date, end: date, starts_mid: bool, ends_mid: bool
) -> None:
    coverage = compute_area_result(grid, CELL_A, start, end).coverage
    assert coverage.starts_mid_month is starts_mid
    assert coverage.ends_mid_month is ends_mid


def test_leap_day_alone_selects_exactly_the_february_month(grid: GridArrays) -> None:
    result = compute_area_result(grid, CELL_A, date(2004, 2, 29), date(2004, 2, 29))
    assert [(r.year, r.month) for r in result.months] == [(2004, 2)]
    assert result.coverage.n_months == 1


def test_a_year_spanning_a_leap_day_has_twelve_months_not_thirteen(grid: GridArrays) -> None:
    result = compute_area_result(grid, CELL_A, date(2003, 3, 1), date(2004, 2, 29))
    assert result.coverage.n_months == 12
    assert [(r.year, r.month) for r in result.months][0] == (2003, 3)
    assert [(r.year, r.month) for r in result.months][-1] == (2004, 2)
    assert sum(y.n_months for y in result.years) == 12

"""Unit tests for `hotspots.stats` (task 18.1).

All values are synthetic (TEST FIXTURE, not NASA data). Series are built directly from
`ZeroFilledSeries`, so the tests need no grid or Parquet file.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import date

import numpy as np
import pytest

from hotspots.areastats import (
    AreaResult,
    Baseline,
    Coverage,
    MonthRow,
    ProvisionalMonth,
    YearRow,
    ZeroFilledSeries,
    complete_years,
    evaluate_anomaly,
    monthly_baselines,
    yearly_baseline,
)
from hotspots.data.types import YearMonth
from hotspots.stats import (
    TOP_N,
    baseline_all_zero,
    briefing_inputs,
    latest_complete_month,
    peak_months,
    record_rank,
    seasonal_profile,
    top_months,
    top_years,
    year_to_date_vs_median,
)

FIRST = YearMonth(2001, 1)
LAST = YearMonth(2010, 12)


def _months(first: YearMonth, last: YearMonth) -> list[YearMonth]:
    return [YearMonth.from_index(i) for i in range(first.index, last.index + 1)]


def make_series(
    value: Callable[[YearMonth], float],
    first: YearMonth = FIRST,
    last: YearMonth = LAST,
    provisional: YearMonth | None = None,
    provisional_value: float = 3.0,
) -> ZeroFilledSeries:
    months = _months(first, last)
    harm = np.array([value(m) for m in months], dtype=np.float64)
    prov = (
        ()
        if provisional is None
        else (ProvisionalMonth(provisional, provisional_value, 0, 0, None),)
    )
    return ZeroFilledSeries(
        months=months,
        harmonized=harm,
        raw_modis=np.zeros(len(months), dtype=np.int64),
        raw_viirs=np.zeros(len(months), dtype=np.int64),
        frp_sum_mw=np.full(len(months), np.nan),
        provisional=prov,
    )


def make_result(series: ZeroFilledSeries, start: YearMonth, end: YearMonth) -> AreaResult:
    """Build an `AreaResult` for months ``start`` to ``end`` the way `compute_area_result` does."""
    rows: list[MonthRow] = []
    for ym, x in zip(series.months, series.harmonized, strict=True):
        if start.index <= ym.index <= end.index:
            rows.append(_row(ym, float(x), provisional=False))
    for p in series.provisional:
        if start.index <= p.month.index <= end.index:
            rows.append(_row(p.month, p.harmonized, provisional=True))
    rows.sort(key=lambda r: (r.year, r.month))
    years = tuple(
        YearRow(
            year=y,
            harmonized=sum(r.harmonized for r in rows if r.year == y),
            raw_modis=0,
            raw_viirs=0,
            frp_sum_mw=None,
            n_months=sum(1 for r in rows if r.year == y),
            provisional=any(r.provisional for r in rows if r.year == y),
        )
        for y in sorted({r.year for r in rows})
    )
    coverage = Coverage(
        requested_start=date(start.year, start.month, 1),
        requested_end=date(end.year, end.month, 28),
        first_month=start,
        last_month=end,
        n_months=len(rows),
        starts_mid_month=False,
        ends_mid_month=True,
        before_record=False,
        after_latest=False,
    )
    return AreaResult(
        months=tuple(rows),
        years=years,
        baseline_by_month=monthly_baselines(series),
        baseline_year=yearly_baseline(series),
        coverage=coverage,
        n_cells=1,
        notice=None,
    )


def _row(ym: YearMonth, x: float, *, provisional: bool) -> MonthRow:
    return MonthRow(
        year=ym.year,
        month=ym.month,
        harmonized=x,
        raw_modis=0,
        raw_viirs=0,
        frp_sum_mw=None,
        source_flag=None,
        calib_model=None,
        provenance=None,
        provisional=provisional,
    )


def _year_row(year: int, x: float, *, n_months: int = 12, provisional: bool = False) -> YearRow:
    return YearRow(year, x, 0, 0, None, n_months, provisional)


# ---------------------------------------------------------------------------
# Rankings
# ---------------------------------------------------------------------------


def test_top_months_descending_ties_by_earlier_date() -> None:
    rows = [
        _row(YearMonth(2003, 5), 10.0, provisional=False),
        _row(YearMonth(2001, 9), 10.0, provisional=False),
        _row(YearMonth(2002, 1), 30.0, provisional=False),
        _row(YearMonth(2001, 3), 10.0, provisional=False),
    ]
    ranked = top_months(rows)
    assert [(r.year, r.month, r.harmonized) for r in ranked] == [
        (2002, 1, 30.0),
        (2001, 3, 10.0),
        (2001, 9, 10.0),
        (2003, 5, 10.0),
    ]


def test_top_months_caps_at_ten_and_skips_provisional() -> None:
    rows = [_row(YearMonth(2001, m), float(m), provisional=False) for m in range(1, 13)]
    rows.append(_row(YearMonth(2002, 1), 999.0, provisional=True))
    ranked = top_months(rows)
    assert len(ranked) == TOP_N
    assert (ranked[0].year, ranked[0].month) == (2001, 12)
    assert all(r.year != 2002 for r in ranked)


def test_top_years_skips_provisional_year_and_orders_ties_by_earlier_year() -> None:
    years = [
        _year_row(2005, 50.0),
        _year_row(2003, 50.0),
        _year_row(2026, 500.0, n_months=11, provisional=True),
        _year_row(2004, 80.0),
    ]
    ranked = top_years(years)
    assert [(y.year, y.harmonized) for y in ranked] == [(2004, 80.0), (2003, 50.0), (2005, 50.0)]


def test_rankings_empty_and_short_inputs() -> None:
    assert top_months([]) == ()
    assert top_years([]) == ()
    assert len(top_years([_year_row(2001, 1.0), _year_row(2002, 2.0)])) == 2


def test_top_years_reports_partial_year_months() -> None:
    ranked = top_years([_year_row(2001, 4.0, n_months=3)])
    assert ranked[0].n_months == 3


def test_negative_n_is_rejected() -> None:
    with pytest.raises(ValueError):
        top_months([], n=-1)
    with pytest.raises(ValueError):
        top_years([], n=-1)


# ---------------------------------------------------------------------------
# Seasonal profile
# ---------------------------------------------------------------------------


def test_seasonal_profile_has_twelve_points_in_calendar_order() -> None:
    series = make_series(lambda m: float(m.month * 10 + (m.year - 2000)))
    profile = seasonal_profile(monthly_baselines(series))
    assert [p.month for p in profile] == list(range(1, 13))
    jan = profile[0]
    assert jan.n_years == 10
    # January values are 11..20, so the linear median is 15.5.
    assert jan.median == pytest.approx(15.5)
    assert jan.p10 == pytest.approx(11.9)
    assert jan.p90 == pytest.approx(19.1)


def test_seasonal_profile_empty_month_is_null_not_zero() -> None:
    series = make_series(lambda m: 1.0, YearMonth(2001, 1), YearMonth(2001, 3))
    profile = seasonal_profile(monthly_baselines(series))
    assert profile[3].n_years == 0
    assert (profile[3].median, profile[3].p10, profile[3].p90) == (None, None, None)
    assert seasonal_profile({})[0].median is None


# ---------------------------------------------------------------------------
# Record rank and percentile
# ---------------------------------------------------------------------------


def test_record_rank_third_highest_and_percentile() -> None:
    # Ten Octobers 2001..2010 with values 1..10, the third highest is 8.
    series = make_series(lambda m: float(m.year - 2000) if m.month == 10 else 0.0)
    baseline = monthly_baselines(series)[10]
    rr = record_rank(YearMonth(2008, 10), 8.0, baseline)
    assert rr is not None
    assert rr.rank == 3
    assert rr.n_years == 10
    assert rr.since_year == 2001
    assert rr.percentile == pytest.approx(75.0)


def test_record_rank_ties_get_best_rank_and_match_anomaly_percentile() -> None:
    values = [5.0, 9.0, 9.0, 9.0, 1.0, 2.0]
    baseline = Baseline(
        median=7.0,
        p10=1.5,
        p90=9.0,
        mean=5.833,
        std=3.5,
        n_years=6,
        start_year=2001,
        end_year=2006,
        values=tuple(values),
    )
    rr = record_rank(YearMonth(2006, 3), 9.0, baseline)
    assert rr is not None
    assert rr.rank == 1
    anomaly = evaluate_anomaly(9.0, baseline)
    assert anomaly is not None
    assert rr.percentile == pytest.approx(anomaly.percentile_rank)


def test_record_rank_none_when_fewer_than_five_years() -> None:
    series = make_series(lambda m: 1.0, YearMonth(2001, 1), YearMonth(2004, 12))
    baseline = monthly_baselines(series)[1]
    assert baseline.n_years == 4
    assert record_rank(YearMonth(2004, 1), 1.0, baseline) is None


def test_record_rank_rejects_non_finite() -> None:
    series = make_series(lambda m: 1.0)
    with pytest.raises(ValueError):
        record_rank(YearMonth(2010, 1), float("nan"), monthly_baselines(series)[1])


# ---------------------------------------------------------------------------
# Latest complete month
# ---------------------------------------------------------------------------


def test_latest_complete_month_skips_provisional() -> None:
    series = make_series(
        lambda m: 1.0, YearMonth(2001, 1), YearMonth(2010, 10), provisional=YearMonth(2010, 11)
    )
    result = make_result(series, YearMonth(2010, 8), YearMonth(2010, 11))
    latest = latest_complete_month(result)
    assert latest is not None
    assert (latest.year, latest.month) == (2010, 10)


def test_latest_complete_month_none_without_complete_rows() -> None:
    series = make_series(
        lambda m: 1.0, YearMonth(2001, 1), YearMonth(2010, 10), provisional=YearMonth(2010, 11)
    )
    assert (
        latest_complete_month(make_result(series, YearMonth(2010, 11), YearMonth(2010, 11))) is None
    )


# ---------------------------------------------------------------------------
# Year to date versus median cumulative
# ---------------------------------------------------------------------------


def test_year_to_date_against_median_cumulative() -> None:
    # Year y has 10 + (y - 2001) per month for 2001..2010 (a 12-month year, season start January).
    series = make_series(lambda m: 10.0 + (m.year - 2001))
    ytd = year_to_date_vs_median(series, YearMonth(2010, 3))
    assert ytd is not None
    assert (ytd.season_year, ytd.month_of_season) == (2010, 3)
    assert ytd.count == pytest.approx(3 * 19.0)
    # Cumulative through month 3 over 2001..2010 is 3 * (10..19), the median of 10..19 is 14.5.
    assert ytd.n_seasons == 10
    assert ytd.median_cumulative == pytest.approx(3 * 14.5)
    assert ytd.percent_difference == pytest.approx(100 * (57 - 43.5) / 43.5)
    assert ytd.direction == "above"


def test_year_to_date_below_equal_and_zero_median() -> None:
    series = make_series(lambda m: 10.0)
    equal = year_to_date_vs_median(series, YearMonth(2010, 6))
    assert equal is not None
    assert equal.direction == "equal"
    assert equal.percent_difference == pytest.approx(0.0)

    zeros = make_series(lambda m: 4.0 if m.year == 2010 else 0.0)
    zero_median = year_to_date_vs_median(zeros, YearMonth(2010, 2))
    assert zero_median is not None
    assert zero_median.median_cumulative == 0.0
    assert zero_median.percent_difference is None
    assert zero_median.direction == "above"

    low = make_series(lambda m: 1.0 if m.year == 2010 else 5.0)
    below = year_to_date_vs_median(low, YearMonth(2010, 2))
    assert below is not None
    assert below.direction == "below"


def test_year_to_date_shifted_season_start() -> None:
    # Season starts in July, so 2005-02 is month 8 of the season that began in July 2004.
    series = make_series(lambda m: 1.0)
    ytd = year_to_date_vs_median(series, YearMonth(2005, 2), season_start_month=7)
    assert ytd is not None
    assert (ytd.season_year, ytd.month_of_season) == (2004, 8)
    assert ytd.count == pytest.approx(8.0)
    assert ytd.n_seasons == 9  # July 2001 to June 2010 gives nine full seasons.


def test_year_to_date_no_median_with_fewer_than_five_seasons() -> None:
    series = make_series(lambda m: 2.0, YearMonth(2001, 1), YearMonth(2004, 12))
    ytd = year_to_date_vs_median(series, YearMonth(2004, 6))
    assert ytd is not None
    assert ytd.n_seasons == 4
    assert ytd.median_cumulative is None
    assert ytd.direction is None
    assert ytd.percent_difference is None


def test_year_to_date_respects_baseline_years_and_season_gaps() -> None:
    series = make_series(lambda m: float(m.year - 2000))
    ytd = year_to_date_vs_median(series, YearMonth(2010, 1), baseline_years=range(2001, 2006))
    assert ytd is not None
    assert ytd.n_seasons == 5
    assert ytd.median_cumulative == pytest.approx(3.0)

    # The current season starts before the series: no year to date.
    partial = make_series(lambda m: 1.0, YearMonth(2001, 5), YearMonth(2010, 12))
    assert year_to_date_vs_median(partial, YearMonth(2001, 8)) is None


def test_year_to_date_rejects_bad_season_start() -> None:
    with pytest.raises(ValueError):
        year_to_date_vs_median(
            make_series(lambda m: 1.0), YearMonth(2010, 1), season_start_month=13
        )


# ---------------------------------------------------------------------------
# Peak months, all-zero baseline
# ---------------------------------------------------------------------------


def test_peak_months_lists_ties_in_calendar_order() -> None:
    series = make_series(lambda m: 7.0 if m.month in (3, 9) else 1.0)
    assert peak_months(monthly_baselines(series)) == (3, 9)


def test_peak_months_empty_without_activity() -> None:
    zeros = make_series(lambda m: 0.0)
    assert peak_months(monthly_baselines(zeros)) == ()
    assert peak_months({}) == ()


def test_baseline_all_zero() -> None:
    assert baseline_all_zero(monthly_baselines(make_series(lambda m: 0.0)))
    assert not baseline_all_zero(
        monthly_baselines(make_series(lambda m: 1.0 if m.month == 4 else 0.0))
    )
    assert not baseline_all_zero({})


# ---------------------------------------------------------------------------
# Briefing inputs
# ---------------------------------------------------------------------------


def test_briefing_inputs_collects_all_parts() -> None:
    series = make_series(
        lambda m: float(m.year - 2000) * (2.0 if m.month == 10 else 1.0),
        YearMonth(2001, 1),
        YearMonth(2010, 10),
        provisional=YearMonth(2010, 11),
    )
    result = make_result(series, YearMonth(2009, 1), YearMonth(2010, 11))
    inputs = briefing_inputs(result, series)
    assert inputs.latest_complete == YearMonth(2010, 10)
    assert inputs.latest_complete_harmonized == 20.0
    assert not inputs.short_record
    assert inputs.record_rank is not None
    assert inputs.record_rank.rank == 1
    assert inputs.year_to_date is not None
    assert inputs.year_to_date.through == YearMonth(2010, 10)
    assert inputs.peak_months == (10,)
    assert not inputs.baseline_all_zero
    assert inputs.provisional_months == (YearMonth(2010, 11),)


def test_briefing_inputs_short_record_omits_rank() -> None:
    series = make_series(lambda m: 1.0, YearMonth(2001, 1), YearMonth(2004, 12))
    assert len(complete_years(series)) == 4
    inputs = briefing_inputs(make_result(series, YearMonth(2004, 1), YearMonth(2004, 12)), series)
    assert inputs.short_record
    assert inputs.record_rank is None
    assert inputs.latest_complete == YearMonth(2004, 12)


def test_briefing_inputs_without_complete_month() -> None:
    series = make_series(
        lambda m: 1.0, YearMonth(2001, 1), YearMonth(2010, 10), provisional=YearMonth(2010, 11)
    )
    inputs = briefing_inputs(make_result(series, YearMonth(2010, 11), YearMonth(2010, 11)), series)
    assert inputs.latest_complete is None
    assert inputs.latest_complete_harmonized is None
    assert inputs.record_rank is None
    assert inputs.year_to_date is None
    assert inputs.provisional_months == (YearMonth(2010, 11),)


def test_briefing_inputs_all_zero_area() -> None:
    series = make_series(lambda m: 0.0)
    inputs = briefing_inputs(make_result(series, YearMonth(2010, 1), YearMonth(2010, 12)), series)
    assert inputs.baseline_all_zero
    assert inputs.peak_months == ()
    assert inputs.record_rank is not None
    assert inputs.record_rank.rank == 1

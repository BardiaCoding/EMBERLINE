"""Convert an `AreaResult` (unrounded) into the API response models.

This is the only place where values are rounded (requirement 9.6, design section 8.5):

- harmonized counts and every sum or difference of them (month and year totals, baseline
  statistics, absolute anomaly): one decimal place, in MODIS-equivalent cell-days;
- raw MODIS and raw VIIRS cell-days: integers, never added to each other;
- FRP area totals: one decimal place in MW, `None` when no FRP value exists (shown as a dash);
- percent difference and percentile rank: one decimal place, z-score: two decimal places.

Ties round half up (away from zero for a tie on a negative value), applied to the exact binary
value of the float, which matches `Number.prototype.toFixed` for the positive counts the
front end shows.

Provisional months (design G9, requirements 15.17 to 15.19): `provisional` is the grid
`incomplete` flag carried by the `AreaResult` row, never inferred here. A provisional month, and a
year that contains one, always gets a null `anomaly`. The result lists them in
`provisional_months` as `YYYY-MM`. They never enter a baseline (the `AreaResult` baselines come
from the zero-filled series, which holds complete months only), and rankings must skip them.

`lower_bound` and `upper_bound` are deferred (requirement 7) and are always null.
"""

from __future__ import annotations

import math
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

import hotspots.areastats as ast
import hotspots.stats as st
from hotspots.api import schemas
from hotspots.data.types import YearMonth

COUNT_DECIMALS = 1
"""Decimals for harmonized counts, sums, baseline statistics and absolute anomalies."""
PERCENT_DECIMALS = 1
RANK_DECIMALS = 1
ZSCORE_DECIMALS = 2
FRP_DECIMALS = 1


def round_half_up(value: float, decimals: int) -> float:
    """Round ``value`` to ``decimals`` places, ties half up, and never return negative zero.

    Raises:
        ValueError: When ``value`` is not finite.
    """
    if not math.isfinite(value):
        raise ValueError("cannot round a non-finite value")
    exact = Decimal(value)  # exact binary value, no repr rounding
    rounded = float(exact.quantize(Decimal(1).scaleb(-decimals), rounding=ROUND_HALF_UP))
    return rounded + 0.0  # `+ 0.0` turns -0.0 into 0.0


def _opt(value: float | None, decimals: int) -> float | None:
    return None if value is None else round_half_up(value, decimals)


def _ym(month: YearMonth | None) -> str | None:
    return None if month is None else str(month)


def serialize_anomaly(
    anomaly: ast.Anomaly | None, *, provisional: bool = False
) -> schemas.Anomaly | None:
    """Anomaly model, or `None` for a provisional month or year or when there is no anomaly."""
    if anomaly is None or provisional:
        return None
    return schemas.Anomaly(
        absolute=round_half_up(anomaly.absolute, COUNT_DECIMALS),
        percent=_opt(anomaly.percent, PERCENT_DECIMALS),
        percent_text=anomaly.percent_text,
        zscore=_opt(anomaly.zscore, ZSCORE_DECIMALS),
        percentile_rank=round_half_up(anomaly.percentile_rank, RANK_DECIMALS),
        baseline_start_year=anomaly.baseline_start_year,
        baseline_end_year=anomaly.baseline_end_year,
        n_years=anomaly.n_years,
    )


def serialize_month(row: ast.MonthRow) -> schemas.MonthRow:
    """Month model with rounded values. Bounds stay null (requirement 7 is deferred)."""
    return schemas.MonthRow(
        year=row.year,
        month=row.month,
        harmonized=round_half_up(row.harmonized, COUNT_DECIMALS),
        raw_modis=int(row.raw_modis),
        raw_viirs=int(row.raw_viirs),
        frp_sum_mw=_opt(row.frp_sum_mw, FRP_DECIMALS),
        source_flag=row.source_flag,
        calib_model=row.calib_model,
        provenance=row.provenance,
        provisional=bool(row.provisional),
        lower_bound=None,
        upper_bound=None,
        anomaly=serialize_anomaly(row.anomaly, provisional=row.provisional),
    )


def serialize_year(row: ast.YearRow) -> schemas.YearRow:
    """Year model with rounded values. A year containing a provisional month has no anomaly."""
    return schemas.YearRow(
        year=row.year,
        harmonized=round_half_up(row.harmonized, COUNT_DECIMALS),
        raw_modis=int(row.raw_modis),
        raw_viirs=int(row.raw_viirs),
        frp_sum_mw=_opt(row.frp_sum_mw, FRP_DECIMALS),
        n_months=row.n_months,
        provisional=bool(row.provisional),
        anomaly=serialize_anomaly(row.anomaly, provisional=row.provisional),
    )


def _baseline_stats(baseline: ast.Baseline) -> dict[str, float | int | None]:
    assert baseline.median is not None
    assert baseline.p10 is not None
    assert baseline.p90 is not None
    assert baseline.mean is not None
    return {
        "median": round_half_up(baseline.median, COUNT_DECIMALS),
        "p10": round_half_up(baseline.p10, COUNT_DECIMALS),
        "p90": round_half_up(baseline.p90, COUNT_DECIMALS),
        "mean": round_half_up(baseline.mean, COUNT_DECIMALS),
        "std": _opt(baseline.std, COUNT_DECIMALS),
        "n_years": baseline.n_years,
    }


def serialize_baseline_row(month: int, baseline: ast.Baseline) -> schemas.BaselineRow | None:
    """Baseline of one calendar month, or `None` when no baseline year contributed a value."""
    if baseline.n_years == 0:
        return None
    return schemas.BaselineRow.model_validate({"month": month, **_baseline_stats(baseline)})


def serialize_baseline_year(baseline: ast.Baseline) -> schemas.BaselineStats | None:
    """Year-level baseline, or `None` when there is no complete baseline year."""
    if baseline.n_years == 0:
        return None
    return schemas.BaselineStats.model_validate(_baseline_stats(baseline))


def serialize_coverage(coverage: ast.Coverage) -> schemas.Coverage:
    """Coverage model. Months are `YYYY-MM` strings."""
    return schemas.Coverage(
        first_month=_ym(coverage.first_month),
        last_month=_ym(coverage.last_month),
        n_months=coverage.n_months,
        requested_start=coverage.requested_start,
        requested_end=coverage.requested_end,
        starts_mid_month=coverage.starts_mid_month,
        ends_mid_month=coverage.ends_mid_month,
        before_record=coverage.before_record,
        after_latest=coverage.after_latest,
    )


def serialize_stats_summary(years: list[schemas.YearRow], n_months: int) -> schemas.StatsSummary:
    """Totals over the (already rounded) yearly rows.

    The harmonized total is the sum of the yearly values as displayed, so the card equals the
    sum of the yearly bars (requirement 16.10). Raw MODIS and raw VIIRS stay separate.
    """
    frp = [y.frp_sum_mw for y in years if y.frp_sum_mw is not None]
    return schemas.StatsSummary(
        total_harmonized=round_half_up(math.fsum(y.harmonized for y in years), COUNT_DECIMALS),
        raw_modis=sum(y.raw_modis for y in years),
        raw_viirs=sum(y.raw_viirs for y in years),
        frp_sum_mw=round_half_up(math.fsum(frp), FRP_DECIMALS) if frp else None,
        n_months=n_months,
        includes_provisional=any(y.provisional for y in years),
    )


def serialize_current_month(result: ast.AreaResult, end: date) -> schemas.CurrentMonthOut | None:
    """The month that contains ``end`` against its baseline, `None` when it is not in the result.

    The provisional month shows its count to date, no baseline median and no anomaly.
    """
    row = next((m for m in result.months if (m.year, m.month) == (end.year, end.month)), None)
    if row is None:
        return None
    baseline = result.baseline_by_month[row.month]
    comparable = not row.provisional and baseline.n_years > 0 and baseline.median is not None
    return schemas.CurrentMonthOut(
        year=row.year,
        month=row.month,
        harmonized=round_half_up(row.harmonized, COUNT_DECIMALS),
        provisional=bool(row.provisional),
        baseline_median=(
            round_half_up(baseline.median, COUNT_DECIMALS)
            if comparable and baseline.median is not None
            else None
        ),
        baseline_n_years=baseline.n_years,
        anomaly=serialize_anomaly(row.anomaly, provisional=row.provisional),
    )


def serialize_current_year(result: ast.AreaResult, end: date) -> schemas.CurrentYearOut | None:
    """The year that contains ``end`` against the yearly baseline, `None` when not in the result.

    The baseline comparison is given only for a full, non-provisional year (the same rule as
    `YearRow.anomaly`), so a partial total is never set beside full-year totals.
    """
    row = next((y for y in result.years if y.year == end.year), None)
    if row is None:
        return None
    anomaly = serialize_anomaly(row.anomaly, provisional=row.provisional)
    baseline = result.baseline_year
    return schemas.CurrentYearOut(
        year=row.year,
        harmonized=round_half_up(row.harmonized, COUNT_DECIMALS),
        n_months=row.n_months,
        provisional=bool(row.provisional),
        baseline_median=(
            round_half_up(baseline.median, COUNT_DECIMALS)
            if anomaly is not None and baseline.median is not None
            else None
        ),
        baseline_n_years=baseline.n_years,
        percentile_rank=None if anomaly is None else anomaly.percentile_rank,
        anomaly=anomaly,
    )


def serialize_briefing_inputs(inputs: st.BriefingInputs) -> schemas.BriefingInputsOut:
    """Briefing numbers with rounded values. Months are `YYYY-MM` strings."""
    rank = inputs.record_rank
    ytd = inputs.year_to_date
    return schemas.BriefingInputsOut(
        latest_complete=_ym(inputs.latest_complete),
        latest_complete_harmonized=_opt(inputs.latest_complete_harmonized, COUNT_DECIMALS),
        short_record=inputs.short_record,
        record_rank=(
            None
            if rank is None
            else schemas.RecordRankOut(
                month=str(rank.month),
                harmonized=round_half_up(rank.harmonized, COUNT_DECIMALS),
                rank=rank.rank,
                n_years=rank.n_years,
                percentile=round_half_up(rank.percentile, RANK_DECIMALS),
                since_year=rank.since_year,
            )
        ),
        year_to_date=(
            None
            if ytd is None
            else schemas.YearToDateOut(
                season_year=ytd.season_year,
                season_start_month=ytd.season_start_month,
                month_of_season=ytd.month_of_season,
                through=str(ytd.through),
                count=round_half_up(ytd.count, COUNT_DECIMALS),
                median_cumulative=_opt(ytd.median_cumulative, COUNT_DECIMALS),
                n_seasons=ytd.n_seasons,
                percent_difference=_opt(ytd.percent_difference, PERCENT_DECIMALS),
                direction=ytd.direction,
            )
        ),
        peak_months=list(inputs.peak_months),
        baseline_all_zero=inputs.baseline_all_zero,
        provisional_months=[str(ym) for ym in inputs.provisional_months],
    )


def serialize_watch(watch: st.WatchResult) -> schemas.WatchOut:
    """Watch model: counts and median to one decimal, percentile to one decimal."""
    return schemas.WatchOut(
        level=watch.level,
        count=_opt(watch.count, COUNT_DECIMALS),
        median=_opt(watch.median, COUNT_DECIMALS),
        percentile=_opt(watch.percentile_rank, RANK_DECIMALS),
        period=_ym(watch.month),
        baseline_start=watch.baseline_start_year,
        baseline_end=watch.baseline_end_year,
        n_years=watch.n_years,
        provisional=watch.provisional_month is not None,
        provisional_month=_ym(watch.provisional_month),
        provisional_count=_opt(watch.provisional_count, COUNT_DECIMALS),
        reason=watch.reason,
        threshold=watch.threshold,
    )


def serialize_stats(
    result: ast.AreaResult,
    end: date,
    briefing: st.BriefingInputs,
    watch: st.WatchResult | None = None,
) -> schemas.StatsOut:
    """Build the `/stats` response from an `AreaResult`, its briefing inputs and watch result.

    ``end`` is the end of the date range: the current month and year are the ones that contain
    it. Rankings skip the provisional month and its year. `watch` is null when not given.
    """
    years = [serialize_year(r) for r in result.years]
    return schemas.StatsOut(
        summary=serialize_stats_summary(years, len(result.months)),
        current_month=serialize_current_month(result, end),
        current_year=serialize_current_year(result, end),
        top_months=[
            schemas.RankedMonthOut(
                year=m.year, month=m.month, harmonized=round_half_up(m.harmonized, COUNT_DECIMALS)
            )
            for m in st.top_months(result.months)
        ],
        top_years=[
            schemas.RankedYearOut(
                year=y.year,
                harmonized=round_half_up(y.harmonized, COUNT_DECIMALS),
                n_months=y.n_months,
            )
            for y in st.top_years(result.years)
        ],
        seasonal_profile=[
            schemas.SeasonalPointOut(
                month=p.month,
                median=_opt(p.median, COUNT_DECIMALS),
                p10=_opt(p.p10, COUNT_DECIMALS),
                p90=_opt(p.p90, COUNT_DECIMALS),
                n_years=p.n_years,
            )
            for p in st.seasonal_profile(result.baseline_by_month)
        ],
        briefing_inputs=serialize_briefing_inputs(briefing),
        watch=None if watch is None else serialize_watch(watch),
        coverage=serialize_coverage(result.coverage),
        n_cells=result.n_cells,
        notice=result.notice,
        provisional_months=[str(ym) for ym in result.provisional_months],
    )


def serialize_area_result(result: ast.AreaResult) -> schemas.CalendarOut:
    """Build the calendar response from an `AreaResult`.

    Baselines for calendar months without any baseline year are left out of `baseline_by_month`.
    """
    baseline_rows = [
        row
        for month in sorted(result.baseline_by_month)
        if (row := serialize_baseline_row(month, result.baseline_by_month[month])) is not None
    ]
    return schemas.CalendarOut(
        months=[serialize_month(r) for r in result.months],
        years=[serialize_year(r) for r in result.years],
        baseline_by_month=baseline_rows,
        baseline_year=serialize_baseline_year(result.baseline_year),
        coverage=serialize_coverage(result.coverage),
        n_cells=result.n_cells,
        notice=result.notice,
        provisional_months=[str(ym) for ym in result.provisional_months],
    )


def serialize_season(result: ast.AreaResult, tracker: st.SeasonTracker) -> schemas.SeasonOut:
    """Build the `/season` response. Counts have one decimal, the percent of median one decimal."""
    start = tracker.season_start_month
    envelope = (
        None
        if tracker.envelope is None
        else [
            schemas.SeasonEnvelopeOut(
                month_of_season=p.month_of_season,
                calendar_month=(start - 1 + p.month_of_season - 1) % 12 + 1,
                p10=round_half_up(p.p10, COUNT_DECIMALS),
                median=round_half_up(p.median, COUNT_DECIMALS),
                p90=round_half_up(p.p90, COUNT_DECIMALS),
            )
            for p in tracker.envelope
        ]
    )
    return schemas.SeasonOut(
        season_start_month=start,
        season_year=tracker.season_year,
        selected=[round_half_up(v, COUNT_DECIMALS) for v in tracker.selected],
        through=_ym(tracker.through),
        count=_opt(tracker.count, COUNT_DECIMALS),
        median_cumulative=_opt(tracker.median_cumulative, COUNT_DECIMALS),
        percent_of_median=_opt(tracker.percent_of_median, PERCENT_DECIMALS),
        envelope=envelope,
        n_envelope_years=tracker.n_envelope_years,
        curves=[
            schemas.SeasonCurveOut(
                season_year=c.season_year,
                cumulative=[round_half_up(v, COUNT_DECIMALS) for v in c.cumulative],
                complete=c.complete,
            )
            for c in tracker.curves
        ],
        provisional_month=_ym(tracker.provisional_month),
        provisional_count=_opt(tracker.provisional_count, COUNT_DECIMALS),
        reason=tracker.reason,
        available_season_years=[c.season_year for c in tracker.curves],
        coverage=serialize_coverage(result.coverage),
        n_cells=result.n_cells,
        notice=result.notice,
    )

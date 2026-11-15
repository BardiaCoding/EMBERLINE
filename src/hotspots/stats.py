"""Statistics on top of the area result: rankings, seasonal profile and briefing inputs.

Pure functions, no I/O (design section 9). They read `hotspots.areastats` values and add no new
data. All counts are MODIS-equivalent cell-days (harmonized) on the fixed UTC-8 local-day
convention. Nothing is rounded here, the API serializer rounds. The provisional (incomplete)
month and any year that contains it are never ranked and never evaluated against a baseline.

The monthly watch level is here. The season tracker envelope is a separate task and is not part
of this module yet.
"""

from __future__ import annotations

import math
from collections.abc import Collection, Iterable, Mapping
from dataclasses import dataclass
from typing import Literal

import numpy as np

from hotspots.areastats import (
    MIN_BASELINE_YEARS,
    AreaResult,
    Baseline,
    MonthRow,
    YearRow,
    ZeroFilledSeries,
    complete_years,
)
from hotspots.data.types import YearMonth

TOP_N: int = 10
"""Length of the month and year rankings (requirement 16.5)."""

MIN_SEASON_YEARS: int = MIN_BASELINE_YEARS
"""Fewer season years than this give no median cumulative (design section 9, season tracker)."""

Direction = Literal["above", "below", "equal"]


# ---------------------------------------------------------------------------
# Rankings (requirement 16.5, 10.11)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class RankedMonth:
    """A month in the top-N ranking. `harmonized` is MODIS-equivalent cell-days."""

    year: int
    month: int
    harmonized: float


@dataclass(frozen=True)
class RankedYear:
    """A year in the top-N ranking.

    `n_months` is the number of months of that year inside the query (12 for a full year). A
    year with fewer than 12 months is a partial total and the UI should say so.
    """

    year: int
    harmonized: float
    n_months: int


def top_months(months: Iterable[MonthRow], n: int = TOP_N) -> tuple[RankedMonth, ...]:
    """Top ``n`` months by harmonized count, descending, ties by earlier month first.

    The provisional month is left out. Holds ``min(n, number of complete months)`` entries.
    """
    if n < 0:
        raise ValueError("n must not be negative")
    complete = [m for m in months if not m.provisional]
    ordered = sorted(complete, key=lambda m: (-m.harmonized, m.year, m.month))
    return tuple(RankedMonth(m.year, m.month, m.harmonized) for m in ordered[:n])


def top_years(years: Iterable[YearRow], n: int = TOP_N) -> tuple[RankedYear, ...]:
    """Top ``n`` years by harmonized total, descending, ties by earlier year first.

    A year that contains the provisional month is left out (requirement 10.11).
    """
    if n < 0:
        raise ValueError("n must not be negative")
    complete = [y for y in years if not y.provisional]
    ordered = sorted(complete, key=lambda y: (-y.harmonized, y.year))
    return tuple(RankedYear(y.year, y.harmonized, y.n_months) for y in ordered[:n])


# ---------------------------------------------------------------------------
# Seasonal profile (requirement 16.3)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SeasonalPoint:
    """Baseline of one calendar month. Statistics are `None` when `n_years == 0`."""

    month: int
    median: float | None
    p10: float | None
    p90: float | None
    n_years: int


def seasonal_profile(baseline_by_month: Mapping[int, Baseline]) -> tuple[SeasonalPoint, ...]:
    """Median, p10 and p90 for each calendar month 1 to 12, in calendar order.

    A month missing from ``baseline_by_month`` is returned as an empty point.
    """
    points: list[SeasonalPoint] = []
    for month in range(1, 13):
        b = baseline_by_month.get(month)
        if b is None or b.n_years == 0:
            points.append(SeasonalPoint(month, None, None, None, 0))
        else:
            points.append(SeasonalPoint(month, b.median, b.p10, b.p90, b.n_years))
    return tuple(points)


# ---------------------------------------------------------------------------
# Briefing inputs (requirement 23.1 to 23.3, 23.5 to 23.7, 23.9)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class RecordRank:
    """Rank and percentile of one month among the same calendar months of the baseline.

    `rank` is 1 for the highest count and tied counts share the best rank (1 plus the number of
    strictly higher values). `percentile` is the mid-rank percentile 100 (L + 0.5 E) / N in 0 to
    100, the same formula as `Anomaly.percentile_rank`, so both show the same number.
    `n_years` is N and `since_year` the first baseline year that contributed.
    """

    month: YearMonth
    harmonized: float
    rank: int
    n_years: int
    percentile: float
    since_year: int


def record_rank(month: YearMonth, value: float, baseline: Baseline) -> RecordRank | None:
    """Rank and percentile of ``value`` among the baseline values of its calendar month.

    Returns ``None`` when the baseline has fewer than 5 years (record too short, requirement
    23.5). Raises ``ValueError`` when ``value`` is not finite.
    """
    if not math.isfinite(value):
        raise ValueError("count must be finite")
    if baseline.n_years < MIN_BASELINE_YEARS or baseline.start_year is None:
        return None
    vals = np.asarray(baseline.values, dtype=np.float64)
    higher = int((vals > value).sum())
    less = int((vals < value).sum())
    equal = int((vals == value).sum())
    return RecordRank(
        month=month,
        harmonized=value,
        rank=1 + higher,
        n_years=baseline.n_years,
        percentile=100.0 * (less + 0.5 * equal) / baseline.n_years,
        since_year=baseline.start_year,
    )


def latest_complete_month(result: AreaResult) -> MonthRow | None:
    """The most recent complete (not provisional) month of the result, `None` when there is none.

    The result only holds months that overlap the date range, so this month is never after the
    end of the range.
    """
    complete = [m for m in result.months if not m.provisional]
    return complete[-1] if complete else None


@dataclass(frozen=True)
class YearToDate:
    """Cumulative count of the current season year through ``through`` against the median.

    A season year starts in `season_start_month` of `season_year` and runs 12 months.
    `month_of_season` is 1 to 12 for ``through``. `count` is the harmonized cell-day sum from the
    season start through ``through``. `median_cumulative` is the median of the same cumulative
    over the baseline seasons, `None` when fewer than 5 such seasons exist (`n_seasons` says how
    many). `percent_difference` is 100 (count - median) / median, `None` when the median is 0 or
    missing. `direction` is `None` when the median is missing.
    """

    season_year: int
    season_start_month: int
    month_of_season: int
    through: YearMonth
    count: float
    median_cumulative: float | None
    n_seasons: int
    percent_difference: float | None
    direction: Direction | None


def _season_start(month: YearMonth, season_start_month: int) -> YearMonth:
    year = month.year if month.month >= season_start_month else month.year - 1
    return YearMonth(year, season_start_month)


def _season_cumulative(
    by_index: Mapping[int, float], start: YearMonth, length: int
) -> list[float] | None:
    """Cumulative sums over ``length`` months from ``start``, `None` when a month is missing."""
    total = 0.0
    out: list[float] = []
    for i in range(length):
        value = by_index.get(start.index + i)
        if value is None:
            return None
        total += value
        out.append(total)
    return out


def year_to_date_vs_median(
    series: ZeroFilledSeries,
    through: YearMonth,
    baseline_years: Collection[int] | None = None,
    season_start_month: int = 1,
) -> YearToDate | None:
    """Year-to-date cumulative against the baseline median cumulative (requirement 23.2).

    Args:
        series: Zero-filled series of in-record complete months.
        through: The latest complete month. It must be a month of ``series``.
        baseline_years: Optional baseline period. A baseline season counts only when each of its
            12 months is in the series and has a year in this collection. `None` uses every
            season with 12 months in the series.
        season_start_month: First month of a season year, 1 to 12 (default January).

    Returns:
        `None` when the season of ``through`` has a month missing from the series (for example
        it starts before the record). Otherwise a `YearToDate`.
    """
    if not 1 <= season_start_month <= 12:
        raise ValueError("season_start_month must be 1 to 12")
    allowed = None if baseline_years is None else set(baseline_years)
    by_index = {ym.index: float(x) for ym, x in zip(series.months, series.harmonized, strict=True)}

    current_start = _season_start(through, season_start_month)
    k = through.index - current_start.index + 1
    current = _season_cumulative(by_index, current_start, k)
    if current is None:
        return None
    count = current[-1]

    seasons: list[float] = []
    first_year = min((ym.year for ym in series.months), default=current_start.year)
    last_year = max((ym.year for ym in series.months), default=current_start.year)
    for year in range(first_year, last_year + 1):
        start = YearMonth(year, season_start_month)
        if allowed is not None and any(
            YearMonth.from_index(start.index + i).year not in allowed for i in range(12)
        ):
            continue
        cumulative = _season_cumulative(by_index, start, 12)
        if cumulative is not None:
            seasons.append(cumulative[k - 1])

    median: float | None = None
    percent: float | None = None
    direction: Direction | None = None
    if len(seasons) >= MIN_SEASON_YEARS:
        median = float(np.percentile(np.asarray(seasons, dtype=np.float64), 50, method="linear"))
        if median != 0:
            candidate = 100.0 * (count - median) / median
            percent = candidate if math.isfinite(candidate) else None
        direction = "above" if count > median else "below" if count < median else "equal"

    return YearToDate(
        season_year=current_start.year,
        season_start_month=season_start_month,
        month_of_season=k,
        through=through,
        count=count,
        median_cumulative=median,
        n_seasons=len(seasons),
        percent_difference=percent,
        direction=direction,
    )


def peak_months(baseline_by_month: Mapping[int, Baseline]) -> tuple[int, ...]:
    """Calendar months with the highest baseline median, in calendar order (requirement 23.3).

    Ties are all returned. Empty when no month has a baseline or the highest median is 0.
    """
    medians = {
        m: b.median for m, b in baseline_by_month.items() if b.n_years > 0 and b.median is not None
    }
    if not medians:
        return ()
    top = max(medians.values())
    if top <= 0:
        return ()
    return tuple(sorted(m for m, v in medians.items() if math.isclose(v, top, rel_tol=1e-12)))


def baseline_all_zero(baseline_by_month: Mapping[int, Baseline]) -> bool:
    """True when the baseline has values and every one of them is 0 (requirement 23.7)."""
    values = [v for b in baseline_by_month.values() for v in b.values]
    return bool(values) and all(v == 0 for v in values)


@dataclass(frozen=True)
class BriefingInputs:
    """Numbers behind the plain-language briefing, all taken from the same query result.

    `latest_complete` is the latest complete month in the query, `None` when there is none.
    `record_rank` is `None` when `short_record` is True (fewer than 5 complete years in the
    series) or the baseline for that calendar month has fewer than 5 years. `year_to_date` is
    `None` when there is no latest complete month or its season is incomplete in the record.
    `baseline_all_zero` is True when the area has no activity in the baseline period, in which
    case the year-to-date and peak-month sentences are replaced. `peak_months` lists the calendar
    months with the highest baseline median. `provisional_months` are mentioned only as
    provisional and not evaluated. Monthly only, no day-level values.
    """

    latest_complete: YearMonth | None
    latest_complete_harmonized: float | None
    short_record: bool
    record_rank: RecordRank | None
    year_to_date: YearToDate | None
    peak_months: tuple[int, ...]
    baseline_all_zero: bool
    provisional_months: tuple[YearMonth, ...]


def briefing_inputs(
    result: AreaResult,
    series: ZeroFilledSeries,
    baseline_years: Collection[int] | None = None,
    season_start_month: int = 1,
) -> BriefingInputs:
    """Collect the briefing numbers for a query (design section 9, requirement 23).

    Args:
        result: Area result for the query (months in the date range, baselines).
        series: The zero-filled series the result was built from.
        baseline_years: Baseline period used for ``result``, `None` for the default.
        season_start_month: First month of a season year (default January).
    """
    latest = latest_complete_month(result)
    short = len(complete_years(series)) < MIN_BASELINE_YEARS
    all_zero = baseline_all_zero(result.baseline_by_month)

    ym: YearMonth | None = None
    rank: RecordRank | None = None
    ytd: YearToDate | None = None
    if latest is not None:
        ym = YearMonth(latest.year, latest.month)
        if not short:
            rank = record_rank(ym, latest.harmonized, result.baseline_by_month[latest.month])
        ytd = year_to_date_vs_median(series, ym, baseline_years, season_start_month)

    return BriefingInputs(
        latest_complete=ym,
        latest_complete_harmonized=None if latest is None else latest.harmonized,
        short_record=short,
        record_rank=rank,
        year_to_date=ytd,
        peak_months=peak_months(result.baseline_by_month),
        baseline_all_zero=all_zero,
        provisional_months=result.provisional_months,
    )


# ---------------------------------------------------------------------------
# Watch level (requirement 20.7 to 20.9, 20.13 to 20.16)
# ---------------------------------------------------------------------------

WatchLevel = Literal["Above normal", "Within normal range", "Not available"]

DEFAULT_WATCH_THRESHOLD: float = 90.0
"""Percentile rank above which a month is "Above normal". DEFAULT (confirm)."""


@dataclass(frozen=True)
class WatchResult:
    """Watch level of the latest complete month, monthly only (the 7-day watch is deferred).

    `count` is the harmonized count (MODIS-equivalent cell-days) of `month`. `median`,
    `percentile_rank` (mid-rank, 0 to 100, the same number as `Anomaly.percentile_rank`),
    `baseline_start_year`, `baseline_end_year` and `n_years` come from the zero-filled baseline of
    that calendar month. For "Not available", `reason` says why and the fields that cannot be
    known are `None`. The provisional (incomplete) latest month is returned beside the result with
    its count to date and is never evaluated.
    """

    level: WatchLevel
    month: YearMonth | None
    count: float | None
    median: float | None
    percentile_rank: float | None
    baseline_start_year: int | None
    baseline_end_year: int | None
    n_years: int
    threshold: float
    reason: str | None
    provisional_month: YearMonth | None = None
    provisional_count: float | None = None


def watch_level(
    series: ZeroFilledSeries,
    baseline_by_month: Mapping[int, Baseline],
    threshold: float = DEFAULT_WATCH_THRESHOLD,
) -> WatchResult:
    """Watch level of the latest complete month (requirement 20.8, 20.9, 20.13, 20.14, 20.16).

    Args:
        series: Zero-filled series of in-record complete months. Its last month is evaluated. Its
            `provisional` months, if any, are returned as provisional and not evaluated.
        baseline_by_month: Baselines from `monthly_baselines` for the same query.
        threshold: Percentile rank (0 to 100, exclusive) above which the level is "Above normal".

    Returns:
        A `WatchResult`. "Not available" with a reason when the series is empty or the baseline of
        that calendar month has fewer than 5 years. Otherwise "Above normal" when the mid-rank
        percentile is greater than ``threshold``, else "Within normal range".

    Raises:
        ValueError: When ``threshold`` is not greater than 0 and less than 100.
    """
    if not 0 < threshold < 100:
        raise ValueError("threshold must be greater than 0 and less than 100")

    prov = max(series.provisional, key=lambda p: p.month.index, default=None)
    prov_month = None if prov is None else prov.month
    prov_count = None if prov is None else prov.harmonized

    def not_available(
        reason: str, month: YearMonth | None = None, count: float | None = None, n_years: int = 0
    ) -> WatchResult:
        return WatchResult(
            level="Not available",
            month=month,
            count=count,
            median=None,
            percentile_rank=None,
            baseline_start_year=None,
            baseline_end_year=None,
            n_years=n_years,
            threshold=threshold,
            reason=reason,
            provisional_month=prov_month,
            provisional_count=prov_count,
        )

    if not series.months:
        return not_available("No complete month in the record for this area.")

    month = series.months[-1]
    count = float(series.harmonized[-1])
    baseline = baseline_by_month.get(month.month)
    n_years = 0 if baseline is None else baseline.n_years
    if baseline is None or n_years < MIN_BASELINE_YEARS or baseline.median is None:
        return not_available(
            f"Fewer than {MIN_BASELINE_YEARS} baseline years for this calendar month "
            f"({n_years} available).",
            month,
            count,
            n_years,
        )

    vals = np.asarray(baseline.values, dtype=np.float64)
    less = int((vals < count).sum())
    equal = int((vals == count).sum())
    percentile = 100.0 * (less + 0.5 * equal) / n_years
    level: WatchLevel = "Above normal" if percentile > threshold else "Within normal range"
    return WatchResult(
        level=level,
        month=month,
        count=count,
        median=baseline.median,
        percentile_rank=percentile,
        baseline_start_year=baseline.start_year,
        baseline_end_year=baseline.end_year,
        n_years=n_years,
        threshold=threshold,
        reason=None,
        provisional_month=prov_month,
        provisional_count=prov_count,
    )


# ---------------------------------------------------------------------------
# Season tracker (requirement 21.1 to 21.3, 21.6 to 21.8, 21.10), monthly resolution
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class SeasonCurve:
    """Cumulative harmonized cell-days of one season year at month-of-season 1, 2, ...

    ``cumulative`` is as long as the number of months of the season that are in the series
    (12 for a complete season, fewer for the in-progress one). Seasons whose first month is not
    in the series have no curve. Month-of-season 1 is `season_start_month`.
    """

    season_year: int
    cumulative: tuple[float, ...]
    complete: bool


@dataclass(frozen=True)
class SeasonEnvelopePoint:
    """Median, p10 and p90 of the cumulative counts at one month-of-season (1 to 12)."""

    month_of_season: int
    p10: float
    median: float
    p90: float


@dataclass(frozen=True)
class SeasonTracker:
    """Season tracker of an area at monthly resolution (the timing metrics are deferred).

    `season_year` is the selected season year (the year in which the season starts), `None` when
    it has no curve (see `reason`). `selected` is its cumulative curve, which stops at the latest
    complete month, so the provisional month is never in it (`provisional_month` and
    `provisional_count` are returned beside it). `envelope` holds the 12 points over the
    ``n_envelope_years`` season years that lie entirely inside the baseline period, and is `None`
    when there are fewer than 5. `count`, `median_cumulative` and `percent_of_median`
    (100 x count / median) are taken at `through`, the last month of the selected curve.
    `percent_of_median` is `None` when the median is 0 or missing. Counts are MODIS-equivalent
    cell-days, months are fixed UTC-8.
    """

    season_start_month: int
    season_year: int | None
    selected: tuple[float, ...]
    through: YearMonth | None
    count: float | None
    median_cumulative: float | None
    percent_of_median: float | None
    envelope: tuple[SeasonEnvelopePoint, ...] | None
    n_envelope_years: int
    curves: tuple[SeasonCurve, ...]
    provisional_month: YearMonth | None
    provisional_count: float | None
    reason: str | None


def season_tracker(
    series: ZeroFilledSeries,
    baseline_years: Collection[int] | None = None,
    season_start_month: int = 1,
    season_year: int | None = None,
) -> SeasonTracker:
    """Cumulative season curves against the p10, median and p90 envelope (requirement 21).

    Args:
        series: Zero-filled series of in-record complete months. Its `provisional` months are
            never in a curve or the envelope.
        baseline_years: Optional baseline period. A season year is in the envelope only when all
            12 of its months are in the series and in this collection. `None` uses every season
            with 12 months in the series.
        season_start_month: First calendar month of a season year, 1 to 12 (default January).
            Every calendar month maps to the same month-of-season in every season year.
        season_year: The season year to select. `None` selects the season of the latest complete
            month.

    Returns:
        A `SeasonTracker`. With an empty series, or a ``season_year`` that has no curve, the
        selection is empty and `reason` says why.

    Raises:
        ValueError: When ``season_start_month`` is not 1 to 12.
    """
    if not 1 <= season_start_month <= 12:
        raise ValueError("season_start_month must be 1 to 12")
    allowed = None if baseline_years is None else set(baseline_years)
    by_index = {ym.index: float(x) for ym, x in zip(series.months, series.harmonized, strict=True)}
    prov = max(series.provisional, key=lambda p: p.month.index, default=None)

    curves: list[SeasonCurve] = []
    if series.months:
        first = _season_start(series.months[0], season_start_month).year
        last = _season_start(series.months[-1], season_start_month).year
        for year in range(first, last + 1):
            start = YearMonth(year, season_start_month)
            values: list[float] = []
            for i in range(12):
                value = by_index.get(start.index + i)
                if value is None:
                    break
                values.append(value)
            if not values or by_index.get(start.index) is None:
                continue
            cumulative = tuple(float(v) for v in np.cumsum(values))
            curves.append(SeasonCurve(year, cumulative, len(cumulative) == 12))

    in_baseline = [
        c
        for c in curves
        if c.complete
        and (
            allowed is None
            or all(
                YearMonth.from_index(YearMonth(c.season_year, season_start_month).index + i).year
                in allowed
                for i in range(12)
            )
        )
    ]
    envelope: tuple[SeasonEnvelopePoint, ...] | None = None
    if len(in_baseline) >= MIN_SEASON_YEARS:
        matrix = np.asarray([c.cumulative for c in in_baseline], dtype=np.float64)
        p10, med, p90 = np.percentile(matrix, [10, 50, 90], axis=0, method="linear")
        envelope = tuple(
            SeasonEnvelopePoint(m + 1, float(p10[m]), float(med[m]), float(p90[m]))
            for m in range(12)
        )

    target = season_year
    if target is None and series.months:
        target = _season_start(series.months[-1], season_start_month).year
    selected_curve = next((c for c in curves if c.season_year == target), None)

    prov_month = prov_count = None
    if (
        prov is not None
        and target is not None
        and _season_start(prov.month, season_start_month).year == target
    ):
        prov_month, prov_count = prov.month, prov.harmonized

    base = {
        "season_start_month": season_start_month,
        "envelope": envelope,
        "n_envelope_years": len(in_baseline),
        "curves": tuple(curves),
        "provisional_month": prov_month,
        "provisional_count": None if prov_count is None else float(prov_count),
    }
    if selected_curve is None:
        reason = (
            "No complete month in the record for this area."
            if not series.months
            else f"No complete month of season year {target} is in the record."
        )
        return SeasonTracker(
            season_year=None,
            selected=(),
            through=None,
            count=None,
            median_cumulative=None,
            percent_of_median=None,
            reason=reason,
            **base,  # type: ignore[arg-type]
        )

    k = len(selected_curve.cumulative)
    count = selected_curve.cumulative[-1]
    through = YearMonth.from_index(
        YearMonth(selected_curve.season_year, season_start_month).index + k - 1
    )
    median = None if envelope is None else envelope[k - 1].median
    percent: float | None = None
    if median:
        candidate = 100.0 * count / median
        percent = candidate if math.isfinite(candidate) else None
    reason = None
    if envelope is None:
        reason = (
            f"Fewer than {MIN_SEASON_YEARS} season years lie entirely inside the baseline "
            f"period ({len(in_baseline)} available), so there is no envelope."
        )
    return SeasonTracker(
        season_year=selected_curve.season_year,
        selected=selected_curve.cumulative,
        through=through,
        count=count,
        median_cumulative=median,
        percent_of_median=percent,
        reason=reason,
        **base,  # type: ignore[arg-type]
    )

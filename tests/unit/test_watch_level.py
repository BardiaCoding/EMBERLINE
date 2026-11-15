"""Unit tests for `hotspots.stats.watch_level` (task 26.2).

All values are synthetic (TEST FIXTURE, not NASA data).
"""

from __future__ import annotations

from collections.abc import Callable

import numpy as np
import pytest

from hotspots.areastats import ProvisionalMonth, ZeroFilledSeries, monthly_baselines
from hotspots.data.types import YearMonth
from hotspots.stats import DEFAULT_WATCH_THRESHOLD, WatchResult, watch_level


def _series(
    value: Callable[[YearMonth], float],
    first: YearMonth,
    last: YearMonth,
    provisional: tuple[YearMonth, float] | None = None,
) -> ZeroFilledSeries:
    months = [YearMonth.from_index(i) for i in range(first.index, last.index + 1)]
    n = len(months)
    prov = (
        ()
        if provisional is None
        else (ProvisionalMonth(provisional[0], provisional[1], 0, 0, None),)
    )
    return ZeroFilledSeries(
        months=months,
        harmonized=np.array([value(m) for m in months], dtype=np.float64),
        raw_modis=np.zeros(n, dtype=np.int64),
        raw_viirs=np.zeros(n, dtype=np.int64),
        frp_sum_mw=np.full(n, np.nan),
        provisional=prov,
    )


def _october_series(latest_value: float, years: int = 20) -> ZeroFilledSeries:
    """October counts 1..years-1 for 2001.., latest October (last month) is ``latest_value``."""
    last_year = 2000 + years
    return _series(
        lambda m: latest_value if m == YearMonth(last_year, 10) else float(m.year - 2000),
        YearMonth(2001, 1),
        YearMonth(last_year, 10),
    )


def _watch(series: ZeroFilledSeries, threshold: float = 90.0) -> WatchResult:
    return watch_level(series, monthly_baselines(series), threshold)


def test_above_normal_when_percentile_exceeds_threshold() -> None:
    # Baseline Octobers: 1..19 and the latest value 1000 (20 values). L = 19, E = 1 -> 97.5.
    result = _watch(_october_series(1000.0))
    assert result.level == "Above normal"
    assert result.month == YearMonth(2020, 10)
    assert result.count == 1000.0
    assert result.percentile_rank == pytest.approx(97.5)
    assert result.n_years == 20
    assert (result.baseline_start_year, result.baseline_end_year) == (2001, 2020)
    assert result.reason is None
    assert result.threshold == 90.0


def test_within_normal_range_for_typical_count() -> None:
    result = _watch(_october_series(10.0))
    assert result.level == "Within normal range"
    assert result.median is not None
    assert result.percentile_rank is not None
    assert result.percentile_rank < 90.0


def test_percentile_equal_to_threshold_is_within_normal_range() -> None:
    # Ten Octobers 1..9 and the latest. Latest = 0 gives 5.0. Use a threshold equal to the rank.
    series = _october_series(1000.0, years=10)  # L = 9, E = 1 of N = 10 -> 95.0
    assert _watch(series, 95.0).level == "Within normal range"
    assert _watch(series, 94.9).level == "Above normal"


def test_all_zero_baseline_and_zero_count_is_within_normal_range() -> None:
    series = _series(lambda m: 0.0, YearMonth(2001, 1), YearMonth(2010, 10))
    result = _watch(series)
    assert result.level == "Within normal range"
    assert result.percentile_rank == 50.0
    assert result.median == 0.0


def test_not_available_with_four_baseline_years() -> None:
    series = _series(lambda m: 1.0, YearMonth(2001, 1), YearMonth(2004, 12))
    result = _watch(series)
    assert result.level == "Not available"
    assert result.n_years == 4
    assert result.reason is not None
    assert "5" in result.reason
    assert result.percentile_rank is None
    assert result.median is None
    assert result.month == YearMonth(2004, 12)
    assert result.count == 1.0


def test_exactly_five_baseline_years_is_available() -> None:
    series = _series(lambda m: 1.0, YearMonth(2001, 1), YearMonth(2005, 12))
    assert _watch(series).level != "Not available"


def test_only_the_latest_calendar_month_baseline_counts() -> None:
    # Series ends in March 2006: March has 6 years, but a series starting in 2002 has 5, and
    # a baseline restricted to 4 years makes the level unavailable.
    series = _series(lambda m: 1.0, YearMonth(2001, 1), YearMonth(2006, 3))
    restricted = monthly_baselines(series, baseline_years=[2001, 2002, 2003, 2004])
    assert watch_level(series, restricted).level == "Not available"


def test_empty_series_is_not_available_with_reason() -> None:
    series = _series(lambda m: 0.0, YearMonth(2001, 2), YearMonth(2001, 1))
    result = watch_level(series, monthly_baselines(series))
    assert result.level == "Not available"
    assert result.month is None
    assert result.count is None
    assert result.reason


def test_provisional_month_is_returned_beside_and_not_evaluated() -> None:
    series = _series(
        lambda m: float(m.year - 2000),
        YearMonth(2001, 1),
        YearMonth(2010, 10),
        provisional=(YearMonth(2010, 11), 7.0),
    )
    result = _watch(series)
    assert result.month == YearMonth(2010, 10)
    assert result.provisional_month == YearMonth(2010, 11)
    assert result.provisional_count == 7.0


def test_provisional_is_kept_when_not_available() -> None:
    series = _series(
        lambda m: 1.0,
        YearMonth(2001, 1),
        YearMonth(2002, 10),
        provisional=(YearMonth(2002, 11), 4.0),
    )
    result = _watch(series)
    assert result.level == "Not available"
    assert (result.provisional_month, result.provisional_count) == (YearMonth(2002, 11), 4.0)


def test_no_provisional_month_gives_none_fields() -> None:
    result = _watch(_october_series(5.0))
    assert result.provisional_month is None
    assert result.provisional_count is None


def test_watch_level_matches_record_rank_percentile() -> None:
    from hotspots.stats import record_rank

    series = _october_series(12.0)
    baseline = monthly_baselines(series)[10]
    rr = record_rank(YearMonth(2020, 10), 12.0, baseline)
    assert rr is not None
    assert _watch(series).percentile_rank == rr.percentile


@pytest.mark.parametrize("bad", [0.0, 100.0, -1.0, 150.0])
def test_invalid_threshold_is_rejected(bad: float) -> None:
    series = _october_series(5.0)
    with pytest.raises(ValueError):
        watch_level(series, monthly_baselines(series), bad)


def test_default_threshold_is_90() -> None:
    assert DEFAULT_WATCH_THRESHOLD == 90.0
    series = _october_series(5.0)
    assert watch_level(series, monthly_baselines(series)).threshold == 90.0

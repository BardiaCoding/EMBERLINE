# Feature: harmonized-fire-calendar, Property 49: Watch_Level matches the threshold and is monotone
"""Property 49: for any baseline of at least 5 years, any observed count and any threshold T in
(0, 100), the level is "Above normal" exactly when the mid-rank percentile is greater than T, and
for counts x1 < x2 an "Above normal" x1 implies an "Above normal" x2. With fewer than 5 baseline
years the level is "Not available". The incomplete latest month is never evaluated.

Series and baselines are synthetic (TEST FIXTURE, not NASA data).

**Validates: Requirements 20.9, 20.13, 20.14, 20.15, 20.16**
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np
from hypothesis import given
from hypothesis import strategies as st

from hotspots.areastats import MIN_BASELINE_YEARS, Baseline, ProvisionalMonth, ZeroFilledSeries
from hotspots.data.types import YearMonth
from hotspots.stats import watch_level
from tests.property.strategies.series import MAX_COUNT, count_series

CALENDAR_MONTH = 6
thresholds = st.floats(min_value=0.01, max_value=99.99, allow_nan=False, allow_infinity=False)


def make_baseline(values: Sequence[float]) -> Baseline:
    arr = np.asarray(values, dtype=np.float64)
    n = len(arr)
    return Baseline(
        median=float(np.median(arr)),
        p10=float(np.percentile(arr, 10)),
        p90=float(np.percentile(arr, 90)),
        mean=float(arr.mean()),
        std=float(arr.std(ddof=1)) if n >= 2 else None,
        n_years=n,
        start_year=2000,
        end_year=2000 + n - 1,
        values=tuple(float(v) for v in arr),
    )


def make_series(
    count: float, provisional: ProvisionalMonth | None = None, month: int = CALENDAR_MONTH
) -> ZeroFilledSeries:
    return ZeroFilledSeries(
        months=[YearMonth(2030, month)],
        harmonized=np.array([count], dtype=np.float64),
        raw_modis=np.array([0], dtype=np.int64),
        raw_viirs=np.array([0], dtype=np.int64),
        frp_sum_mw=np.array([np.nan], dtype=np.float64),
        provisional=() if provisional is None else (provisional,),
    )


def oracle_percentile(x: float, values: Sequence[float]) -> float:
    less = sum(1 for v in values if v < x)
    equal = sum(1 for v in values if v == x)
    return 100.0 * (less + 0.5 * equal) / len(values)


@st.composite
def baseline_and_counts(
    draw: st.DrawFn, min_years: int = MIN_BASELINE_YEARS
) -> tuple[list[float], list[float]]:
    values = [float(v) for v in draw(count_series(min_size=min_years))]
    free = st.floats(min_value=0.0, max_value=MAX_COUNT, allow_nan=False, allow_infinity=False)
    counts = draw(
        st.lists(st.one_of(free, st.sampled_from(values), st.just(0.0)), min_size=2, max_size=8)
    )
    return values, counts


@given(baseline_and_counts(), thresholds)
def test_level_matches_threshold(data: tuple[list[float], list[float]], t: float) -> None:
    values, counts = data
    baselines = {CALENDAR_MONTH: make_baseline(values)}
    for x in counts:
        result = watch_level(make_series(x), baselines, t)
        percentile = oracle_percentile(x, values)
        expected = "Above normal" if percentile > t else "Within normal range"
        assert result.level == expected
        assert result.percentile_rank == percentile
        assert result.threshold == t
        assert result.reason is None


@given(baseline_and_counts(), thresholds)
def test_level_is_monotone_in_count(data: tuple[list[float], list[float]], t: float) -> None:
    values, counts = data
    baselines = {CALENDAR_MONTH: make_baseline(values)}
    ordered = sorted(counts)
    above = [watch_level(make_series(x), baselines, t).level == "Above normal" for x in ordered]
    for a1, a2 in zip(above, above[1:], strict=False):
        assert not a1 or a2


@given(
    st.lists(
        st.floats(min_value=0.0, max_value=MAX_COUNT, allow_nan=False, allow_infinity=False),
        min_size=0,
        max_size=MIN_BASELINE_YEARS - 1,
    ),
    st.floats(min_value=0.0, max_value=MAX_COUNT, allow_nan=False, allow_infinity=False),
    thresholds,
)
def test_fewer_than_five_years_is_not_available(values: list[float], x: float, t: float) -> None:
    baselines = {CALENDAR_MONTH: make_baseline(values)} if values else {}
    result = watch_level(make_series(x), baselines, t)
    assert result.level == "Not available"
    assert result.reason
    assert result.percentile_rank is None


@given(baseline_and_counts(), thresholds)
def test_provisional_month_is_never_evaluated(
    data: tuple[list[float], list[float]], t: float
) -> None:
    values, counts = data
    baselines = {CALENDAR_MONTH: make_baseline(values)}
    prov = ProvisionalMonth(
        month=YearMonth(2030, CALENDAR_MONTH + 1),
        harmonized=counts[0],
        raw_modis=0,
        raw_viirs=0,
        frp_sum_mw=None,
    )
    result = watch_level(make_series(counts[1], prov), baselines, t)
    assert result.month == YearMonth(2030, CALENDAR_MONTH)
    assert result.count == counts[1]
    assert result.provisional_month == prov.month
    assert result.provisional_count == counts[0]
    assert result.percentile_rank == oracle_percentile(counts[1], values)


def test_empty_series_is_not_available() -> None:
    empty = ZeroFilledSeries(
        months=[],
        harmonized=np.array([], dtype=np.float64),
        raw_modis=np.array([], dtype=np.int64),
        raw_viirs=np.array([], dtype=np.int64),
        frp_sum_mw=np.array([], dtype=np.float64),
    )
    result = watch_level(empty, {})
    assert result.level == "Not available"
    assert result.reason

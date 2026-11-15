# Feature: harmonized-fire-calendar, Property 23: Baseline and anomaly formulas
"""Property 23: for any zero-filled series and any observed count x, the baseline median, p10,
p90, mean, sample standard deviation (ddof 1) and `n_years` equal an independent reference
computation on the same series, the absolute anomaly equals x minus median, the percent anomaly
equals 100 (x - median) / median when median > 0 and is null when median = 0, the z-score equals
(x - mean) / std when std > 0 and is null when std = 0, the percentile rank equals
100 (L + 0.5 E) / N, and no output is infinite or NaN.

The oracle below uses only the standard library (sorting, `math.fsum`, hand-written linear
interpolation), not numpy or `statistics`. All counts are synthetic (not NASA data).

**Validates: Requirements 10.1, 10.3, 10.6, 10.7, 10.8, 10.12**
"""

from __future__ import annotations

import math
from collections.abc import Sequence

import numpy as np
import pytest
from hypothesis import given
from hypothesis import strategies as st

from hotspots.areastats import (
    NO_TYPICAL_FIRES_TEXT,
    Baseline,
    ZeroFilledSeries,
    evaluate_anomaly,
    monthly_baselines,
)
from hotspots.data.types import YearMonth
from tests.property.strategies.series import MAX_COUNT, count_series

FIRST_MONTH = YearMonth(2000, 11)
REL = 1e-9
ABS = 1e-9


# --------------------------------------------------------------------------- oracle


def ref_quantile(sorted_values: Sequence[float], q: float) -> float:
    """Linear-interpolated quantile (q in 0..1) of an ascending list, position q (n - 1)."""
    n = len(sorted_values)
    pos = q * (n - 1)
    lo = math.floor(pos)
    hi = min(lo + 1, n - 1)
    frac = pos - lo
    return sorted_values[lo] + (sorted_values[hi] - sorted_values[lo]) * frac


def ref_median(sorted_values: Sequence[float]) -> float:
    n = len(sorted_values)
    mid = n // 2
    if n % 2 == 1:
        return sorted_values[mid]
    return (sorted_values[mid - 1] + sorted_values[mid]) / 2.0


def ref_mean(values: Sequence[float]) -> float:
    return math.fsum(values) / len(values)


def ref_std(values: Sequence[float]) -> float | None:
    """Sample standard deviation (divisor N - 1). None for fewer than 2 values."""
    n = len(values)
    if n < 2:
        return None
    if all(v == values[0] for v in values):
        return 0.0
    m = ref_mean(values)
    return math.sqrt(math.fsum((v - m) ** 2 for v in values) / (n - 1))


def ref_rank(values: Sequence[float], x: float) -> float:
    less = sum(1 for v in values if v < x)
    equal = sum(1 for v in values if v == x)
    return 100.0 * (less + 0.5 * equal) / len(values)


# ------------------------------------------------------------------------ helpers


def make_series(counts: Sequence[float]) -> ZeroFilledSeries:
    """Consecutive complete months from 2000-11, one harmonized value per month."""
    months = [YearMonth.from_index(FIRST_MONTH.index + i) for i in range(len(counts))]
    n = len(counts)
    return ZeroFilledSeries(
        months=months,
        harmonized=np.asarray(counts, dtype=np.float64),
        raw_modis=np.zeros(n, dtype=np.int64),
        raw_viirs=np.zeros(n, dtype=np.int64),
        frp_sum_mw=np.full(n, np.nan, dtype=np.float64),
    )


def values_by_month(counts: Sequence[float]) -> dict[int, list[float]]:
    out: dict[int, list[float]] = {m: [] for m in range(1, 13)}
    for i, c in enumerate(counts):
        out[YearMonth.from_index(FIRST_MONTH.index + i).month].append(float(c))
    return out


def assert_close(actual: float | None, expected: float) -> None:
    assert actual is not None
    assert actual == pytest.approx(expected, rel=REL, abs=ABS)


def assert_baseline_matches(b: Baseline, values: list[float]) -> None:
    assert b.n_years == len(values)
    if not values:
        assert (b.median, b.p10, b.p90, b.mean, b.std) == (None, None, None, None, None)
        return
    s = sorted(values)
    assert_close(b.median, ref_median(s))
    assert_close(b.median, ref_quantile(s, 0.5))
    assert_close(b.p10, ref_quantile(s, 0.10))
    assert_close(b.p90, ref_quantile(s, 0.90))
    assert_close(b.mean, ref_mean(values))
    expected_std = ref_std(values)
    if expected_std is None:
        assert b.std is None
    elif expected_std == 0.0:
        assert b.std == 0.0
    else:
        assert_close(b.std, expected_std)
    for stat in (b.median, b.p10, b.p90, b.mean, b.std):
        assert stat is None or math.isfinite(stat)


@st.composite
def series_and_x(draw: st.DrawFn) -> tuple[list[float], float, int]:
    """A count series (1 to 120 months), an observed count x and a calendar month to evaluate."""
    counts = draw(count_series(min_size=1, max_size=120))
    month = draw(st.integers(min_value=1, max_value=12))
    pool = [float(c) for c in counts]
    x = draw(
        st.one_of(
            st.sampled_from(pool),
            st.integers(min_value=0, max_value=int(MAX_COUNT)),
            st.floats(min_value=0.0, max_value=MAX_COUNT, allow_nan=False, allow_infinity=False),
        )
    )
    return [float(c) for c in counts], float(x), month


# -------------------------------------------------------------------------- tests


@given(series_and_x())
def test_baseline_and_anomaly_match_reference(case: tuple[list[float], float, int]) -> None:
    counts, x, month = case
    baselines = monthly_baselines(make_series(counts))
    by_month = values_by_month(counts)

    assert sorted(baselines) == list(range(1, 13))
    for m in range(1, 13):
        assert_baseline_matches(baselines[m], by_month[m])

    baseline = baselines[month]
    anomaly = evaluate_anomaly(x, baseline)
    values = by_month[month]
    if not values:
        assert anomaly is None
        return
    assert anomaly is not None

    s = sorted(values)
    median = ref_median(s)
    mean = ref_mean(values)
    std = ref_std(values)

    assert_close(anomaly.absolute, x - median)

    if median == 0.0:
        assert baseline.median == 0.0
        assert anomaly.percent is None
        assert anomaly.percent_text == NO_TYPICAL_FIRES_TEXT
    else:
        assert baseline.median is not None
        assert baseline.median > 0.0
        assert_close(anomaly.percent, 100.0 * (x - median) / median)
        assert anomaly.percent_text is None

    if std is None or std == 0.0:
        assert anomaly.zscore is None
    else:
        assert baseline.mean is not None
        assert baseline.std is not None
        assert anomaly.zscore is not None
        # Formula check on the baseline's own mean and std.
        assert anomaly.zscore == pytest.approx((x - baseline.mean) / baseline.std, rel=REL, abs=ABS)
        # Check against the reference mean and std when that is numerically well conditioned.
        if std > 1e-6 * max(1.0, abs(mean)):
            assert_close(anomaly.zscore, (x - mean) / std)

    assert anomaly.percentile_rank == pytest.approx(ref_rank(values, x), rel=REL, abs=ABS)
    assert 0.0 <= anomaly.percentile_rank <= 100.0
    assert anomaly.n_years == len(values)

    for field in (anomaly.absolute, anomaly.percent, anomaly.zscore, anomaly.percentile_rank):
        assert field is None or math.isfinite(field)


@given(count_series(min_size=1, max_size=60), st.integers(min_value=0, max_value=1_000_000))
def test_single_calendar_month_baseline_matches_reference(counts: list[float], x: int) -> None:
    """Same property with every value in one calendar month (one value per year)."""
    months = [YearMonth(2001 + i, 7) for i in range(len(counts))]
    n = len(counts)
    series = ZeroFilledSeries(
        months=months,
        harmonized=np.asarray(counts, dtype=np.float64),
        raw_modis=np.zeros(n, dtype=np.int64),
        raw_viirs=np.zeros(n, dtype=np.int64),
        frp_sum_mw=np.full(n, np.nan, dtype=np.float64),
    )
    values = [float(c) for c in counts]
    baselines = monthly_baselines(series)
    assert_baseline_matches(baselines[7], values)
    assert all(baselines[m].n_years == 0 for m in range(1, 13) if m != 7)

    anomaly = evaluate_anomaly(float(x), baselines[7])
    assert anomaly is not None
    assert anomaly.percentile_rank == pytest.approx(ref_rank(values, float(x)), rel=REL, abs=ABS)


def test_zero_median_and_zero_std_examples() -> None:
    """Spec examples: median 0 gives null percent with text, std 0 gives null z-score."""
    zero_series = make_series([0.0] * 24)  # two values in every calendar month
    anomaly = evaluate_anomaly(3.0, monthly_baselines(zero_series)[1])
    assert anomaly is not None
    assert anomaly.absolute == 3.0
    assert anomaly.percent is None
    assert anomaly.percent_text == NO_TYPICAL_FIRES_TEXT
    assert anomaly.zscore is None
    assert anomaly.percentile_rank == 100.0

    flat = make_series([5.0] * 24)
    anomaly = evaluate_anomaly(8.0, monthly_baselines(flat)[1])
    assert anomaly is not None
    assert anomaly.percent == pytest.approx(60.0)
    assert anomaly.percent_text is None
    assert anomaly.zscore is None

    one_year = monthly_baselines(make_series([2.0, 4.0, 6.0, 8.0] + [0.0] * 8))
    assert one_year[1].n_years == 1  # 12 months from 2000-11 give each calendar month one value
    assert one_year[1].std is None
    assert evaluate_anomaly(1.0, one_year[1]).zscore is None  # type: ignore[union-attr]

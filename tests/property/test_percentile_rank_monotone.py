# Feature: harmonized-fire-calendar, Property 25: Percentile rank is monotone
"""Property 25: for any baseline and any two counts x1 < x2, the percentile rank of x2 is greater
than or equal to that of x1, and every rank lies between 0 and 100. Ties use the mid-rank
formula 100 (L + 0.5 E) / N, with L the baseline values below x and E the values equal to x.

Baselines are built from synthetic count series (TEST FIXTURE, not NASA data).

**Validates: Requirements 10.5**
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np
from hypothesis import given
from hypothesis import strategies as st

from hotspots.areastats import Baseline, evaluate_anomaly
from tests.property.strategies.series import MAX_COUNT, count_series


def make_baseline(values: Sequence[float]) -> Baseline:
    """Baseline over `values` (one per year, from 2000), stats from numpy as an oracle."""
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


def rank(x: float, baseline: Baseline) -> float:
    anomaly = evaluate_anomaly(x, baseline)
    assert anomaly is not None
    return anomaly.percentile_rank


def oracle_rank(x: float, values: Sequence[float]) -> float:
    less = sum(1 for v in values if v < x)
    equal = sum(1 for v in values if v == x)
    return 100.0 * (less + 0.5 * equal) / len(values)


@st.composite
def series_and_counts(draw: st.DrawFn) -> tuple[list[float], list[float]]:
    """A baseline series and counts to evaluate: random floats plus values that tie with it."""
    values = [float(v) for v in draw(count_series())]
    free = st.floats(min_value=0.0, max_value=MAX_COUNT, allow_nan=False, allow_infinity=False)
    counts = draw(
        st.lists(st.one_of(free, st.sampled_from(values), st.just(0.0)), min_size=2, max_size=12)
    )
    return values, counts


@given(series_and_counts())
def test_percentile_rank_is_monotone_and_bounded(
    data: tuple[list[float], list[float]],
) -> None:
    values, counts = data
    baseline = make_baseline(values)
    ordered = sorted(counts)
    ranks = [rank(x, baseline) for x in ordered]

    for r in ranks:
        assert 0.0 <= r <= 100.0
    for x1, r1, x2, r2 in zip(ordered, ranks, ordered[1:], ranks[1:], strict=False):
        assert x1 <= x2
        assert r1 <= r2


@given(series_and_counts())
def test_percentile_rank_uses_mid_rank_for_ties(
    data: tuple[list[float], list[float]],
) -> None:
    values, counts = data
    baseline = make_baseline(values)
    for x in counts:
        assert rank(x, baseline) == oracle_rank(x, values)


@given(count_series())
def test_percentile_rank_extremes(values: list[float]) -> None:
    baseline = make_baseline([float(v) for v in values])
    assert rank(-1.0, baseline) == 0.0
    assert rank(MAX_COUNT + 1.0, baseline) == 100.0


def test_percentile_rank_tie_example() -> None:
    baseline = make_baseline([0.0, 0.0, 5.0, 10.0])
    assert rank(0.0, baseline) == 25.0
    assert rank(5.0, baseline) == 62.5
    assert rank(7.0, baseline) == 75.0

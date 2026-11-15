# Feature: harmonized-fire-calendar, Property 38: Season total is preserved
"""Property 38: for any complete season year, the cumulative count at month-of-season 12 equals
the harmonized total of that season year, and month-of-season assignment is the same for every
year (each increment of a curve is the value of calendar month ``start + m - 1``).
Series are synthetic (TEST FIXTURE, not NASA data).
**Validates: Requirements 21.8, 21.9**
"""

from __future__ import annotations

import math

import numpy as np
from hypothesis import given
from hypothesis import strategies as st

from hotspots.areastats import ZeroFilledSeries
from hotspots.data.types import YearMonth
from hotspots.stats import season_tracker
from tests.property.strategies.series import season_series


def _build(first_year: int, first_month: int, values: list[float]) -> ZeroFilledSeries:
    start = YearMonth(first_year, first_month).index
    n = len(values)
    return ZeroFilledSeries(
        months=[YearMonth.from_index(start + i) for i in range(n)],
        harmonized=np.array(values, dtype=np.float64),
        raw_modis=np.zeros(n, dtype=np.int64),
        raw_viirs=np.zeros(n, dtype=np.int64),
        frp_sum_mw=np.full(n, np.nan),
        provisional=(),
    )


@given(data=season_series(), season_start_month=st.integers(min_value=1, max_value=12))
def test_season_total_is_preserved(
    data: tuple[int, int, list[float]], season_start_month: int
) -> None:
    series = _build(*data)
    by_index = {ym.index: float(v) for ym, v in zip(series.months, series.harmonized, strict=True)}
    tracker = season_tracker(series, season_start_month=season_start_month)

    for curve in tracker.curves:
        start = YearMonth(curve.season_year, season_start_month).index
        # Month-of-season m (1-based) is calendar month start_month + m - 1, in every year.
        previous = 0.0
        for m, cumulative in enumerate(curve.cumulative, start=1):
            expected = by_index[start + m - 1]
            assert math.isclose(cumulative - previous, expected, rel_tol=1e-9, abs_tol=1e-6)
            previous = cumulative
        if curve.complete:
            assert len(curve.cumulative) == 12
            total = sum(by_index[start + i] for i in range(12))
            assert math.isclose(curve.cumulative[-1], total, rel_tol=1e-9, abs_tol=1e-6)

    # The selected curve is one of the curves, and its count is its last cumulative value.
    if tracker.season_year is not None:
        assert tracker.count == tracker.selected[-1]
        match = [c for c in tracker.curves if c.season_year == tracker.season_year]
        assert len(match) == 1
        assert match[0].cumulative == tracker.selected

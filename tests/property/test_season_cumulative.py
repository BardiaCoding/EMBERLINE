# Feature: harmonized-fire-calendar, Property 36: Cumulative season curves never decrease
"""Property 36: for any zero-filled series and season start month, the cumulative count at
month-of-season m + 1 is at least that at m, for every season year (and for the selected curve).

Series are synthetic (TEST FIXTURE, not NASA data).

**Validates: Requirements 21.1, 21.4, 21.7**
"""

from __future__ import annotations

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
def test_cumulative_season_curves_never_decrease(
    data: tuple[int, int, list[float]], season_start_month: int
) -> None:
    series = _build(*data)
    tracker = season_tracker(series, season_start_month=season_start_month)

    # A series that ends before its first season starts has no curve; that is by design.
    for curve in tracker.curves:
        assert 1 <= len(curve.cumulative) <= 12
        assert all(b >= a for a, b in zip(curve.cumulative, curve.cumulative[1:], strict=False))
    assert all(b >= a for a, b in zip(tracker.selected, tracker.selected[1:], strict=False))
    if tracker.envelope is not None:
        meds = [p.median for p in tracker.envelope]
        assert all(b >= a for a, b in zip(meds, meds[1:], strict=False))

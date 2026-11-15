# Feature: harmonized-fire-calendar, Property 37: Season envelope ordering
"""Property 37: with at least 5 baseline season years the envelope has p10 <= median <= p90 at
every month-of-season, and with fewer than 5 years no envelope is returned.
Series are synthetic (TEST FIXTURE, not NASA data).
**Validates: Requirements 21.2, 21.5, 21.10**
"""

from __future__ import annotations

import numpy as np
from hypothesis import given
from hypothesis import strategies as st

from hotspots.areastats import ZeroFilledSeries
from hotspots.data.types import YearMonth
from hotspots.stats import MIN_SEASON_YEARS, season_tracker
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


@given(
    data=season_series(min_months=1, max_months=14 * 12),
    season_start_month=st.integers(min_value=1, max_value=12),
    baseline_years=st.one_of(
        st.none(), st.sets(st.integers(min_value=1999, max_value=2025), max_size=27)
    ),
)
def test_season_envelope_ordering(
    data: tuple[int, int, list[float]],
    season_start_month: int,
    baseline_years: set[int] | None,
) -> None:
    series = _build(*data)
    tracker = season_tracker(
        series, baseline_years=baseline_years, season_start_month=season_start_month
    )

    # Independent count of season years entirely inside the series and the baseline period.
    expected = 0
    for curve in tracker.curves:
        if not curve.complete:
            continue
        start = YearMonth(curve.season_year, season_start_month).index
        years = {YearMonth.from_index(start + i).year for i in range(12)}
        if baseline_years is None or years <= baseline_years:
            expected += 1
    assert tracker.n_envelope_years == expected

    if expected < MIN_SEASON_YEARS:
        assert tracker.envelope is None
    else:
        assert tracker.envelope is not None
        assert [p.month_of_season for p in tracker.envelope] == list(range(1, 13))
        for point in tracker.envelope:
            assert point.p10 <= point.median <= point.p90

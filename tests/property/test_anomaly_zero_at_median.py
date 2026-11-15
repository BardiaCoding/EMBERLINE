# Feature: harmonized-fire-calendar, Property 24: Anomaly is zero at the median
"""Property 24: for any baseline and any count equal to the baseline median, the absolute anomaly
is 0, and the percent anomaly is 0 when the median is greater than 0. When the median is 0, the
percent anomaly is null with the "no typical fires in this month" text.

The baselines come from synthetic count series (TEST FIXTURE, not NASA data), laid out as one
value per month from January of a start year, so every calendar month has a baseline.

**Validates: Requirements 10.4**
"""

from __future__ import annotations

import numpy as np
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
from tests.property.strategies.series import count_series

FIRST_YEAR = 2001


def _series(values: list[int] | list[float]) -> ZeroFilledSeries:
    months = [YearMonth(FIRST_YEAR + i // 12, i % 12 + 1) for i in range(len(values))]
    n = len(values)
    return ZeroFilledSeries(
        months=months,
        harmonized=np.asarray(values, dtype=np.float64),
        raw_modis=np.zeros(n, dtype=np.int64),
        raw_viirs=np.zeros(n, dtype=np.int64),
        frp_sum_mw=np.full(n, np.nan, dtype=np.float64),
    )


def _check_at_median(baseline: Baseline) -> None:
    assert baseline.median is not None
    anomaly = evaluate_anomaly(baseline.median, baseline)
    assert anomaly is not None
    assert anomaly.absolute == 0.0
    if baseline.median > 0:
        assert anomaly.percent == 0.0
        assert anomaly.percent_text is None
    else:
        assert anomaly.percent is None
        assert anomaly.percent_text == NO_TYPICAL_FIRES_TEXT


@given(values=count_series(min_size=1, max_size=60))
def test_anomaly_is_zero_at_each_monthly_median(values: list[int] | list[float]) -> None:
    baselines = monthly_baselines(_series(values))
    for baseline in baselines.values():
        if baseline.n_years == 0:
            assert evaluate_anomaly(0.0, baseline) is None
        else:
            _check_at_median(baseline)


@given(
    values=count_series(min_size=24, max_size=60),
    data=st.data(),
)
def test_anomaly_is_zero_at_median_for_a_baseline_period(
    values: list[int] | list[float], data: st.DataObject
) -> None:
    series = _series(values)
    years = sorted({ym.year for ym in series.months})
    period = data.draw(st.sets(st.sampled_from(years), min_size=1))
    for baseline in monthly_baselines(series, period).values():
        if baseline.n_years > 0:
            _check_at_median(baseline)


def test_all_zero_baseline_has_null_percent_at_median() -> None:
    baseline = monthly_baselines(_series([0] * 36))[1]
    anomaly = evaluate_anomaly(0.0, baseline)
    assert anomaly is not None
    assert anomaly.absolute == 0.0
    assert anomaly.percent is None
    assert anomaly.percent_text == NO_TYPICAL_FIRES_TEXT


def test_positive_median_gives_zero_percent() -> None:
    baseline = monthly_baselines(_series([10, 20, 30] * 12))[1]
    assert baseline.median == 10.0
    anomaly = evaluate_anomaly(10.0, baseline)
    assert anomaly is not None
    assert anomaly.absolute == 0.0
    assert anomaly.percent == 0.0

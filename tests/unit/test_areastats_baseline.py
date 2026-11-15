"""Unit tests for baselines, anomalies and baseline-year validation (design 8.3, 8.4)."""

from __future__ import annotations

import math

import numpy as np
import pytest

from hotspots.areastats import (
    NO_TYPICAL_FIRES_TEXT,
    Baseline,
    BaselineYearsError,
    ProvisionalMonth,
    ZeroFilledSeries,
    complete_years,
    evaluate_anomaly,
    monthly_baselines,
    provisional_years,
    validate_baseline_years,
    yearly_baseline,
    yearly_totals,
)
from hotspots.data.types import YearMonth


def make_series(
    values: dict[tuple[int, int], float],
    provisional: tuple[ProvisionalMonth, ...] = (),
) -> ZeroFilledSeries:
    months = [YearMonth(y, m) for (y, m) in sorted(values)]
    n = len(months)
    return ZeroFilledSeries(
        months=months,
        harmonized=np.array([values[(m.year, m.month)] for m in months], dtype=np.float64),
        raw_modis=np.zeros(n, dtype=np.int64),
        raw_viirs=np.zeros(n, dtype=np.int64),
        frp_sum_mw=np.full(n, np.nan),
        provisional=provisional,
    )


def january_series(values: list[float], start_year: int = 2001) -> ZeroFilledSeries:
    return make_series({(start_year + i, 1): v for i, v in enumerate(values)})


def full_years(per_year: dict[int, float]) -> dict[tuple[int, int], float]:
    """Each year gets `value / 12` in each of its 12 months."""
    return {(y, m): v / 12 for y, v in per_year.items() for m in range(1, 13)}


class TestMonthlyBaselines:
    def test_statistics_match_numpy_linear(self) -> None:
        vals = [0.0, 1.0, 2.0, 3.0, 10.0]
        b = monthly_baselines(january_series(vals))[1]
        assert b.n_years == 5
        assert b.median == 2.0
        assert b.p10 == pytest.approx(float(np.percentile(vals, 10, method="linear")))
        assert b.p90 == pytest.approx(float(np.percentile(vals, 90, method="linear")))
        assert b.mean == pytest.approx(3.2)
        assert b.std == pytest.approx(float(np.std(vals, ddof=1)))
        assert (b.start_year, b.end_year) == (2001, 2005)

    def test_one_year_has_null_std(self) -> None:
        b = monthly_baselines(january_series([4.0]))[1]
        assert b.n_years == 1
        assert b.median == 4.0
        assert b.std is None

    def test_empty_calendar_month_has_no_statistics(self) -> None:
        b = monthly_baselines(january_series([1.0, 2.0]))[2]
        assert b == Baseline(None, None, None, None, None, 0)

    def test_keys_are_months_one_to_twelve(self) -> None:
        assert list(monthly_baselines(january_series([1.0]))) == list(range(1, 13))

    def test_constant_values_give_exactly_zero_std(self) -> None:
        b = monthly_baselines(january_series([0.1, 0.1, 0.1]))[1]
        assert b.std == 0.0
        assert b.mean == 0.1

    def test_custom_baseline_years_restrict_the_series(self) -> None:
        series = january_series([1.0, 2.0, 3.0, 4.0, 5.0, 6.0])
        b = monthly_baselines(series, baseline_years=[2002, 2003, 2004])[1]
        assert b.n_years == 3
        assert b.median == 3.0
        assert (b.start_year, b.end_year) == (2002, 2004)


class TestYearly:
    def test_only_complete_years_count(self) -> None:
        data = full_years({2001: 120.0, 2002: 240.0})
        data[(2003, 1)] = 5.0  # 2003 has a single month
        series = make_series(data)
        assert complete_years(series) == [2001, 2002]
        assert yearly_totals(series) == {2001: pytest.approx(120.0), 2002: pytest.approx(240.0)}

    def test_yearly_baseline(self) -> None:
        series = make_series(full_years({2001: 10.0, 2002: 20.0, 2003: 30.0}))
        b = yearly_baseline(series)
        assert b.n_years == 3
        assert b.median == pytest.approx(20.0)
        assert (b.start_year, b.end_year) == (2001, 2003)

    def test_year_with_provisional_month_is_flagged(self) -> None:
        prov = ProvisionalMonth(YearMonth(2026, 11), 3.0, 1, 2, None)
        series = make_series(full_years({2001: 12.0}), provisional=(prov,))
        assert provisional_years(series) == frozenset({2026})
        assert 2026 not in yearly_totals(series)


class TestAnomaly:
    BASE = Baseline(
        median=2.0,
        p10=0.4,
        p90=7.0,
        mean=3.2,
        std=3.8,
        n_years=5,
        start_year=2001,
        end_year=2005,
        values=(0.0, 1.0, 2.0, 3.0, 10.0),
    )

    def test_fields(self) -> None:
        a = evaluate_anomaly(4.0, self.BASE)
        assert a is not None
        assert a.absolute == 2.0
        assert a.percent == pytest.approx(100.0)
        assert a.percent_text is None
        assert a.zscore == pytest.approx((4.0 - 3.2) / 3.8)
        assert a.percentile_rank == pytest.approx(100 * 4 / 5)
        assert (a.baseline_start_year, a.baseline_end_year, a.n_years) == (2001, 2005, 5)

    def test_count_equal_to_median_is_zero_anomaly(self) -> None:
        a = evaluate_anomaly(2.0, self.BASE)
        assert a is not None
        assert a.absolute == 0.0
        assert a.percent == 0.0

    def test_mid_rank_with_ties(self) -> None:
        a = evaluate_anomaly(2.0, self.BASE)
        assert a is not None
        assert a.percentile_rank == pytest.approx(100 * (2 + 0.5) / 5)

    def test_rank_bounds(self) -> None:
        low = evaluate_anomaly(-1.0, self.BASE)
        high = evaluate_anomaly(99.0, self.BASE)
        assert low is not None and high is not None
        assert low.percentile_rank == 0.0
        assert high.percentile_rank == 100.0

    def test_zero_median_gives_null_percent_with_text(self) -> None:
        base = Baseline(0.0, 0.0, 1.0, 0.4, 0.5, 5, 2001, 2005, (0.0, 0.0, 0.0, 0.0, 2.0))
        a = evaluate_anomaly(3.0, base)
        assert a is not None
        assert a.percent is None
        assert a.percent_text == NO_TYPICAL_FIRES_TEXT == "no typical fires in this month"
        assert a.absolute == 3.0
        assert a.zscore is not None
        assert a.percentile_rank == 100.0

    def test_zero_std_gives_null_zscore(self) -> None:
        series = january_series([5.0, 5.0, 5.0, 5.0, 5.0])
        b = monthly_baselines(series)[1]
        a = evaluate_anomaly(7.0, b)
        assert a is not None
        assert a.zscore is None
        assert a.absolute == 2.0

    def test_single_year_baseline_has_null_zscore(self) -> None:
        b = monthly_baselines(january_series([5.0]))[1]
        a = evaluate_anomaly(7.0, b)
        assert a is not None
        assert a.zscore is None

    def test_provisional_gives_null_anomaly(self) -> None:
        assert evaluate_anomaly(4.0, self.BASE, provisional=True) is None

    def test_empty_baseline_gives_null_anomaly(self) -> None:
        assert evaluate_anomaly(4.0, Baseline(None, None, None, None, None, 0)) is None

    def test_non_finite_count_is_rejected(self) -> None:
        for bad in (math.inf, -math.inf, math.nan):
            with pytest.raises(ValueError):
                evaluate_anomaly(bad, self.BASE)

    def test_no_non_finite_values_for_extreme_inputs(self) -> None:
        tiny = Baseline(5e-324, 0.0, 1.0, 1.0, 5e-324, 2, 2001, 2002, (0.0, 1e-323))
        a = evaluate_anomaly(1e300, tiny)
        assert a is not None
        for v in (a.absolute, a.percent, a.zscore, a.percentile_rank):
            assert v is None or math.isfinite(v)

    def test_year_total_against_yearly_baseline(self) -> None:
        series = make_series(full_years({2001: 10.0, 2002: 20.0, 2003: 30.0}))
        a = evaluate_anomaly(40.0, yearly_baseline(series))
        assert a is not None
        assert a.absolute == pytest.approx(20.0)
        assert a.percentile_rank == 100.0
        assert a.n_years == 3


class TestValidateBaselineYears:
    RECORD = list(range(2001, 2026))

    def test_valid_selection_is_sorted_and_deduplicated(self) -> None:
        assert validate_baseline_years([2005, 2001, 2003, 2002, 2004, 2001], self.RECORD) == (
            2001,
            2002,
            2003,
            2004,
            2005,
        )

    def test_too_few_years_names_the_minimum(self) -> None:
        with pytest.raises(BaselineYearsError, match="at least 5"):
            validate_baseline_years([2001, 2002, 2003, 2004], self.RECORD)

    def test_duplicates_do_not_count_twice(self) -> None:
        with pytest.raises(BaselineYearsError, match="at least 5"):
            validate_baseline_years([2001, 2001, 2002, 2003, 2004], self.RECORD)

    def test_too_many_years_names_the_maximum(self) -> None:
        record = list(range(1990, 2030))
        with pytest.raises(BaselineYearsError, match="at most 30"):
            validate_baseline_years(range(1990, 2021), record)

    def test_thirty_years_is_allowed(self) -> None:
        record = list(range(1990, 2030))
        assert len(validate_baseline_years(range(1990, 2020), record)) == 30

    def test_year_outside_record_is_named(self) -> None:
        with pytest.raises(BaselineYearsError, match="1999"):
            validate_baseline_years([1999, 2001, 2002, 2003, 2004], self.RECORD)

    def test_error_is_a_value_error(self) -> None:
        assert issubclass(BaselineYearsError, ValueError)

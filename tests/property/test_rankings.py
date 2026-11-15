# Feature: harmonized-fire-calendar, Property 30: Rankings are ordered and complete
"""Property 30: for any monthly series with a provisional month, the top-10 month and year lists
are in descending order of count with ties by earlier date, hold min(10, n) entries, and contain
no provisional month or provisional year.

`top_months` and `top_years` are checked on `MonthRow` and `YearRow` values built directly.
Counts are drawn from a small integer range so ties are frequent, and the input order is
shuffled so the result cannot depend on it. "Complete" means the ranking is exactly the
`min(n, eligible)` best entries of the eligible set, where eligible excludes the provisional
month and every year that contains it. Every row is synthetic (TEST FIXTURE, not NASA data).

**Validates: Requirements 16.5**
"""

from __future__ import annotations

import random
from collections import defaultdict

from hypothesis import given
from hypothesis import strategies as st

from hotspots.areastats import MonthRow, YearRow
from hotspots.stats import TOP_N, top_months, top_years


def _month_row(year: int, month: int, harmonized: float, provisional: bool) -> MonthRow:
    return MonthRow(
        year=year,
        month=month,
        harmonized=harmonized,
        raw_modis=0,
        raw_viirs=0,
        frp_sum_mw=None,
        source_flag=None,
        calib_model=None,
        provenance=None,
        provisional=provisional,
    )


def _year_rows(months: list[MonthRow]) -> list[YearRow]:
    """Year totals the way `compute_area_result` defines them (sum, n_months, provisional)."""
    by_year: dict[int, list[MonthRow]] = defaultdict(list)
    for m in months:
        by_year[m.year].append(m)
    return [
        YearRow(
            year=year,
            harmonized=float(sum(m.harmonized for m in rows)),
            raw_modis=0,
            raw_viirs=0,
            frp_sum_mw=None,
            n_months=len(rows),
            provisional=any(m.provisional for m in rows),
        )
        for year, rows in by_year.items()
    ]


@st.composite
def month_series(draw: st.DrawFn) -> list[MonthRow]:
    """Consecutive months with small integer counts and one provisional month (usually).

    The provisional month may fall anywhere, so the property does not rely on it being the last.
    """
    first_year = draw(st.integers(2000, 2020))
    first_month = draw(st.integers(1, 12))
    n = draw(st.integers(0, 80))
    counts = draw(st.lists(st.integers(0, 6), min_size=n, max_size=n))
    provisional_at = draw(st.one_of(st.none(), st.integers(0, max(n - 1, 0))))
    rows: list[MonthRow] = []
    for i, count in enumerate(counts):
        index = first_year * 12 + first_month - 1 + i
        rows.append(_month_row(index // 12, index % 12 + 1, float(count), i == provisional_at))
    return rows


@given(months=month_series(), shuffle=st.randoms(use_true_random=False), n=st.integers(0, 15))
def test_month_ranking_is_ordered_and_complete(
    months: list[MonthRow], shuffle: random.Random, n: int
) -> None:
    shuffled = list(months)
    shuffle.shuffle(shuffled)
    ranked = top_months(shuffled, n)
    eligible = [m for m in months if not m.provisional]
    provisional = {(m.year, m.month) for m in months if m.provisional}

    # Size.
    assert len(ranked) == min(n, len(eligible))

    # No provisional month.
    assert not provisional & {(r.year, r.month) for r in ranked}

    # Descending by count, ties by earlier date (strictly increasing key, so no duplicates).
    keys = [(-r.harmonized, r.year, r.month) for r in ranked]
    assert keys == sorted(keys)
    assert len(set(keys)) == len(keys)

    # Every entry is an eligible month with its own count.
    counts = {(m.year, m.month): m.harmonized for m in eligible}
    for r in ranked:
        assert counts[(r.year, r.month)] == r.harmonized

    # Complete: no eligible month left out ranks ahead of the last listed entry.
    listed = {(r.year, r.month) for r in ranked}
    if ranked:
        last = (-ranked[-1].harmonized, ranked[-1].year, ranked[-1].month)
        for m in eligible:
            if (m.year, m.month) not in listed:
                assert (-m.harmonized, m.year, m.month) > last
    assert (
        sorted((r.harmonized for r in ranked), reverse=True)
        == sorted((m.harmonized for m in eligible), reverse=True)[: len(ranked)]
    )


@given(months=month_series(), shuffle=st.randoms(use_true_random=False))
def test_year_ranking_is_ordered_and_complete(
    months: list[MonthRow], shuffle: random.Random
) -> None:
    years = _year_rows(months)
    shuffle.shuffle(years)
    ranked = top_years(years)
    eligible = [y for y in years if not y.provisional]
    provisional_years = {y.year for y in years if y.provisional}

    assert len(ranked) == min(TOP_N, len(eligible))
    assert len(ranked) <= 10

    # No provisional year (a year that contains the provisional month).
    assert not provisional_years & {r.year for r in ranked}

    keys = [(-r.harmonized, r.year) for r in ranked]
    assert keys == sorted(keys)
    assert len(set(keys)) == len(keys)

    totals = {y.year: y for y in eligible}
    for r in ranked:
        assert totals[r.year].harmonized == r.harmonized
        assert totals[r.year].n_months == r.n_months

    listed = {r.year for r in ranked}
    if ranked:
        last = (-ranked[-1].harmonized, ranked[-1].year)
        for y in eligible:
            if y.year not in listed:
                assert (-y.harmonized, y.year) > last


@given(months=month_series())
def test_month_ranking_defaults_to_top_ten(months: list[MonthRow]) -> None:
    eligible = [m for m in months if not m.provisional]
    assert len(top_months(months)) == min(10, len(eligible))

# Feature: harmonized-fire-calendar, Property 26: Baseline period limits
"""Property 26: `validate_baseline_years` accepts a requested baseline exactly when it spans 5 to
30 distinct complete years that are all in the record, and otherwise rejects it with a message
naming the violated limit. Inputs are synthetic years (TEST FIXTURE, not NASA data).
**Validates: Requirements 10.2, 10.10**
"""

from __future__ import annotations

from hypothesis import given
from hypothesis import strategies as st

from hotspots.areastats import (
    MAX_BASELINE_YEARS,
    MIN_BASELINE_YEARS,
    BaselineYearsError,
    validate_baseline_years,
)

YEAR = st.integers(min_value=1990, max_value=2060)
RECORDS = st.sets(YEAR, min_size=0, max_size=45)


@st.composite
def requests(draw: st.DrawFn) -> tuple[set[int], list[int]]:
    """A record and a request that mixes in-record years, outside years and duplicates."""
    record = draw(RECORDS)
    pool = sorted(record)
    inside = (
        draw(st.lists(st.sampled_from(pool), max_size=40, unique=draw(st.booleans())))
        if pool
        else []
    )
    outside = draw(st.lists(YEAR, max_size=3))
    years = draw(st.permutations(inside + outside))
    return record, list(years)


@given(requests())
def test_accepts_exactly_when_within_limits_and_in_record(
    case: tuple[set[int], list[int]],
) -> None:
    record, years = case
    distinct = sorted(set(years))
    in_record = set(distinct) <= record
    n = len(distinct)
    should_accept = in_record and MIN_BASELINE_YEARS <= n <= MAX_BASELINE_YEARS

    try:
        result = validate_baseline_years(years, record)
    except BaselineYearsError as exc:
        assert not should_accept
        message = str(exc)
        if not in_record:
            missing = sorted(set(distinct) - record)
            assert "in-record" in message
            assert all(str(y) in message for y in missing)
        elif n < MIN_BASELINE_YEARS:
            assert f"at least {MIN_BASELINE_YEARS}" in message
        else:
            assert f"at most {MAX_BASELINE_YEARS}" in message
    else:
        assert should_accept
        assert result == tuple(distinct)


@given(st.integers(min_value=1990, max_value=2020), st.integers(min_value=1, max_value=40))
def test_contiguous_range_boundaries(first: int, length: int) -> None:
    record = set(range(1980, 2070))
    years = range(first, first + length)
    if MIN_BASELINE_YEARS <= length <= MAX_BASELINE_YEARS:
        assert validate_baseline_years(years, record) == tuple(years)
    else:
        try:
            validate_baseline_years(years, record)
        except BaselineYearsError as exc:
            assert ("at least" if length < MIN_BASELINE_YEARS else "at most") in str(exc)
        else:
            raise AssertionError("expected BaselineYearsError")

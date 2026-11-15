"""Hypothesis generators for count series. All values are synthetic (not NASA data)."""

from __future__ import annotations

from hypothesis import strategies as st

MAX_COUNT = 1_000_000.0

_counts_float = st.floats(min_value=0.0, max_value=MAX_COUNT, allow_nan=False, allow_infinity=False)
_counts_int = st.integers(min_value=0, max_value=int(MAX_COUNT))


def _sized(min_size: int, max_size: int) -> dict[str, int]:
    return {"min_size": min_size, "max_size": max_size}


@st.composite
def general_series(
    draw: st.DrawFn, min_size: int = 1, max_size: int = 60
) -> list[int] | list[float]:
    """Non-negative integers or floats, any mix of zero and positive values."""
    element = draw(st.sampled_from([_counts_int, _counts_float]))
    return draw(st.lists(element, **_sized(min_size, max_size)))


@st.composite
def zero_heavy_series(
    draw: st.DrawFn, min_size: int = 1, max_size: int = 60
) -> list[int] | list[float]:
    """Mostly zeros (about 80 to 100 percent), like a sparse area or a quiet month."""
    positive = draw(st.sampled_from([_counts_int, _counts_float]))
    element = st.one_of(st.just(0), st.just(0), st.just(0), st.just(0), positive)
    return draw(st.lists(element, **_sized(min_size, max_size)))


@st.composite
def constant_series(
    draw: st.DrawFn, min_size: int = 1, max_size: int = 60
) -> list[int] | list[float]:
    """Every value equal (including all zeros), so the standard deviation is 0."""
    value = draw(st.one_of(st.just(0), _counts_int, _counts_float))
    size = draw(st.integers(min_value=min_size, max_value=max_size))
    return [value] * size


def count_series(
    min_size: int = 1, max_size: int = 60
) -> st.SearchStrategy[list[int] | list[float]]:
    """Non-negative count series: general, zero-heavy and constant variants."""
    return st.one_of(
        general_series(min_size, max_size),
        zero_heavy_series(min_size, max_size),
        constant_series(min_size, max_size),
    )


@st.composite
def season_series(
    draw: st.DrawFn, min_months: int = 1, max_months: int = 14 * 12
) -> tuple[int, int, list[float]]:
    """Monthly series for the season tracker: (first year, first month, values).

    Values are non-negative, start at any calendar month and may end mid-season.
    """
    first_year = draw(st.integers(min_value=2000, max_value=2010))
    first_month = draw(st.integers(min_value=1, max_value=12))
    size = draw(st.integers(min_value=min_months, max_value=max_months))
    element = draw(st.sampled_from([_counts_int, _counts_float, st.just(0)]))
    values = draw(st.lists(element, min_size=size, max_size=size))
    return first_year, first_month, [float(v) for v in values]

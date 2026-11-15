"""Unit tests for the API schemas (synthetic values only)."""

from __future__ import annotations

import pytest
from hypothesis import given
from hypothesis import strategies as st
from pydantic import ValidationError

from hotspots.api.schemas import (
    MAX_VERTICES,
    CalendarOut,
    Coverage,
    Geometry,
    MetaOut,
    MonthRow,
    QueryIn,
)


def _ring(n: int) -> list[list[float]]:
    """A closed ring with `n` positions (n >= 4) inside the region."""
    pts = [[-120.0 + 0.001 * i, 36.0 + (0.001 if i % 2 else 0.0)] for i in range(n - 1)]
    return [*pts, pts[0]]


def _polygon(n: int = 5) -> dict[str, object]:
    return {"type": "Polygon", "coordinates": [_ring(n)]}


def test_geometry_accepts_polygon_and_multipolygon() -> None:
    Geometry.model_validate(_polygon())
    Geometry.model_validate({"type": "MultiPolygon", "coordinates": [[_ring(5)], [_ring(6)]]})


def test_geometry_vertex_limit_counts_all_parts() -> None:
    Geometry.model_validate(_polygon(MAX_VERTICES))
    with pytest.raises(ValidationError, match="1001 vertices"):
        Geometry.model_validate(_polygon(MAX_VERTICES + 1))
    multi = {"type": "MultiPolygon", "coordinates": [[_ring(600)], [_ring(401)]]}
    with pytest.raises(ValidationError, match="1001 vertices"):
        Geometry.model_validate(multi)


@pytest.mark.parametrize(
    "geometry",
    [
        {"type": "Point", "coordinates": [0, 0]},
        {"type": "Polygon", "coordinates": []},
        {"type": "Polygon", "coordinates": [[[0, 0], [1]]]},
        {"type": "Polygon", "coordinates": [[[0, 0], [1, "x"], [1, 1], [0, 0]]]},
        {"type": "Polygon", "coordinates": [[[181, 0], [1, 1], [1, 2], [181, 0]]]},
        {"type": "Polygon", "coordinates": [[[0, 91], [1, 1], [1, 2], [0, 91]]]},
        {"type": "MultiPolygon", "coordinates": []},
        {**_polygon(), "extra": 1},
    ],
)
def test_geometry_rejects_bad_shapes(geometry: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        Geometry.model_validate(geometry)


@given(st.integers(min_value=4, max_value=MAX_VERTICES + 50))
def test_geometry_limit_is_exact(n: int) -> None:
    """**Validates: Requirements 13.6, 29.4**"""
    if n <= MAX_VERTICES:
        Geometry.model_validate(_polygon(n))
    else:
        with pytest.raises(ValidationError):
            Geometry.model_validate(_polygon(n))


def test_query_in_dates_and_baseline() -> None:
    q = QueryIn.model_validate({"start": "2020-01-01", "end": "2020-12-31"})
    assert q.geometry is None and q.baseline_years is None
    with pytest.raises(ValidationError, match="end must not be before start"):
        QueryIn.model_validate({"start": "2020-02-01", "end": "2020-01-01"})
    with pytest.raises(ValidationError, match="not be after the last"):
        QueryIn.model_validate(
            {"start": "2020-01-01", "end": "2020-02-01", "baseline_years": [2015, 2010]}
        )
    with pytest.raises(ValidationError):
        QueryIn.model_validate({"start": "2020-01-01", "end": "2020-02-01", "unknown": 1})


def test_month_row_bounds_default_to_null() -> None:
    row = MonthRow(year=2020, month=8, harmonized=12.5, raw_modis=3, raw_viirs=9)
    dumped = row.model_dump()
    assert dumped["lower_bound"] is None and dumped["upper_bound"] is None
    with pytest.raises(ValidationError):
        MonthRow(year=2020, month=13, harmonized=0.0, raw_modis=0, raw_viirs=0)


def test_calendar_out_serializes() -> None:
    out = CalendarOut(
        months=[],
        years=[],
        baseline_by_month=[],
        coverage=Coverage(),
        n_cells=0,
        notice="no_cells",
    )
    assert out.model_dump(mode="json")["provisional_months"] == []


def test_meta_out_example_areas_default_empty() -> None:
    meta = MetaOut(
        name="California region",
        extent={"west": -124.4, "south": 32.5, "east": -114.0, "north": 42.2},
        record_start="2000-11",
        first_date="2000-11-01",
        latest_month="2026-11",
        latest_month_incomplete=True,
        time_convention="fixed UTC-8",
        unit="cell-days",
        watch_threshold=90.0,
        limitations=[],
    )
    assert meta.example_areas == []
    assert meta.bounds_available is False

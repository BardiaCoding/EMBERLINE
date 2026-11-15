# Feature: harmonized-fire-calendar, Property 28: Clipping stays inside the extent and reports the removed share  # noqa: E501
"""Property 28: for any valid polygon, `clip_to_extent` returns a geometry inside the extent and
`clipped_percent` equal to 100 * (1 - clipped area / original area) by geodesic area. A polygon
already inside is returned unchanged with 0 %, and a polygon with no area inside gives no
geometry and 100 %.

The expected percentage is recomputed here from `geodesic_area_km2` of the returned geometry and
of the input, not read from the result's own area fields. Geometry is synthetic (not NASA data).

**Validates: Requirements 11.8, 13.3**
"""

from __future__ import annotations

import math

from hypothesis import given
from hypothesis import strategies as st
from shapely.geometry import Polygon
from shapely.geometry import box as shapely_box

from hotspots.config import Extent
from hotspots.geometry import clip_to_extent, geodesic_area_km2
from tests.property.strategies.clipping import extents, polygons_for

PERCENT_TOLERANCE = 1e-6
"""Allowed difference in percentage points (design Property 28)."""

EDGE_TOLERANCE_DEG = 1e-9
"""Slack when testing containment, for rounding in computed edge crossings."""


def _window(extent: Extent, slack: float = 0.0) -> Polygon:
    return shapely_box(
        extent.west - slack, extent.south - slack, extent.east + slack, extent.north + slack
    )


@st.composite
def extent_and_polygon(draw: st.DrawFn, relation: str) -> tuple[Extent, Polygon]:
    extent = draw(extents())
    return extent, draw(polygons_for(extent, relation))  # type: ignore[arg-type]


@given(extent_and_polygon("any"))
def test_clipping_stays_inside_and_reports_removed_share(case: tuple[Extent, Polygon]) -> None:
    extent, polygon = case
    result = clip_to_extent(polygon, extent)

    assert 0.0 <= result.clipped_percent <= 100.0
    original_area = geodesic_area_km2(polygon)
    assert original_area > 0.0

    overlap_area = _window(extent).intersection(polygon).area
    if result.geometry is None:
        # Nothing remains only when the overlap has no area.
        assert overlap_area == 0.0
        assert result.clipped_percent == 100.0
        return

    assert overlap_area > 0.0
    assert _window(extent, EDGE_TOLERANCE_DEG).covers(result.geometry)
    clipped_area = geodesic_area_km2(result.geometry)
    assert clipped_area <= original_area * (1.0 + 1e-12)
    expected = 100.0 * (1.0 - clipped_area / original_area)
    assert math.isclose(result.clipped_percent, expected, rel_tol=0.0, abs_tol=PERCENT_TOLERANCE)
    assert result.clipped == (result.clipped_percent > 0.0 or not _window(extent).covers(polygon))


@given(extent_and_polygon("inside"))
def test_polygon_inside_is_unchanged(case: tuple[Extent, Polygon]) -> None:
    extent, polygon = case
    result = clip_to_extent(polygon, extent)

    assert result.geometry is not None
    assert result.geometry.equals_exact(polygon, 0.0)
    assert result.clipped is False
    assert result.clipped_percent == 0.0


@given(extent_and_polygon("outside"))
def test_polygon_outside_gives_no_geometry(case: tuple[Extent, Polygon]) -> None:
    extent, polygon = case
    result = clip_to_extent(polygon, extent)

    assert result.geometry is None
    assert result.clipped is True
    assert result.clipped_percent == 100.0
    assert result.clipped_area_km2 == 0.0

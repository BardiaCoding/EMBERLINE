"""Hypothesis generators for the clipping property (Property 28). Synthetic values, not NASA data.

An extent is a box with corners on a 0.5 degree lattice, placed in the California latitude and
longitude range. Selection polygons have vertices on the same lattice, so edges lie on, cross or
stay clear of the extent edges, and exact touching cases (shared edge or corner) occur often.
Coordinates are EPSG:4326 degrees, `(longitude, latitude)`.

Contents:
- `extents()`: a region extent.
- `polygons_for(extent, relation)`: a valid polygon that is `inside`, `outside` or `any` relative
  to the extent.
"""

from __future__ import annotations

import math
from typing import Literal

from hypothesis import assume
from hypothesis import strategies as st
from shapely.geometry import Polygon, box

from hotspots.config import Extent

LATTICE_STEP = 0.5
"""Lattice step in degrees (exact in binary floating point)."""

MARGIN = 4
"""Lattice steps that a polygon may reach beyond the extent."""

Relation = Literal["inside", "outside", "any"]


@st.composite
def extents(draw: st.DrawFn) -> Extent:
    """A box 3 to 10 degrees wide and high, corners on the 0.5 degree lattice."""
    west = draw(st.integers(min_value=-250, max_value=-232)) * LATTICE_STEP
    south = draw(st.integers(min_value=66, max_value=80)) * LATTICE_STEP
    width = draw(st.integers(min_value=6, max_value=20)) * LATTICE_STEP
    height = draw(st.integers(min_value=6, max_value=20)) * LATTICE_STEP
    return Extent(west=west, south=south, east=west + width, north=south + height)


def _index_range(low: float, high: float) -> tuple[int, int]:
    return round(low / LATTICE_STEP), round(high / LATTICE_STEP)


def _ranges(
    extent: Extent, relation: Relation, draw: st.DrawFn
) -> tuple[tuple[int, int], tuple[int, int]]:
    """Inclusive lattice index ranges `(x, y)` for the vertices of a polygon."""
    west, east = _index_range(extent.west, extent.east)
    south, north = _index_range(extent.south, extent.north)
    if relation == "inside":
        return (west, east), (south, north)
    if relation == "any":
        return (west - MARGIN, east + MARGIN), (south - MARGIN, north + MARGIN)
    # Outside: all vertices on or beyond one side, so the overlap has no area. Vertices on the
    # extent edge (a shared edge or corner) are allowed.
    side = draw(st.sampled_from(("west", "east", "south", "north")))
    wide_x, wide_y = (west - MARGIN, east + MARGIN), (south - MARGIN, north + MARGIN)
    if side == "west":
        return (west - MARGIN, west), wide_y
    if side == "east":
        return (east, east + MARGIN), wide_y
    if side == "south":
        return wide_x, (south - MARGIN, south)
    return wide_x, (north, north + MARGIN)


@st.composite
def polygons_for(draw: st.DrawFn, extent: Extent, relation: Relation = "any") -> Polygon:
    """A valid polygon with lattice vertices, rectangle or star-shaped (often concave).

    `relation` is `inside` (every vertex in the extent, edges included, so the polygon is
    covered by it), `outside` (no overlap area with the extent, shared edges allowed) or `any`
    (partly or fully inside, or outside).
    """
    (x_low, x_high), (y_low, y_high) = _ranges(extent, relation, draw)
    assume(x_high > x_low and y_high > y_low)

    if draw(st.booleans()):
        x0 = draw(st.integers(min_value=x_low, max_value=x_high - 1))
        y0 = draw(st.integers(min_value=y_low, max_value=y_high - 1))
        x1 = draw(st.integers(min_value=x0 + 1, max_value=x_high))
        y1 = draw(st.integers(min_value=y0 + 1, max_value=y_high))
        return box(x0 * LATTICE_STEP, y0 * LATTICE_STEP, x1 * LATTICE_STEP, y1 * LATTICE_STEP)

    vertices = draw(
        st.lists(
            st.tuples(
                st.integers(min_value=x_low, max_value=x_high),
                st.integers(min_value=y_low, max_value=y_high),
            ),
            min_size=3,
            max_size=8,
            unique=True,
        )
    )
    # An off-lattice centre (quarter step) keeps the angle ordering free of ties, so the
    # polygon is star-shaped and simple.
    centre_x = draw(st.integers(min_value=x_low, max_value=x_high)) + 0.25
    centre_y = draw(st.integers(min_value=y_low, max_value=y_high)) + 0.25
    ordered = sorted(
        vertices,
        key=lambda p: (
            math.atan2(p[1] - centre_y, p[0] - centre_x),
            (p[0] - centre_x) ** 2 + (p[1] - centre_y) ** 2,
        ),
    )
    polygon = Polygon([(x * LATTICE_STEP, y * LATTICE_STEP) for x, y in ordered])
    assume(polygon.is_valid and polygon.area > 0)
    return polygon

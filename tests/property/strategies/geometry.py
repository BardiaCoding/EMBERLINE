"""Hypothesis generators for polygons and points. All values are synthetic (not NASA data).

Vertices sit on a coarse lattice so that points on edges and vertices occur often. The lattice
step is 1/16 degree, a power of two, so every lattice coordinate (and every half-step coordinate)
is exactly representable as a float and the boundary tests have no rounding noise. Coordinates
are EPSG:4326 degrees (x = longitude, y = latitude).

Contents:
- `lon_at`, `lat_at`, `lattice_index`: lattice index to degrees and back.
- `rectangles()`, `simple_polygons()`, `polygons()`: shapely polygons with lattice vertices.
- `lattice_points()`: half-step lattice points around a polygon (inside, outside, on the boundary).
- `points_on()`: points exactly on an edge or vertex of a polygon.
"""

from __future__ import annotations

import math

from hypothesis import assume
from hypothesis import strategies as st
from shapely.geometry import Polygon, box

ORIGIN_LON = -120.0
ORIGIN_LAT = 36.0
STEP = 0.0625
"""Lattice step in degrees (1/16, exact in binary floating point)."""

MAX_COORD = 8
"""Lattice indices of generated vertices run from 0 to `MAX_COORD`."""

Point = tuple[float, float]
"""`(lon, lat)` in degrees."""


def lon_at(index: float) -> float:
    """Longitude of a lattice index. Integer and half-integer indices are exact."""
    return ORIGIN_LON + index * STEP


def lat_at(index: float) -> float:
    """Latitude of a lattice index. Integer and half-integer indices are exact."""
    return ORIGIN_LAT + index * STEP


def lattice_index(value: float, origin: float) -> int:
    """Nearest integer lattice index of a coordinate (`origin` is `ORIGIN_LON` or `ORIGIN_LAT`)."""
    return round((value - origin) / STEP)


def _vertex_indices(polygon: Polygon) -> list[tuple[int, int]]:
    """Exterior ring as integer lattice `(x, y)` indices, without the closing vertex."""
    coords = list(polygon.exterior.coords)[:-1]
    return [(lattice_index(x, ORIGIN_LON), lattice_index(y, ORIGIN_LAT)) for x, y in coords]


@st.composite
def rectangles(draw: st.DrawFn, max_span: int = 6) -> Polygon:
    """Axis-aligned rectangle with lattice corners, 1 to `max_span` steps on each side."""
    x0 = draw(st.integers(min_value=0, max_value=MAX_COORD - 1))
    y0 = draw(st.integers(min_value=0, max_value=MAX_COORD - 1))
    width = draw(st.integers(min_value=1, max_value=min(max_span, MAX_COORD - x0)))
    height = draw(st.integers(min_value=1, max_value=min(max_span, MAX_COORD - y0)))
    return box(lon_at(x0), lat_at(y0), lon_at(x0 + width), lat_at(y0 + height))


@st.composite
def simple_polygons(draw: st.DrawFn, max_vertices: int = 7) -> Polygon:
    """Simple (non self-intersecting) polygon with lattice vertices, often concave.

    Vertices are ordered by angle around a half-step centre point, which gives a star-shaped
    polygon. Edges may be horizontal, vertical or diagonal. Invalid results are discarded.
    """
    vertices = draw(
        st.lists(
            st.tuples(
                st.integers(min_value=0, max_value=MAX_COORD),
                st.integers(min_value=0, max_value=MAX_COORD),
            ),
            min_size=3,
            max_size=max_vertices,
            unique=True,
        )
    )
    centre_x = draw(st.integers(min_value=0, max_value=2 * MAX_COORD)) / 2 + 0.25
    centre_y = draw(st.integers(min_value=0, max_value=2 * MAX_COORD)) / 2 + 0.25
    ordered = sorted(
        vertices,
        key=lambda p: (
            math.atan2(p[1] - centre_y, p[0] - centre_x),
            (p[0] - centre_x) ** 2 + (p[1] - centre_y) ** 2,
        ),
    )
    polygon = Polygon([(lon_at(x), lat_at(y)) for x, y in ordered])
    assume(polygon.is_valid and polygon.area > 0)
    return polygon


def polygons() -> st.SearchStrategy[Polygon]:
    """Axis-aligned rectangles or general simple polygons, both with lattice vertices."""
    return st.one_of(rectangles(), simple_polygons())


@st.composite
def lattice_points(draw: st.DrawFn, polygon: Polygon, margin: int = 1) -> Point:
    """`(lon, lat)` on the half-step lattice within `margin` steps of the polygon's bounding box.

    Includes points strictly inside, strictly outside and on the boundary.
    """
    vertices = _vertex_indices(polygon)
    xs = [x for x, _ in vertices]
    ys = [y for _, y in vertices]
    half_x = draw(st.integers(min_value=2 * (min(xs) - margin), max_value=2 * (max(xs) + margin)))
    half_y = draw(st.integers(min_value=2 * (min(ys) - margin), max_value=2 * (max(ys) + margin)))
    return lon_at(half_x / 2), lat_at(half_y / 2)


@st.composite
def points_on(draw: st.DrawFn, polygon: Polygon) -> Point:
    """`(lon, lat)` exactly on an edge or vertex of a lattice polygon.

    Picks an edge, then one of the half-step lattice points on it (the end vertices included).
    The point is exact in floating point, so it lies on the boundary for any robust predicate.
    """
    vertices = _vertex_indices(polygon)
    edge = draw(st.integers(min_value=0, max_value=len(vertices) - 1))
    x0, y0 = vertices[edge]
    x1, y1 = vertices[(edge + 1) % len(vertices)]
    # Work in half steps so that midpoints of odd-length edges are included.
    delta_x, delta_y = 2 * (x1 - x0), 2 * (y1 - y0)
    divisions = math.gcd(abs(delta_x), abs(delta_y))
    k = draw(st.integers(min_value=0, max_value=divisions))
    half_x = 2 * x0 + (delta_x // divisions) * k
    half_y = 2 * y0 + (delta_y // divisions) * k
    return lon_at(half_x / 2), lat_at(half_y / 2)


@st.composite
def rect_splits(
    draw: st.DrawFn, max_span: int = 6, max_parts: int = 4
) -> tuple[Polygon, list[Polygon]]:
    """A lattice rectangle and its split into 2 to `max_parts` non-overlapping parts.

    Returns `(whole, parts)`. The parts are the cells of a grid made by `nx - 1` vertical and
    `ny - 1` horizontal cut lines on the lattice, so they tile the whole rectangle and share
    edges (and corners) exactly. Cut lines sit on integer lattice indices, which includes the
    lines through the cell centres at `ORIGIN + 4 * STEP` (0.25 degree). `parts` is ordered
    west to east, then south to north.
    """
    whole = draw(rectangles(max_span))
    west, south, east, north = whole.bounds
    wi, ei = lattice_index(west, ORIGIN_LON), lattice_index(east, ORIGIN_LON)
    si, ni = lattice_index(south, ORIGIN_LAT), lattice_index(north, ORIGIN_LAT)
    options = [
        (nx, ny)
        for nx in range(1, min(ei - wi, max_parts) + 1)
        for ny in range(1, min(ni - si, max_parts) + 1)
        if 2 <= nx * ny <= max_parts
    ]
    assume(options)
    nx, ny = draw(st.sampled_from(options))

    def cuts(count: int, low: int, high: int) -> list[int]:
        if count == 0:
            return []
        picked = draw(
            st.lists(
                st.sampled_from(range(low + 1, high)),
                min_size=count,
                max_size=count,
                unique=True,
            )
        )
        return sorted(picked)

    xs = [wi, *cuts(nx - 1, wi, ei), ei]
    ys = [si, *cuts(ny - 1, si, ni), ni]
    parts = [
        box(lon_at(xs[i]), lat_at(ys[j]), lon_at(xs[i + 1]), lat_at(ys[j + 1]))
        for i in range(nx)
        for j in range(ny)
    ]
    return whole, parts

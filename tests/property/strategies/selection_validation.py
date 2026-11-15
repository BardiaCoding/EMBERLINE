"""Hypothesis generators for `validate_selection` (Property 27). All shapes are synthetic.

Valid shapes: rectangles (inside or partly outside the extent), regular polygons, a rectangle
with a hole, a MultiPolygon of two disjoint rectangles, and circles.

Defective shapes: each carries exactly one injected defect, tagged with the check stage that
should report it (see "Checks run in this order" in `hotspots.geometry`). `defect_pairs()` puts
two defects into the two parts of a MultiPolygon, so the expected answer is the earlier stage.
Parts sit in separate longitude bands, so they never overlap by accident.

Coordinates are EPSG:4326 degrees, `(longitude, latitude)`. Values are multiples of 0.001.
"""

from __future__ import annotations

import math
from typing import Any, NamedTuple

from hypothesis import strategies as st

from hotspots.config import Extent
from hotspots.geometry import (
    REASON_COORDINATE_OUT_OF_RANGE,
    REASON_MALFORMED,
    REASON_OUTSIDE_EXTENT,
    REASON_RADIUS_OUT_OF_RANGE,
    REASON_SELF_INTERSECTION,
    REASON_TOO_FEW_VERTICES,
    REASON_TOO_MANY_VERTICES,
    REASON_ZERO_AREA,
    CircleSpec,
)

EXTENT = Extent(west=-124.4, south=32.5, east=-114.0, north=42.2)

Ring = list[list[Any]]
Geometry = dict[str, Any]

# Check stages in the documented order. A stage name is not always a reason code: both the
# parse failure and the unclosed ring report `malformed_geometry`.
STAGE_PARSE = "parse"
STAGE_TOO_MANY = "too_many_vertices"
STAGE_COORDINATE = "coordinate_out_of_range"
STAGE_TOO_FEW = "too_few_vertices"
STAGE_ZERO_AREA = "zero_area"
STAGE_UNCLOSED = "unclosed"
STAGE_SELF_INTERSECTION = "self_intersection"
STAGE_OUTSIDE = "outside_extent"

STAGES: tuple[str, ...] = (
    STAGE_PARSE,
    STAGE_TOO_MANY,
    STAGE_COORDINATE,
    STAGE_TOO_FEW,
    STAGE_ZERO_AREA,
    STAGE_UNCLOSED,
    STAGE_SELF_INTERSECTION,
    STAGE_OUTSIDE,
)

STAGE_REASON: dict[str, str] = {
    STAGE_PARSE: REASON_MALFORMED,
    STAGE_TOO_MANY: REASON_TOO_MANY_VERTICES,
    STAGE_COORDINATE: REASON_COORDINATE_OUT_OF_RANGE,
    STAGE_TOO_FEW: REASON_TOO_FEW_VERTICES,
    STAGE_ZERO_AREA: REASON_ZERO_AREA,
    STAGE_UNCLOSED: REASON_MALFORMED,
    STAGE_SELF_INTERSECTION: REASON_SELF_INTERSECTION,
    STAGE_OUTSIDE: REASON_OUTSIDE_EXTENT,
}

BAND_WIDTH = 4.0
WEST_BAND = -124.0
"""West edge of the band used for the first part of a pair (runs to -120)."""
EAST_BAND = -118.0
"""West edge of the band used for the second part of a pair (runs to -114)."""
INSIDE_LAT = (34.0, 40.0)
"""Latitude range of defective shapes that must not trip the extent check on their own."""
SOUTH_OF_EXTENT = (28.0, 32.0)


class Defective(NamedTuple):
    """A shape with one injected defect and the stage that should report it."""

    geometry: Geometry
    stage: str

    @property
    def reason(self) -> str:
        return STAGE_REASON[self.stage]


class CircleCase(NamedTuple):
    """A circle input and the expected `(field, reason)` pairs, in report order."""

    circle: CircleSpec
    expected: list[tuple[str, str]]


# --- building blocks ---------------------------------------------------------------------


def _i(value: float) -> int:
    return round(value * 1000)


@st.composite
def boxes(
    draw: st.DrawFn,
    lon_lo: float,
    lon_hi: float,
    lat_lo: float,
    lat_hi: float,
    min_size: float = 0.2,
) -> tuple[float, float, float, float]:
    """`(x0, y0, x1, y1)` with `x1 - x0` and `y1 - y0` at least `min_size`, inside the ranges."""
    m = _i(min_size)
    ix0 = draw(st.integers(_i(lon_lo), _i(lon_hi) - m))
    ix1 = draw(st.integers(ix0 + m, _i(lon_hi)))
    iy0 = draw(st.integers(_i(lat_lo), _i(lat_hi) - m))
    iy1 = draw(st.integers(iy0 + m, _i(lat_hi)))
    return ix0 / 1000, iy0 / 1000, ix1 / 1000, iy1 / 1000


def rect_ring(x0: float, y0: float, x1: float, y1: float) -> Ring:
    """Closed counter-clockwise rectangle ring; every position is its own list."""
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]


def regular_ring(cx: float, cy: float, radius: float, n: int) -> Ring:
    """Closed ring of `n` distinct vertices (n + 1 positions) on a circle in degrees."""
    ring = [
        [cx + radius * math.cos(2 * math.pi * k / n), cy + radius * math.sin(2 * math.pi * k / n)]
        for k in range(n)
    ]
    return [*ring, list(ring[0])]


def polygon_of(*rings: Ring) -> Geometry:
    return {"type": "Polygon", "coordinates": list(rings)}


def multipolygon_of(*polygons: list[Ring]) -> Geometry:
    return {"type": "MultiPolygon", "coordinates": list(polygons)}


def count_positions(geometry: Geometry) -> int:
    """Number of positions across all rings and parts of a Polygon or MultiPolygon mapping."""
    polygons = (
        [geometry["coordinates"]]
        if geometry["type"] == "Polygon"
        else list(geometry["coordinates"])
    )
    return sum(len(ring) for polygon in polygons for ring in polygon)


@st.composite
def _maybe_reversed(draw: st.DrawFn, ring: Ring) -> Ring:
    return list(reversed(ring)) if draw(st.booleans()) else ring


# --- valid shapes ------------------------------------------------------------------------


def _overlaps_extent(b: tuple[float, float, float, float]) -> bool:
    x0, y0, x1, y1 = b
    width = min(x1, EXTENT.east) - max(x0, EXTENT.west)
    height = min(y1, EXTENT.north) - max(y0, EXTENT.south)
    return width >= 0.01 and height >= 0.01


@st.composite
def _valid_rectangle(draw: st.DrawFn) -> Geometry:
    """A rectangle inside the extent or hanging over its edge (valid, to be clipped later)."""
    b = draw(boxes(-126.0, -112.0, 31.0, 44.0).filter(_overlaps_extent))
    return polygon_of(draw(_maybe_reversed(rect_ring(*b))))


@st.composite
def _valid_regular_polygon(draw: st.DrawFn) -> Geometry:
    n = draw(st.one_of(st.integers(3, 64), st.just(999)))  # 999 distinct = 1000 positions
    cx = draw(st.integers(_i(EXTENT.west), _i(EXTENT.east))) / 1000
    cy = draw(st.integers(_i(EXTENT.south), _i(EXTENT.north))) / 1000
    radius = draw(st.integers(50, 1000)) / 1000
    return polygon_of(draw(_maybe_reversed(regular_ring(cx, cy, radius, n))))


@st.composite
def _valid_with_hole(draw: st.DrawFn) -> Geometry:
    x0, y0, x1, y1 = draw(boxes(-124.0, -114.5, 33.0, 42.0, min_size=1.0))
    margin = 0.2
    hole = rect_ring(x0 + margin, y0 + margin, x1 - margin, y1 - margin)
    return polygon_of(rect_ring(x0, y0, x1, y1), list(reversed(hole)))


@st.composite
def _valid_multipolygon(draw: st.DrawFn) -> Geometry:
    west = draw(boxes(WEST_BAND, WEST_BAND + BAND_WIDTH, *INSIDE_LAT))
    east = draw(boxes(EAST_BAND, EAST_BAND + BAND_WIDTH, *INSIDE_LAT))
    return multipolygon_of([rect_ring(*west)], [rect_ring(*east)])


valid_geometries: st.SearchStrategy[Geometry] = st.one_of(
    _valid_rectangle(), _valid_regular_polygon(), _valid_with_hole(), _valid_multipolygon()
)


@st.composite
def valid_circles(draw: st.DrawFn) -> CircleSpec:
    lat = draw(st.integers(_i(EXTENT.south), _i(EXTENT.north))) / 1000
    lon = draw(st.integers(_i(EXTENT.west), _i(EXTENT.east))) / 1000
    radius = draw(st.one_of(st.sampled_from([1.0, 500.0]), st.floats(1.0, 500.0)))
    return CircleSpec(lat=lat, lon=lon, radius_km=radius)


# --- ring-level defects (one per stage) --------------------------------------------------

_BAD_LON = st.one_of(
    st.floats(180.001, 1e4),
    st.floats(-1e4, -180.001),
    st.sampled_from([math.nan, math.inf, -math.inf]),
)
_BAD_LAT = st.one_of(
    st.floats(90.001, 1e4),
    st.floats(-1e4, -90.001),
    st.sampled_from([math.nan, math.inf, -math.inf]),
)
_BAD_POSITIONS = st.sampled_from(["x", None, True, [1.0], [1.0, 2.0, 3.0, 4.0], [1.0, "a"], {}])


@st.composite
def _unparsable_ring(draw: st.DrawFn, lon_lo: float) -> Ring:
    ring = rect_ring(*draw(boxes(lon_lo, lon_lo + BAND_WIDTH, *INSIDE_LAT)))
    ring[draw(st.integers(0, 3))] = draw(_BAD_POSITIONS)
    return ring


@st.composite
def _huge_ring(draw: st.DrawFn, lon_lo: float) -> Ring:
    n = draw(st.integers(1000, 1100))  # n distinct vertices = n + 1 positions, above the limit
    return regular_ring(lon_lo + BAND_WIDTH / 2, 37.0, 1.0, n)


@st.composite
def _out_of_range_ring(draw: st.DrawFn, lon_lo: float) -> Ring:
    ring = rect_ring(*draw(boxes(lon_lo, lon_lo + BAND_WIDTH, *INSIDE_LAT)))
    axis = draw(st.sampled_from([0, 1]))
    bad = draw(_BAD_LON if axis == 0 else _BAD_LAT)
    vertex = draw(st.integers(0, 3))
    ring[vertex][axis] = bad
    if vertex == 0:
        ring[4][axis] = bad  # keep the ring closed
    return ring


@st.composite
def _few_distinct_ring(draw: st.DrawFn, lon_lo: float) -> Ring:
    a = [draw(st.integers(_i(lon_lo), _i(lon_lo + BAND_WIDTH))) / 1000, 37.0]
    b = [a[0] + draw(st.integers(0, 500)) / 1000, 37.5]
    points = draw(st.sampled_from([[a], [a, b]]))
    sequence = draw(st.lists(st.sampled_from(points), min_size=2, max_size=5))
    ring = [list(p) for p in [points[0], *sequence, points[0]]]
    return ring


@st.composite
def _collinear_ring(draw: st.DrawFn, lon_lo: float) -> Ring:
    # Multiples of 0.25 are exact in binary, so the points are exactly collinear.
    dx, dy = draw(st.tuples(st.integers(-1, 1), st.integers(-1, 1)).filter(lambda t: t != (0, 0)))
    n = draw(st.integers(3, 6))
    base_x = lon_lo + 2.0 + draw(st.integers(-2, 2)) * 0.25
    base_y = 37.0 + draw(st.integers(-2, 2)) * 0.25
    points = [[base_x + k * 0.25 * dx, base_y + k * 0.25 * dy] for k in range(n)]
    order = draw(st.permutations(points))
    return [*[list(p) for p in order], list(order[0])]


@st.composite
def _unclosed_ring(draw: st.DrawFn, lon_lo: float) -> Ring:
    x0, y0, x1, y1 = draw(boxes(lon_lo, lon_lo + BAND_WIDTH, *INSIDE_LAT))
    ring = rect_ring(x0, y0, x1, y1)
    if draw(st.booleans()):
        return ring[:-1]  # four distinct positions, first and last differ
    ring[-1] = [x0 + 0.1, y0]  # last position differs from the first
    return ring


@st.composite
def _self_crossing_ring(draw: st.DrawFn, lon_lo: float) -> Ring:
    x0, y0, x1, y1 = draw(boxes(lon_lo, lon_lo + BAND_WIDTH, *INSIDE_LAT))
    if draw(st.booleans()):  # bow tie
        return [[x0, y0], [x1, y1], [x1, y0], [x0, y1], [x0, y0]]
    mid = [(x0 + x1) / 2, (y0 + y1) / 2]  # figure of eight pinched at one vertex
    return [[x0, y0], [x1, y0], list(mid), [x1, y1], [x0, y1], list(mid), [x0, y0]]


@st.composite
def _outside_ring(draw: st.DrawFn, lon_lo: float) -> Ring:
    """A valid rectangle south of the extent. Longitude and latitude are in range."""
    return rect_ring(*draw(boxes(lon_lo, lon_lo + BAND_WIDTH, *SOUTH_OF_EXTENT)))


_RING_FACTORIES = {
    STAGE_PARSE: _unparsable_ring,
    STAGE_TOO_MANY: _huge_ring,
    STAGE_COORDINATE: _out_of_range_ring,
    STAGE_TOO_FEW: _few_distinct_ring,
    STAGE_ZERO_AREA: _collinear_ring,
    STAGE_UNCLOSED: _unclosed_ring,
    STAGE_SELF_INTERSECTION: _self_crossing_ring,
    STAGE_OUTSIDE: _outside_ring,
}


def ring_defect(stage: str, lon_lo: float) -> st.SearchStrategy[Ring]:
    """A ring with only the defect of `stage`, within the band starting at `lon_lo`."""
    return _RING_FACTORIES[stage](lon_lo)


# --- single defects ----------------------------------------------------------------------


@st.composite
def _ring_defect_polygon(draw: st.DrawFn) -> Defective:
    stage = draw(st.sampled_from(STAGES))
    lon_lo = draw(st.integers(_i(WEST_BAND), _i(EAST_BAND))) / 1000
    return Defective(polygon_of(draw(ring_defect(stage, lon_lo))), stage)


_NOT_POLYGONS: list[Geometry] = [
    {"type": "Point", "coordinates": [-120.0, 37.0]},
    {"type": "LineString", "coordinates": [[-120.0, 37.0], [-119.0, 38.0]]},
    {"type": "MultiPoint", "coordinates": [[-120.0, 37.0]]},
    {"type": "polygon", "coordinates": [rect_ring(-121.0, 36.0, -119.0, 38.0)]},
    {"coordinates": [rect_ring(-121.0, 36.0, -119.0, 38.0)]},
    {"type": "Polygon"},
    {"type": "Polygon", "coordinates": []},
    {"type": "Polygon", "coordinates": "x"},
    {"type": "Polygon", "coordinates": [[-120.5, 37.5]]},
    {"type": "MultiPolygon", "coordinates": []},
    {"type": "MultiPolygon", "coordinates": [rect_ring(-121.0, 36.0, -119.0, 38.0)]},
]


@st.composite
def _malformed_structure(draw: st.DrawFn) -> Defective:
    return Defective(draw(st.sampled_from(_NOT_POLYGONS)), STAGE_PARSE)


@st.composite
def _huge_total_over_parts(draw: st.DrawFn) -> Defective:
    """Three parts of 336 to 400 distinct vertices each: no part is large, the sum is over 1000."""
    parts = [
        [regular_ring(cx, 37.0, 0.8, draw(st.integers(336, 400)))]
        for cx in (-122.0, -119.0, -116.0)
    ]
    return Defective(multipolygon_of(*parts), STAGE_TOO_MANY)


@st.composite
def _bad_hole_or_overlap(draw: st.DrawFn) -> Defective:
    """A hole that leaves its shell, or two parts that overlap. Every ring is simple."""
    x0, y0, x1, y1 = draw(boxes(-123.0, -116.0, 34.0, 40.0, min_size=1.0))
    kind = draw(st.sampled_from(["hole_crosses_shell", "hole_outside_shell", "parts_overlap"]))
    if kind == "hole_crosses_shell":
        hole = rect_ring(x0 + 0.2, y0 + 0.2, x1 + 0.5, y1 - 0.2)
        return Defective(polygon_of(rect_ring(x0, y0, x1, y1), hole), STAGE_SELF_INTERSECTION)
    if kind == "hole_outside_shell":
        hole = rect_ring(x1 + 0.3, y0, x1 + 0.6, y1)
        return Defective(polygon_of(rect_ring(x0, y0, x1, y1), hole), STAGE_SELF_INTERSECTION)
    other = rect_ring(x0 + 0.2, y0 + 0.2, x1 + 0.5, y1 + 0.5)
    return Defective(multipolygon_of([rect_ring(x0, y0, x1, y1)], [other]), STAGE_SELF_INTERSECTION)


@st.composite
def _outside_side(draw: st.DrawFn) -> Defective:
    """A valid rectangle beside the extent. It may share an edge with it (zero overlap)."""
    side = draw(st.sampled_from(["east", "west", "north", "south"]))
    e = EXTENT
    if side == "east":
        b = draw(boxes(e.east, e.east + 10.0, 30.0, 45.0))
    elif side == "west":
        b = draw(boxes(e.west - 10.0, e.west, 30.0, 45.0))
    elif side == "north":
        b = draw(boxes(-130.0, -110.0, e.north, e.north + 5.0))
    else:
        b = draw(boxes(-130.0, -110.0, e.south - 5.0, e.south))
    if draw(st.booleans()):
        return Defective(polygon_of(rect_ring(*b)), STAGE_OUTSIDE)
    # A second part, also outside, east of the extent and apart from the first part.
    far = draw(boxes(-100.0, -90.0, 30.0, 45.0))
    return Defective(multipolygon_of([rect_ring(*b)], [rect_ring(*far)]), STAGE_OUTSIDE)


single_defects: st.SearchStrategy[Defective] = st.one_of(
    _ring_defect_polygon(),
    _malformed_structure(),
    _huge_total_over_parts(),
    _bad_hole_or_overlap(),
    _outside_side(),
)


# --- pairs of defects --------------------------------------------------------------------


@st.composite
def defect_pairs(draw: st.DrawFn) -> tuple[Geometry, str, str]:
    """A MultiPolygon with a defect in each part. Returns `(geometry, stage_a, stage_b)`."""
    stage_a = draw(st.sampled_from(STAGES))
    stage_b = draw(st.sampled_from(STAGES))
    ring_a = draw(ring_defect(stage_a, WEST_BAND))
    ring_b = draw(ring_defect(stage_b, EAST_BAND))
    parts = [[ring_a], [ring_b]]
    if draw(st.booleans()):
        parts.reverse()
        stage_a, stage_b = stage_b, stage_a
    return multipolygon_of(*parts), stage_a, stage_b


def earlier_stage(stage_a: str, stage_b: str) -> str:
    return min(stage_a, stage_b, key=STAGES.index)


# --- circles -----------------------------------------------------------------------------

_BAD_CIRCLE_LAT = st.one_of(
    st.floats(90.001, 1e6),
    st.floats(-1e6, -90.001),
    st.sampled_from([math.nan, math.inf, -math.inf]),
)
_BAD_CIRCLE_LON = st.one_of(
    st.floats(180.001, 1e6),
    st.floats(-1e6, -180.001),
    st.sampled_from([math.nan, math.inf, -math.inf]),
)
_BAD_RADIUS = st.one_of(
    st.floats(-1e6, 0.999),
    st.floats(500.001, 1e6),
    st.sampled_from([math.nan, math.inf, -math.inf]),
)


@st.composite
def invalid_circles(draw: st.DrawFn) -> CircleCase:
    """A circle with at least one of latitude, longitude and radius out of range."""
    good = draw(valid_circles())
    bad_flags = draw(st.tuples(st.booleans(), st.booleans(), st.booleans()).filter(any))
    lat = draw(_BAD_CIRCLE_LAT) if bad_flags[0] else good.lat
    lon = draw(_BAD_CIRCLE_LON) if bad_flags[1] else good.lon
    radius = draw(_BAD_RADIUS) if bad_flags[2] else good.radius_km
    fields = (
        ("circle.lat", REASON_COORDINATE_OUT_OF_RANGE),
        ("circle.lon", REASON_COORDINATE_OUT_OF_RANGE),
        ("circle.radius_km", REASON_RADIUS_OUT_OF_RANGE),
    )
    expected = [f for f, bad in zip(fields, bad_flags, strict=True) if bad]
    return CircleCase(CircleSpec(lat=lat, lon=lon, radius_km=radius), expected)


@st.composite
def circles_outside_extent(draw: st.DrawFn) -> CircleCase:
    """Valid centre and radius, far from the California region."""
    lat = draw(st.integers(-40000, 40000)) / 1000
    lon = draw(st.integers(-60000, 60000)) / 1000
    radius = draw(st.floats(1.0, 500.0))
    return CircleCase(
        CircleSpec(lat=lat, lon=lon, radius_km=radius), [("circle", REASON_OUTSIDE_EXTENT)]
    )


@st.composite
def circles_over_antimeridian(draw: st.DrawFn) -> CircleCase:
    """Valid centre and radius, but the 64-vertex polygon reaches a longitude beyond 180."""
    lat = draw(st.integers(-60000, 60000)) / 1000
    side = draw(st.sampled_from([1.0, -1.0]))
    lon = side * draw(st.integers(179900, 180000)) / 1000
    radius = draw(st.floats(100.0, 500.0))
    return CircleCase(
        CircleSpec(lat=lat, lon=lon, radius_km=radius),
        [("circle", REASON_COORDINATE_OUT_OF_RANGE)],
    )


circle_defects: st.SearchStrategy[CircleCase] = st.one_of(
    invalid_circles(), circles_outside_extent(), circles_over_antimeridian()
)

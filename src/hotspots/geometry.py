"""Selection geometry: validation, clipping to the region extent, circles and geodesic area.

Pure functions on GeoJSON-style mappings and shapely geometries. No I/O. All coordinates are
EPSG:4326, `(longitude, latitude)` in decimal degrees.

Requirements: 9.7 (cell selection area), 12.1 (circle of 64 vertices), 13.1 to 13.5 (validation
and clipping), 19.5 (area per 1000 km2).

Reason codes
------------
`validate_selection` reports a problem as a `SelectionIssue` whose `reason` is one of
`SELECTION_REASONS`. The same strings are used as the `reason` of an API field error
(`hotspots.api.errors.ApiValidationError`, `fields=[{field, reason}]`), and by the front-end
`geometryPrecheck` (vectors in `tests/data/selection_vectors.json`):

Checks run in this order and the first failing stage decides, so the answer is deterministic:

1. `malformed_geometry`: not a Polygon or MultiPolygon, wrong nesting or a non-numeric position.
2. `too_many_vertices`: more than `MAX_VERTICES` positions across all rings and all parts.
3. `coordinate_out_of_range`: longitude outside -180 to 180, latitude outside -90 to 90, or a
   value that is not finite.
4. `too_few_vertices`: a ring has fewer than 3 distinct vertices.
5. `zero_area`: the vertices of a ring are collinear (convex hull area below
   `ZERO_AREA_TOLERANCE_DEG2`).
6. `malformed_geometry` again when a ring is not closed (first and last position differ).
7. `self_intersection`: a ring crosses or touches itself, or holes and parts overlap illegally.
8. `outside_extent`: the area has no positive-area overlap with the region extent.

For a circle, `coordinate_out_of_range` (latitude, longitude) and `radius_out_of_range` (radius
not between 1 and 500 km inclusive) are reported together, one issue per field. `zero_area` is
tested before `self_intersection` because a collinear ring is also not simple.

Geodesy
-------
No `pyproj`. Distances and areas use a sphere of the IUGG mean Earth radius
(`EARTH_RADIUS_KM` = 6371.0088 km). Against the WGS-84 ellipsoid this differs by about 0.2 % at
California latitudes (32.5 to 42.2 degrees North) and by at most about 0.6 % anywhere, so the
circle of Requirement 12.1 (each vertex within 0.5 % of the radius) holds for the California
region. Polygon edges are treated as straight lines in longitude and latitude (the same
convention as the point-in-polygon test), and the area of a ring is
`R^2 * |integral of sin(lat) d(lon)|` evaluated with the trapezoid rule on each edge. For a
rectangle bounded by parallels and meridians this is exact on the sphere.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Final

import numpy as np
import shapely
from shapely.geometry import MultiPoint, MultiPolygon, Polygon
from shapely.geometry import box as shapely_box

from hotspots.config import Extent
from hotspots.constants import REGION_LABEL

MAX_VERTICES: Final[int] = 1000
"""Most positions a selection may have, counted across all rings and all parts (Req 13.4).
Equal to `hotspots.api.schemas.MAX_VERTICES`."""

CIRCLE_VERTICES: Final[int] = 64
"""Distinct vertices of the polygon that approximates a circle (Req 12.1)."""

MIN_RADIUS_KM: Final[float] = 1.0
MAX_RADIUS_KM: Final[float] = 500.0
"""Allowed circle radius, inclusive (Req 13.5)."""

EARTH_RADIUS_KM: Final[float] = 6371.0088
"""IUGG mean Earth radius in km, used for every distance and area in this module."""

ZERO_AREA_TOLERANCE_DEG2: Final[float] = 1e-12
"""A ring whose convex hull is smaller than this (square degrees, about 0.1 m by 0.1 m) has zero
area. Collinear vertices give exactly 0."""

MIN_DISTINCT_VERTICES: Final[int] = 3

REASON_MALFORMED: Final[str] = "malformed_geometry"
REASON_TOO_MANY_VERTICES: Final[str] = "too_many_vertices"
REASON_COORDINATE_OUT_OF_RANGE: Final[str] = "coordinate_out_of_range"
REASON_TOO_FEW_VERTICES: Final[str] = "too_few_vertices"
REASON_ZERO_AREA: Final[str] = "zero_area"
REASON_SELF_INTERSECTION: Final[str] = "self_intersection"
REASON_RADIUS_OUT_OF_RANGE: Final[str] = "radius_out_of_range"
REASON_OUTSIDE_EXTENT: Final[str] = "outside_extent"

SELECTION_REASONS: Final[tuple[str, ...]] = (
    REASON_MALFORMED,
    REASON_TOO_MANY_VERTICES,
    REASON_COORDINATE_OUT_OF_RANGE,
    REASON_TOO_FEW_VERTICES,
    REASON_ZERO_AREA,
    REASON_SELF_INTERSECTION,
    REASON_RADIUS_OUT_OF_RANGE,
    REASON_OUTSIDE_EXTENT,
)

ERROR_CODE_INVALID_GEOMETRY: Final[str] = "invalid_geometry"
ERROR_CODE_OUTSIDE_COVERAGE: Final[str] = "outside_coverage"
"""API error `code` for each failure: `outside_coverage` for `outside_extent`, otherwise
`invalid_geometry`."""

GEOMETRY_FIELD: Final[str] = "geometry"

Position = tuple[float, float]
AreaGeometry = Polygon | MultiPolygon


# --- result types ------------------------------------------------------------------------


@dataclass(frozen=True)
class SelectionIssue:
    """One problem: the API field it belongs to, a reason code and a plain message.

    The message never echoes submitted coordinates, only counts, limits and the extent.
    """

    field: str
    reason: str
    message: str


@dataclass(frozen=True)
class CircleSpec:
    """A circle given by centre and radius, as entered by the user (Req 12.1)."""

    lat: float
    lon: float
    radius_km: float


@dataclass(frozen=True)
class SelectionValidation:
    """Outcome of `validate_selection`.

    `ok` is True when the shape is acceptable, possibly partly outside the extent (it is then
    clipped by `clip_to_extent`). `polygon` is the parsed shape when `ok` (for a circle, the
    64-vertex polygon). `vertex_count` is the number of positions when it could be counted.
    """

    ok: bool
    issues: tuple[SelectionIssue, ...] = ()
    vertex_count: int | None = None
    polygon: AreaGeometry | None = None

    @property
    def reason(self) -> str | None:
        """Reason code of the first issue, or None when valid."""
        return self.issues[0].reason if self.issues else None

    @property
    def error_code(self) -> str | None:
        """API error code for a failed validation, or None when valid."""
        if self.reason is None:
            return None
        if self.reason == REASON_OUTSIDE_EXTENT:
            return ERROR_CODE_OUTSIDE_COVERAGE
        return ERROR_CODE_INVALID_GEOMETRY


@dataclass(frozen=True)
class ClipResult:
    """Outcome of `clip_to_extent`.

    `geometry` is None when nothing remains (entirely outside). `clipped_percent` is the share
    of the original geodesic area removed, 0 to 100. `clipped` is True when any part of the
    shape lay outside the extent.
    """

    geometry: AreaGeometry | None
    clipped: bool
    clipped_percent: float
    original_area_km2: float
    clipped_area_km2: float


# --- validation --------------------------------------------------------------------------


def validate_selection(
    geometry: Mapping[str, Any] | None = None,
    *,
    extent: Extent,
    circle: CircleSpec | None = None,
) -> SelectionValidation:
    """Validate a selection against Requirement 13.

    Give exactly one of `geometry` (a GeoJSON Polygon or MultiPolygon mapping) or `circle`.
    A shape partly outside `extent` is valid (clip it with `clip_to_extent`). A shape with no
    area inside `extent`, or touching it only along an edge, fails with `outside_extent`.
    """
    if (geometry is None) == (circle is None):
        raise ValueError("give exactly one of `geometry` or `circle`")
    if circle is not None:
        return _validate_circle(circle, extent)
    assert geometry is not None
    return _validate_geometry(geometry, extent)


def _issue(reason: str, message: str, field: str = GEOMETRY_FIELD) -> SelectionValidation:
    return SelectionValidation(ok=False, issues=(SelectionIssue(field, reason, message),))


def _extent_text(extent: Extent) -> str:
    return (
        f"west {extent.west:g}, south {extent.south:g}, "
        f"east {extent.east:g}, north {extent.north:g}"
    )


def _outside_message(extent: Extent) -> str:
    return f"The area is outside the {REGION_LABEL} ({_extent_text(extent)})."


def _is_real_number(value: object) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool)


def _parse_position(value: object) -> Position | None:
    if not isinstance(value, list | tuple) or len(value) not in (2, 3):
        return None
    if not all(_is_real_number(c) for c in value):
        return None
    return (float(value[0]), float(value[1]))


def _parse_rings(polygon: object) -> list[list[Position]] | None:
    if not isinstance(polygon, list | tuple) or not polygon:
        return None
    rings: list[list[Position]] = []
    for ring in polygon:
        if not isinstance(ring, list | tuple):
            return None
        parsed = [_parse_position(p) for p in ring]
        if any(p is None for p in parsed):
            return None
        rings.append([p for p in parsed if p is not None])
    return rings


def _parse_polygons(geometry: Mapping[str, Any]) -> list[list[list[Position]]] | None:
    """Parse a Polygon or MultiPolygon mapping into polygons of rings of positions."""
    kind = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if kind == "Polygon":
        rings = _parse_rings(coordinates)
        return None if rings is None else [rings]
    if kind == "MultiPolygon":
        if not isinstance(coordinates, list | tuple) or not coordinates:
            return None
        polygons = [_parse_rings(p) for p in coordinates]
        if any(p is None for p in polygons):
            return None
        return [p for p in polygons if p is not None]
    return None


def _validate_geometry(geometry: Mapping[str, Any], extent: Extent) -> SelectionValidation:
    if not isinstance(geometry, Mapping):
        return _issue(REASON_MALFORMED, "The area must be a GeoJSON Polygon or MultiPolygon.")
    polygons = _parse_polygons(geometry)
    if polygons is None:
        return _issue(
            REASON_MALFORMED,
            "The area must be a GeoJSON Polygon or MultiPolygon with numeric "
            "[longitude, latitude] positions.",
        )

    rings = [ring for polygon in polygons for ring in polygon]
    count = sum(len(ring) for ring in rings)

    def fail(reason: str, message: str) -> SelectionValidation:
        return SelectionValidation(
            ok=False,
            issues=(SelectionIssue(GEOMETRY_FIELD, reason, message),),
            vertex_count=count,
        )

    if count > MAX_VERTICES:
        return fail(
            REASON_TOO_MANY_VERTICES,
            f"The area has {count} vertices; the limit is {MAX_VERTICES} "
            "(counted across all rings and parts).",
        )
    for ring in rings:
        for lon, lat in ring:
            if not (math.isfinite(lon) and math.isfinite(lat)):
                return fail(REASON_COORDINATE_OUT_OF_RANGE, "Coordinates must be finite numbers.")
            if not -180.0 <= lon <= 180.0:
                return fail(
                    REASON_COORDINATE_OUT_OF_RANGE, "Longitude must be between -180 and 180."
                )
            if not -90.0 <= lat <= 90.0:
                return fail(REASON_COORDINATE_OUT_OF_RANGE, "Latitude must be between -90 and 90.")
    for ring in rings:
        if len(set(ring)) < MIN_DISTINCT_VERTICES:
            return fail(
                REASON_TOO_FEW_VERTICES,
                f"The area needs at least {MIN_DISTINCT_VERTICES} distinct vertices.",
            )
    for ring in rings:
        if MultiPoint(ring).convex_hull.area < ZERO_AREA_TOLERANCE_DEG2:
            return fail(REASON_ZERO_AREA, "The area has zero area (all vertices are in a line).")
    for ring in rings:
        if len(ring) < 4 or ring[0] != ring[-1]:
            return fail(
                REASON_MALFORMED,
                "Each ring must be closed: the first and last position must be equal.",
            )

    shapes = [Polygon(p[0], p[1:]) for p in polygons]
    shape: AreaGeometry = shapes[0] if len(shapes) == 1 else MultiPolygon(shapes)
    if any(not _ring_is_simple(ring) for ring in rings) or not shape.is_valid:
        return fail(
            REASON_SELF_INTERSECTION, "The area outline crosses itself or its rings overlap."
        )

    if not _intersects_with_area(shape, extent):
        return fail(REASON_OUTSIDE_EXTENT, _outside_message(extent))
    return SelectionValidation(ok=True, vertex_count=count, polygon=shape)


def _ring_is_simple(ring: Sequence[Position]) -> bool:
    """True when a closed ring does not cross or touch itself."""
    return bool(shapely.is_simple(shapely.linearrings(np.asarray(ring, dtype=float))))


def _intersects_with_area(shape: AreaGeometry, extent: Extent) -> bool:
    """True when `shape` shares positive area with the extent rectangle."""
    window = shapely_box(extent.west, extent.south, extent.east, extent.north)
    return bool(shape.intersection(window).area > 0.0)


def _validate_circle(circle: CircleSpec, extent: Extent) -> SelectionValidation:
    issues: list[SelectionIssue] = []
    if not _in_range(circle.lat, -90.0, 90.0):
        issues.append(
            SelectionIssue(
                "circle.lat", REASON_COORDINATE_OUT_OF_RANGE, "Latitude must be between -90 and 90."
            )
        )
    if not _in_range(circle.lon, -180.0, 180.0):
        issues.append(
            SelectionIssue(
                "circle.lon",
                REASON_COORDINATE_OUT_OF_RANGE,
                "Longitude must be between -180 and 180.",
            )
        )
    if not _in_range(circle.radius_km, MIN_RADIUS_KM, MAX_RADIUS_KM):
        issues.append(
            SelectionIssue(
                "circle.radius_km",
                REASON_RADIUS_OUT_OF_RANGE,
                f"Radius must be between {MIN_RADIUS_KM:g} and {MAX_RADIUS_KM:g} km.",
            )
        )
    if issues:
        return SelectionValidation(ok=False, issues=tuple(issues))

    polygon = circle_polygon(circle.lat, circle.lon, circle.radius_km)
    count = len(polygon.exterior.coords)
    outcome = _validate_geometry(to_geojson(polygon), extent)
    if not outcome.ok:
        return SelectionValidation(
            ok=False,
            issues=tuple(SelectionIssue("circle", i.reason, i.message) for i in outcome.issues),
            vertex_count=count,
        )
    return SelectionValidation(ok=True, vertex_count=count, polygon=polygon)


def _in_range(value: float, low: float, high: float) -> bool:
    return _is_real_number(value) and math.isfinite(value) and low <= value <= high


# --- clipping ----------------------------------------------------------------------------


def clip_to_extent(geometry: AreaGeometry, extent: Extent) -> ClipResult:
    """Clip a valid selection to the region extent (Req 13.3).

    `clipped_percent` is the removed share of the original geodesic area (`geodesic_area_km2`),
    0 to 100. A shape fully inside is returned unchanged with 0. A shape with nothing inside
    gives `geometry=None` and 100.
    """
    window = shapely_box(extent.west, extent.south, extent.east, extent.north)
    original_area = geodesic_area_km2(geometry)
    if window.covers(geometry):
        return ClipResult(geometry, False, 0.0, original_area, original_area)

    parts = [
        part
        for part in shapely.get_parts(geometry.intersection(window))
        if isinstance(part, Polygon) and part.area > 0.0
    ]
    clipped: AreaGeometry | None
    if not parts:
        clipped = None
    elif len(parts) == 1:
        clipped = parts[0]
    else:
        clipped = MultiPolygon(parts)
    clipped_area = 0.0 if clipped is None else geodesic_area_km2(clipped)
    percent = 100.0 if original_area <= 0.0 else 100.0 * (1.0 - clipped_area / original_area)
    percent = min(100.0, max(0.0, percent))
    return ClipResult(clipped, True, percent, original_area, clipped_area)


# --- circle and area ---------------------------------------------------------------------


def circle_polygon(
    lat: float, lon: float, radius_km: float, n_vertices: int = CIRCLE_VERTICES
) -> Polygon:
    """Polygon of `n_vertices` distinct vertices at geodesic distance `radius_km` from the centre.

    Vertices are placed at equal bearings with the spherical direct formula (`EARTH_RADIUS_KM`),
    counter-clockwise starting due north, and the ring is closed (`n_vertices + 1` positions).
    Longitudes are not wrapped, so a circle crossing the antimeridian has a longitude beyond
    180 and fails validation. Raises `ValueError` for a centre or radius outside the allowed
    ranges.
    """
    if not _in_range(lat, -90.0, 90.0) or not _in_range(lon, -180.0, 180.0):
        raise ValueError("centre must have latitude -90 to 90 and longitude -180 to 180")
    if not _in_range(radius_km, MIN_RADIUS_KM, MAX_RADIUS_KM):
        raise ValueError(f"radius must be between {MIN_RADIUS_KM:g} and {MAX_RADIUS_KM:g} km")
    if n_vertices < 3:
        raise ValueError("a circle needs at least 3 vertices")

    delta = radius_km / EARTH_RADIUS_KM
    phi1 = math.radians(lat)
    lam1 = math.radians(lon)
    bearings = -2.0 * math.pi * np.arange(n_vertices) / n_vertices  # counter-clockwise
    sin_phi2 = math.sin(phi1) * math.cos(delta) + math.cos(phi1) * math.sin(delta) * np.cos(
        bearings
    )
    sin_phi2 = np.clip(sin_phi2, -1.0, 1.0)
    phi2 = np.arcsin(sin_phi2)
    lam2 = lam1 + np.arctan2(
        np.sin(bearings) * math.sin(delta) * math.cos(phi1),
        math.cos(delta) - math.sin(phi1) * sin_phi2,
    )
    ring = np.column_stack((np.degrees(lam2), np.degrees(phi2)))
    return Polygon(np.vstack((ring, ring[:1])))


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in km on the sphere of `EARTH_RADIUS_KM`."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = p2 - p1
    dlam = math.radians(lon2 - lon1)
    h = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlam / 2) ** 2
    return 2.0 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(h)))


def _ring_area_km2(coords: np.ndarray) -> float:
    """Absolute spherical area of one closed ring (columns lon, lat in degrees)."""
    lon = np.radians(coords[:, 0])
    lat = np.radians(coords[:, 1])
    dlon = (lon[1:] - lon[:-1] + math.pi) % (2.0 * math.pi) - math.pi
    total = float(np.sum(dlon * (2.0 + np.sin(lat[:-1]) + np.sin(lat[1:]))))
    return abs(0.5 * EARTH_RADIUS_KM**2 * total)


def geodesic_area_km2(geometry: AreaGeometry) -> float:
    """Area in km2 of a Polygon or MultiPolygon on the sphere (see the module note).

    Holes are subtracted. Empty geometries have area 0.
    """
    if geometry.is_empty:
        return 0.0
    if isinstance(geometry, MultiPolygon):
        return sum(geodesic_area_km2(part) for part in geometry.geoms)
    area = _ring_area_km2(np.asarray(geometry.exterior.coords))
    for hole in geometry.interiors:
        area -= _ring_area_km2(np.asarray(hole.coords))
    return max(0.0, area)


# --- GeoJSON helpers ---------------------------------------------------------------------


def to_geojson(geometry: AreaGeometry, ndigits: int | None = None) -> dict[str, Any]:
    """GeoJSON mapping (lists, not tuples) of a Polygon or MultiPolygon.

    `ndigits` rounds every coordinate when given (the URL and API use 6 decimals).
    """

    def pos(c: Sequence[float]) -> list[float]:
        x, y = float(c[0]), float(c[1])
        return [x, y] if ndigits is None else [round(x, ndigits), round(y, ndigits)]

    def rings(p: Polygon) -> list[list[list[float]]]:
        return [[pos(c) for c in ring.coords] for ring in (p.exterior, *p.interiors)]

    if isinstance(geometry, MultiPolygon):
        return {"type": "MultiPolygon", "coordinates": [rings(p) for p in geometry.geoms]}
    return {"type": "Polygon", "coordinates": rings(geometry)}

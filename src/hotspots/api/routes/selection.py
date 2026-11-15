"""`POST /api/v1/selection/normalize`: validate a drawn or entered area and clip it to the region.

Requirements 9.1, 12.1, 12.5, 13.1 to 13.7, 29.4.

The body holds exactly one of `geometry` (GeoJSON Polygon or MultiPolygon), `bbox`
(west, south, east, north), `circle` (`lat`, `lon`, `radius_km`; a 64-vertex geodesic polygon)
or `geojson` (a FeatureCollection, Feature or geometry up to 5 MB; polygon features are
unioned, the others are counted in `ignored_features`). GeoJSON failures are reported on the
field `geojson` with the reasons `malformed_geojson`, `no_polygon_features`, `file_too_large`
or a reason of `hotspots.geometry`.

The response carries the clipped polygon (6 decimals, EPSG:4326), whether and how much was
clipped, and the number of cells whose centre lies inside the clipped area. An area with no
cell centre is accepted with `notice: "no_cells"` (requirement 12.8).

HTTP 422 for an invalid area, with the same codes and `{field, reason}` entries as the other
routes: `invalid_geometry` (a reason from `hotspots.geometry.SELECTION_REASONS`, or one of the
bbox reasons below) and `outside_coverage`. Submitted coordinates are never echoed.
"""

from __future__ import annotations

import json
from typing import Any, Final

from fastapi import APIRouter
from shapely.geometry import MultiPolygon, Polygon, shape
from shapely.geometry import box as shapely_box
from shapely.ops import unary_union

from hotspots.api.deps import ConfigDep, MaskCacheDep
from hotspots.api.errors import ApiValidationError
from hotspots.api.schemas import Bbox, FieldError, Geometry, NormalizeIn, NormalizeOut
from hotspots.api.serialize import PERCENT_DECIMALS, round_half_up
from hotspots.areastats import NOTICE_NO_CELLS
from hotspots.config import Extent
from hotspots.geometry import (
    ERROR_CODE_INVALID_GEOMETRY,
    ERROR_CODE_OUTSIDE_COVERAGE,
    MAX_VERTICES,
    REASON_COORDINATE_OUT_OF_RANGE,
    REASON_OUTSIDE_EXTENT,
    REASON_TOO_MANY_VERTICES,
    AreaGeometry,
    CircleSpec,
    SelectionValidation,
    clip_to_extent,
    to_geojson,
    validate_selection,
)

router = APIRouter(prefix="/api/v1", tags=["selection"])

BBOX_FIELD: Final[str] = "bbox"
GEOJSON_FIELD: Final[str] = "geojson"
MAX_GEOJSON_BYTES: Final[int] = 5 * 1024 * 1024
"""Largest accepted GeoJSON document (5 MB, requirement 12.5)."""
REASON_MALFORMED_GEOJSON: Final[str] = "malformed_geojson"
REASON_NO_POLYGON_FEATURES: Final[str] = "no_polygon_features"
REASON_FILE_TOO_LARGE: Final[str] = "file_too_large"
GEOJSON_GEOMETRY_TYPES: Final[tuple[str, ...]] = (
    "Point",
    "MultiPoint",
    "LineString",
    "MultiLineString",
    "Polygon",
    "MultiPolygon",
    "GeometryCollection",
)
REASON_WEST_NOT_LESS_THAN_EAST: Final[str] = "west_not_less_than_east"
REASON_SOUTH_NOT_LESS_THAN_NORTH: Final[str] = "south_not_less_than_north"
COORDINATE_DECIMALS: Final[int] = 6


def bbox_geometry(bbox: Bbox) -> dict[str, object]:
    """GeoJSON polygon of a bounding box, after the checks of requirements 13.5 and 13.7.

    Raises:
        ApiValidationError: `invalid_geometry` with one `{field, reason}` per problem. Range
            problems are `coordinate_out_of_range`, an inverted side is `west_not_less_than_east`
            or `south_not_less_than_north`, reported on both fields involved.
    """
    problems: list[FieldError] = []
    for name, value, limit in (
        ("west", bbox.west, 180.0),
        ("east", bbox.east, 180.0),
        ("south", bbox.south, 90.0),
        ("north", bbox.north, 90.0),
    ):
        if not -limit <= value <= limit:
            problems.append(
                FieldError(field=f"{BBOX_FIELD}.{name}", reason=REASON_COORDINATE_OUT_OF_RANGE)
            )
    if not problems:
        if bbox.west >= bbox.east:
            problems += [
                FieldError(field=f"{BBOX_FIELD}.west", reason=REASON_WEST_NOT_LESS_THAN_EAST),
                FieldError(field=f"{BBOX_FIELD}.east", reason=REASON_WEST_NOT_LESS_THAN_EAST),
            ]
        if bbox.south >= bbox.north:
            problems += [
                FieldError(field=f"{BBOX_FIELD}.south", reason=REASON_SOUTH_NOT_LESS_THAN_NORTH),
                FieldError(field=f"{BBOX_FIELD}.north", reason=REASON_SOUTH_NOT_LESS_THAN_NORTH),
            ]
    if problems:
        raise ApiValidationError(
            ERROR_CODE_INVALID_GEOMETRY,
            "The bounding box is not valid. Longitude must be -180 to 180 and latitude -90 to 90, "
            "west must be less than east and south must be less than north.",
            problems,
        )
    polygon = shapely_box(bbox.west, bbox.south, bbox.east, bbox.north)
    return to_geojson(polygon)


def normalize_geometry(
    geometry: dict[str, object], extent: Extent, field: str
) -> tuple[Geometry, bool, float]:
    """Validate ``geometry`` and clip it to ``extent``.

    Returns the clipped geometry, whether anything was clipped and the clipped percentage
    (one decimal). ``field`` names the request field in error entries.

    Raises:
        ApiValidationError: `invalid_geometry` or `outside_coverage` with `{field, reason}`.
    """
    return _finish(validate_selection(geometry, extent=extent), extent, field)


def _finish(
    validation: SelectionValidation, extent: Extent, field: str, *, keep_field: bool = True
) -> tuple[Geometry, bool, float]:
    """Raise for a failed validation, else clip to ``extent``. See `normalize_geometry`."""
    if not validation.ok or validation.polygon is None:
        issues = validation.issues
        raise ApiValidationError(
            validation.error_code or ERROR_CODE_INVALID_GEOMETRY,
            issues[0].message if issues else "The area is not valid.",
            [FieldError(field=field if keep_field else i.field, reason=i.reason) for i in issues],
        )
    clip = clip_to_extent(validation.polygon, extent)
    if clip.geometry is None:  # defensive: validation already requires an overlap
        raise ApiValidationError(
            ERROR_CODE_OUTSIDE_COVERAGE,
            "The area is outside the California region.",
            [FieldError(field=field, reason=REASON_OUTSIDE_EXTENT)],
        )
    out = Geometry.model_validate(to_geojson(clip.geometry, COORDINATE_DECIMALS))
    return out, clip.clipped, round_half_up(clip.clipped_percent, PERCENT_DECIMALS)


def _polygonal_parts(geometry: object, parts: list[dict[str, Any]], depth: int = 0) -> int:
    """Collect Polygon and MultiPolygon mappings of ``geometry`` into ``parts``.

    Returns the number of non-polygon geometries met (points, lines, null, unknown types).
    GeometryCollections are searched one level at a time, up to a small depth.
    """
    if not isinstance(geometry, dict):
        return 1
    kind = geometry.get("type")
    if kind in ("Polygon", "MultiPolygon"):
        parts.append(geometry)
        return 0
    if kind == "GeometryCollection" and depth < 3:
        members = geometry.get("geometries")
        if not isinstance(members, list) or not members:
            return 1
        return sum(_polygonal_parts(m, parts, depth + 1) for m in members)
    return 1


def geojson_polygons(content: dict[str, Any]) -> tuple[list[dict[str, Any]], int]:
    """Polygon geometries of a GeoJSON document and the number of ignored features.

    Accepts a FeatureCollection, a Feature or a bare geometry. A feature without polygon
    geometry (point, line, null geometry) is ignored and counted once.

    Raises:
        ApiValidationError: `invalid_geometry` with reason `malformed_geojson` or
            `file_too_large`.
    """
    size = len(json.dumps(content, separators=(",", ":")).encode("utf-8"))
    if size > MAX_GEOJSON_BYTES:
        raise _geojson_error(REASON_FILE_TOO_LARGE, "The GeoJSON is larger than 5 MB.")
    kind = content.get("type")
    items: list[object]
    if kind == "FeatureCollection":
        features = content.get("features")
        if not isinstance(features, list):
            raise _geojson_error(REASON_MALFORMED_GEOJSON, "The GeoJSON has no features list.")
        items = [f.get("geometry") if isinstance(f, dict) else None for f in features]
    elif kind == "Feature":
        items = [content.get("geometry")]
    elif kind in GEOJSON_GEOMETRY_TYPES:
        items = [content]
    else:
        raise _geojson_error(
            REASON_MALFORMED_GEOJSON,
            "The file is not GeoJSON: expected a FeatureCollection, Feature or geometry.",
        )
    parts: list[dict[str, Any]] = []
    ignored = 0
    for item in items:
        found: list[dict[str, Any]] = []
        missing = _polygonal_parts(item, found)
        parts += found
        if missing and not found:
            ignored += 1  # a feature is ignored when it holds no polygon at all
    return parts, ignored


def _geojson_error(reason: str, message: str) -> ApiValidationError:
    return ApiValidationError(
        ERROR_CODE_INVALID_GEOMETRY, message, [FieldError(field=GEOJSON_FIELD, reason=reason)]
    )


def union_geojson(content: dict[str, Any], extent: Extent) -> tuple[Geometry, bool, float, int]:
    """Union of the polygon features of a GeoJSON document, clipped to ``extent``.

    Returns the clipped geometry, whether it was clipped, the clipped percentage and the
    count of ignored (non-polygon) features. Every polygon is validated on its own (ranges,
    self-intersection, zero area), the vertex limit counts all polygons together, and a polygon
    outside the extent is allowed as long as the union overlaps it.
    """
    parts, ignored = geojson_polygons(content)
    if not parts:
        raise _geojson_error(
            REASON_NO_POLYGON_FEATURES, "The GeoJSON holds no polygon or multipolygon features."
        )
    world = Extent(west=-180.0, south=-90.0, east=180.0, north=90.0)
    shapes: list[AreaGeometry] = []
    total = 0
    for part in parts:
        check = validate_selection(part, extent=world)
        if not check.ok or check.polygon is None:
            issues = check.issues
            raise ApiValidationError(
                ERROR_CODE_INVALID_GEOMETRY,
                issues[0].message if issues else "The area is not valid.",
                [FieldError(field=GEOJSON_FIELD, reason=i.reason) for i in issues],
            )
        total += check.vertex_count or 0
        shapes.append(check.polygon)
    if total > MAX_VERTICES:
        raise ApiValidationError(
            ERROR_CODE_INVALID_GEOMETRY,
            f"The area has {total} vertices; the limit is {MAX_VERTICES} "
            "(counted across all rings and parts).",
            [FieldError(field=GEOJSON_FIELD, reason=REASON_TOO_MANY_VERTICES)],
        )
    merged = unary_union(shapes)
    polygons = [g for g in getattr(merged, "geoms", [merged]) if isinstance(g, Polygon)]
    union: AreaGeometry = polygons[0] if len(polygons) == 1 else MultiPolygon(polygons)
    geometry, clipped, percent = normalize_geometry(to_geojson(union), extent, GEOJSON_FIELD)
    return geometry, clipped, percent, ignored


@router.post("/selection/normalize", response_model=NormalizeOut)
def normalize_selection(body: NormalizeIn, config: ConfigDep, masks: MaskCacheDep) -> NormalizeOut:
    """Validate an area, clip it to the region extent and count the cells inside.

    A shape partly outside the region is clipped and `clipped_percent` gives the removed share
    of its area. HTTP 422 for an invalid area (`invalid_geometry`) or one entirely outside the
    region (`outside_coverage`), with a reason per field. HTTP 503 `data_unavailable` without
    data.
    """
    extent = config.region.extent
    ignored = 0
    if body.circle is not None:
        spec = CircleSpec(body.circle.lat, body.circle.lon, body.circle.radius_km)
        geometry, clipped, percent = _finish(
            validate_selection(extent=extent, circle=spec), extent, "circle", keep_field=False
        )
    elif body.geojson is not None:
        geometry, clipped, percent, ignored = union_geojson(body.geojson, extent)
    else:
        if body.bbox is not None:
            raw, field = bbox_geometry(body.bbox), BBOX_FIELD
        else:
            assert body.geometry is not None  # NormalizeIn requires exactly one input
            raw, field = body.geometry.model_dump(), "geometry"
        geometry, clipped, percent = normalize_geometry(raw, extent, field)

    # Cells are counted on the 6-decimal clipped polygon that the response returns.
    polygon = shape(geometry.model_dump())
    n_cells = int(masks.get_mask(polygon).sum())
    return NormalizeOut(
        geometry=geometry,
        clipped=clipped,
        clipped_percent=percent,
        n_cells=n_cells,
        notice=NOTICE_NO_CELLS if n_cells == 0 else None,
        ignored_features=ignored,
    )

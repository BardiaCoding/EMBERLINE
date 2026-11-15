"""Unit tests for `hotspots.geometry` (synthetic shapes only).

`tests/data/selection_vectors.json` is generated from `build_selection_vectors()` below. To
rewrite it after changing a vector, run from the project root:

    uv run python -c "from tests.unit.test_geometry import write_selection_vectors as w; w()"

(`tests/data/` is used instead of `tests/fixtures/` because `tests/fixtures.py` is a module and
a package of the same name would shadow it.)
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import pytest
from shapely.geometry import MultiPolygon, Polygon, box

from hotspots import geometry as g
from hotspots.api.schemas import MAX_VERTICES as API_MAX_VERTICES
from hotspots.config import Extent
from hotspots.geometry import CircleSpec

# DEFAULT (confirm) measured extent of the delivered data (data-contract.md).
EXTENT = Extent(west=-124.4, south=32.5, east=-114.0, north=42.2)

VECTORS_PATH = Path(__file__).resolve().parents[1] / "data" / "selection_vectors.json"

# Reasons the front-end `geometryPrecheck` is expected to detect without the server.
CLIENT_PRECHECK_REASONS = (
    g.REASON_TOO_MANY_VERTICES,
    g.REASON_COORDINATE_OUT_OF_RANGE,
    g.REASON_TOO_FEW_VERTICES,
    g.REASON_ZERO_AREA,
    g.REASON_SELF_INTERSECTION,
)


def _rect(west: float, south: float, east: float, north: float) -> dict[str, Any]:
    ring = [[west, south], [east, south], [east, north], [west, north], [west, south]]
    return {"type": "Polygon", "coordinates": [ring]}


def _regular(
    n_positions: int, cx: float = -120.0, cy: float = 37.0, r: float = 0.5
) -> dict[str, Any]:
    """A closed convex ring with `n_positions` positions (including the closing one)."""
    n = n_positions - 1
    pts = [
        [
            round(cx + r * math.cos(2 * math.pi * i / n), 6),
            round(cy + r * math.sin(2 * math.pi * i / n), 6),
        ]
        for i in range(n)
    ]
    return {"type": "Polygon", "coordinates": [[*pts, pts[0]]]}


# --- vectors for the front-end pre-check -------------------------------------------------


def _vector(
    name: str,
    *,
    geometry: dict[str, Any] | None = None,
    circle: dict[str, float] | None = None,
) -> dict[str, Any]:
    """Run the Python implementation on one input and record its outcome."""
    spec = CircleSpec(**circle) if circle is not None else None
    outcome = g.validate_selection(geometry, extent=EXTENT, circle=spec)
    clipped_percent: float | None = None
    if outcome.ok and outcome.polygon is not None:
        clipped_percent = round(g.clip_to_extent(outcome.polygon, EXTENT).clipped_percent, 4)
    entry: dict[str, Any] = {"name": name}
    if geometry is not None:
        entry["geometry"] = geometry
    if circle is not None:
        entry["circle"] = circle
    entry["expected"] = {
        "valid": outcome.ok,
        "reason": outcome.reason,
        "vertex_count": outcome.vertex_count,
        "clipped_percent": clipped_percent,
    }
    return entry


def build_selection_vectors() -> dict[str, Any]:
    hole_polygon = {
        "type": "Polygon",
        "coordinates": [
            _rect(-121.0, 36.0, -119.0, 38.0)["coordinates"][0],
            [[-120.5, 36.5], [-120.5, 37.5], [-119.5, 37.5], [-119.5, 36.5], [-120.5, 36.5]],
        ],
    }
    hole_crossing_shell = {
        "type": "Polygon",
        "coordinates": [
            _rect(-121.0, 36.0, -119.0, 38.0)["coordinates"][0],
            [[-121.5, 36.5], [-121.5, 37.5], [-119.5, 37.5], [-119.5, 36.5], [-121.5, 36.5]],
        ],
    }
    vectors = [
        _vector("valid_rectangle", geometry=_rect(-121.0, 36.0, -119.0, 38.0)),
        _vector(
            "valid_triangle",
            geometry={
                "type": "Polygon",
                "coordinates": [[[-120.0, 36.0], [-119.0, 36.0], [-119.5, 37.0], [-120.0, 36.0]]],
            },
        ),
        _vector("valid_polygon_with_hole", geometry=hole_polygon),
        _vector(
            "valid_multipolygon",
            geometry={
                "type": "MultiPolygon",
                "coordinates": [
                    [_rect(-121.0, 36.0, -120.0, 37.0)["coordinates"][0]],
                    [_rect(-119.0, 36.0, -118.0, 37.0)["coordinates"][0]],
                ],
            },
        ),
        _vector("valid_1000_vertices", geometry=_regular(1000)),
        _vector("valid_partly_outside_east", geometry=_rect(-115.0, 36.0, -113.0, 38.0)),
        _vector("valid_partly_outside_north", geometry=_rect(-120.0, 41.2, -119.0, 43.2)),
        _vector("too_many_vertices_1001", geometry=_regular(1001)),
        _vector(
            "too_few_vertices_two_distinct",
            geometry={
                "type": "Polygon",
                "coordinates": [[[-120.0, 37.0], [-119.0, 37.0], [-120.0, 37.0]]],
            },
        ),
        _vector(
            "too_few_vertices_one_distinct",
            geometry={
                "type": "Polygon",
                "coordinates": [[[-120.0, 37.0], [-120.0, 37.0], [-120.0, 37.0], [-120.0, 37.0]]],
            },
        ),
        _vector(
            "zero_area_collinear",
            geometry={
                "type": "Polygon",
                "coordinates": [
                    [[-120.0, 37.0], [-119.0, 37.0], [-118.0, 37.0], [-120.0, 37.0]],
                ],
            },
        ),
        _vector(
            "self_intersection_bowtie",
            geometry={
                "type": "Polygon",
                "coordinates": [
                    [[-120.0, 36.0], [-119.0, 37.0], [-119.0, 36.0], [-120.0, 37.0], [-120.0, 36.0]]
                ],
            },
        ),
        _vector("self_intersection_hole_crosses_shell", geometry=hole_crossing_shell),
        _vector(
            "self_intersection_overlapping_parts",
            geometry={
                "type": "MultiPolygon",
                "coordinates": [
                    [_rect(-121.0, 36.0, -119.0, 38.0)["coordinates"][0]],
                    [_rect(-120.0, 37.0, -118.0, 39.0)["coordinates"][0]],
                ],
            },
        ),
        _vector("coordinate_out_of_range_longitude", geometry=_rect(-181.0, 36.0, -119.0, 38.0)),
        _vector("coordinate_out_of_range_latitude", geometry=_rect(-121.0, 36.0, -119.0, 91.0)),
        _vector("outside_extent_nevada", geometry=_rect(-110.0, 36.0, -109.0, 37.0)),
        _vector(
            "outside_extent_touches_east_edge_only", geometry=_rect(-114.0, 36.0, -113.0, 37.0)
        ),
        _vector(
            "malformed_ring_not_closed",
            geometry={
                "type": "Polygon",
                "coordinates": [[[-120.0, 36.0], [-119.0, 36.0], [-119.0, 37.0], [-120.0, 37.0]]],
            },
        ),
        _vector(
            "malformed_wrong_type",
            geometry={"type": "Point", "coordinates": [-120.0, 37.0]},
        ),
        _vector("circle_valid_50km", circle={"lat": 37.0, "lon": -120.0, "radius_km": 50.0}),
        _vector("circle_valid_min_radius", circle={"lat": 37.0, "lon": -120.0, "radius_km": 1.0}),
        _vector("circle_valid_max_radius", circle={"lat": 37.0, "lon": -120.0, "radius_km": 500.0}),
        _vector(
            "circle_partly_outside_south", circle={"lat": 32.5, "lon": -120.0, "radius_km": 50.0}
        ),
        _vector(
            "circle_radius_below_range", circle={"lat": 37.0, "lon": -120.0, "radius_km": 0.99}
        ),
        _vector(
            "circle_radius_above_range", circle={"lat": 37.0, "lon": -120.0, "radius_km": 500.5}
        ),
        _vector(
            "circle_latitude_out_of_range", circle={"lat": 91.0, "lon": -120.0, "radius_km": 50.0}
        ),
        _vector(
            "circle_longitude_out_of_range", circle={"lat": 37.0, "lon": -181.0, "radius_km": 50.0}
        ),
        _vector("circle_outside_extent", circle={"lat": 50.0, "lon": -120.0, "radius_km": 50.0}),
    ]
    return {
        "description": (
            "Selection validation vectors generated by hotspots.geometry (synthetic shapes, not "
            "NASA data). `expected.reason` is the first failing check. The front-end "
            "geometryPrecheck must reject every polygon vector whose reason is in "
            "`client_precheck_reasons` with that reason, and accept every vector that is valid or "
            "whose reason is not in that list (the server decides those). Circle vectors are for "
            "the circle input form."
        ),
        "extent": {
            "west": EXTENT.west,
            "south": EXTENT.south,
            "east": EXTENT.east,
            "north": EXTENT.north,
        },
        "limits": {
            "max_vertices": g.MAX_VERTICES,
            "min_distinct_vertices": g.MIN_DISTINCT_VERTICES,
            "radius_km": [g.MIN_RADIUS_KM, g.MAX_RADIUS_KM],
            "longitude": [-180, 180],
            "latitude": [-90, 90],
            "zero_area_tolerance_deg2": g.ZERO_AREA_TOLERANCE_DEG2,
            "circle_vertices": g.CIRCLE_VERTICES,
        },
        "reasons": list(g.SELECTION_REASONS),
        "client_precheck_reasons": list(CLIENT_PRECHECK_REASONS),
        "vectors": vectors,
    }


def write_selection_vectors() -> None:
    VECTORS_PATH.parent.mkdir(parents=True, exist_ok=True)
    VECTORS_PATH.write_text(
        json.dumps(build_selection_vectors(), indent=1, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def test_vectors_file_is_current() -> None:
    stored = json.loads(VECTORS_PATH.read_text(encoding="utf-8"))
    assert stored == json.loads(json.dumps(build_selection_vectors()))


@pytest.mark.parametrize(
    ("name", "valid", "reason"),
    [
        ("valid_rectangle", True, None),
        ("valid_triangle", True, None),
        ("valid_polygon_with_hole", True, None),
        ("valid_multipolygon", True, None),
        ("valid_1000_vertices", True, None),
        ("valid_partly_outside_east", True, None),
        ("valid_partly_outside_north", True, None),
        ("too_many_vertices_1001", False, "too_many_vertices"),
        ("too_few_vertices_two_distinct", False, "too_few_vertices"),
        ("too_few_vertices_one_distinct", False, "too_few_vertices"),
        ("zero_area_collinear", False, "zero_area"),
        ("self_intersection_bowtie", False, "self_intersection"),
        ("self_intersection_hole_crosses_shell", False, "self_intersection"),
        ("self_intersection_overlapping_parts", False, "self_intersection"),
        ("coordinate_out_of_range_longitude", False, "coordinate_out_of_range"),
        ("coordinate_out_of_range_latitude", False, "coordinate_out_of_range"),
        ("outside_extent_nevada", False, "outside_extent"),
        ("outside_extent_touches_east_edge_only", False, "outside_extent"),
        ("malformed_ring_not_closed", False, "malformed_geometry"),
        ("malformed_wrong_type", False, "malformed_geometry"),
        ("circle_valid_50km", True, None),
        ("circle_valid_min_radius", True, None),
        ("circle_valid_max_radius", True, None),
        ("circle_partly_outside_south", True, None),
        ("circle_radius_below_range", False, "radius_out_of_range"),
        ("circle_radius_above_range", False, "radius_out_of_range"),
        ("circle_latitude_out_of_range", False, "coordinate_out_of_range"),
        ("circle_longitude_out_of_range", False, "coordinate_out_of_range"),
        ("circle_outside_extent", False, "outside_extent"),
    ],
)
def test_vector_outcomes(name: str, valid: bool, reason: str | None) -> None:
    stored = json.loads(VECTORS_PATH.read_text(encoding="utf-8"))
    by_name = {v["name"]: v for v in stored["vectors"]}
    assert by_name[name]["expected"]["valid"] is valid
    assert by_name[name]["expected"]["reason"] == reason


def test_vectors_cover_every_reason_code() -> None:
    stored = json.loads(VECTORS_PATH.read_text(encoding="utf-8"))
    seen = {v["expected"]["reason"] for v in stored["vectors"]}
    assert seen - {None} == set(g.SELECTION_REASONS)


def test_vector_clipped_percent_for_partial_shapes() -> None:
    stored = json.loads(VECTORS_PATH.read_text(encoding="utf-8"))
    by_name = {v["name"]: v["expected"] for v in stored["vectors"]}
    # East edge at -114.0: 1 of 2 degrees of longitude is outside, so about half is removed.
    assert by_name["valid_partly_outside_east"]["clipped_percent"] == pytest.approx(50.0, abs=0.5)
    assert by_name["valid_partly_outside_north"]["clipped_percent"] == pytest.approx(50.0, abs=0.5)
    assert 0.0 < by_name["circle_partly_outside_south"]["clipped_percent"] < 100.0
    assert by_name["valid_rectangle"]["clipped_percent"] == 0.0


# --- validate_selection ------------------------------------------------------------------


def test_max_vertices_matches_api_schema() -> None:
    assert g.MAX_VERTICES == API_MAX_VERTICES == 1000


def test_reason_codes_are_the_documented_set() -> None:
    assert set(g.SELECTION_REASONS) == {
        "malformed_geometry",
        "too_many_vertices",
        "coordinate_out_of_range",
        "too_few_vertices",
        "zero_area",
        "self_intersection",
        "radius_out_of_range",
        "outside_extent",
    }


def test_valid_polygon_returns_parsed_shape_and_count() -> None:
    result = g.validate_selection(_rect(-121.0, 36.0, -119.0, 38.0), extent=EXTENT)
    assert result.ok
    assert result.issues == ()
    assert result.reason is None
    assert result.error_code is None
    assert result.vertex_count == 5
    assert isinstance(result.polygon, Polygon)


def test_vertex_limit_counts_all_rings_and_parts() -> None:
    result = g.validate_selection(_regular(1001), extent=EXTENT)
    assert result.reason == "too_many_vertices"
    assert result.vertex_count == 1001
    assert "1001" in result.issues[0].message
    assert "1000" in result.issues[0].message
    multi = {
        "type": "MultiPolygon",
        "coordinates": [
            _regular(500)["coordinates"],
            _regular(501, cx=-118.0)["coordinates"],
        ],
    }
    assert g.validate_selection(multi, extent=EXTENT).reason == "too_many_vertices"


def test_non_finite_coordinates_are_out_of_range() -> None:
    bad = _rect(-121.0, 36.0, -119.0, 38.0)
    bad["coordinates"][0][2][0] = float("nan")
    assert g.validate_selection(bad, extent=EXTENT).reason == "coordinate_out_of_range"


def test_non_numeric_position_is_malformed() -> None:
    bad = _rect(-121.0, 36.0, -119.0, 38.0)
    bad["coordinates"][0][1][0] = "x"
    assert g.validate_selection(bad, extent=EXTENT).reason == "malformed_geometry"


def test_messages_do_not_echo_coordinates() -> None:
    result = g.validate_selection(_rect(-181.5, 36.0, -119.0, 38.0), extent=EXTENT)
    assert "181.5" not in result.issues[0].message


def test_outside_extent_maps_to_outside_coverage_and_names_the_extent() -> None:
    result = g.validate_selection(_rect(-110.0, 36.0, -109.0, 37.0), extent=EXTENT)
    assert result.reason == "outside_extent"
    assert result.error_code == "outside_coverage"
    message = result.issues[0].message
    for value in ("-124.4", "32.5", "-114", "42.2"):
        assert value in message
    assert "California region" in message


def test_other_failures_map_to_invalid_geometry() -> None:
    bowtie = g.validate_selection(
        {
            "type": "Polygon",
            "coordinates": [
                [[-120.0, 36.0], [-119.0, 37.0], [-119.0, 36.0], [-120.0, 37.0], [-120.0, 36.0]]
            ],
        },
        extent=EXTENT,
    )
    assert bowtie.error_code == "invalid_geometry"


def test_circle_reports_every_invalid_field() -> None:
    result = g.validate_selection(
        extent=EXTENT, circle=CircleSpec(lat=95.0, lon=-200.0, radius_km=1000.0)
    )
    assert not result.ok
    assert [(i.field, i.reason) for i in result.issues] == [
        ("circle.lat", "coordinate_out_of_range"),
        ("circle.lon", "coordinate_out_of_range"),
        ("circle.radius_km", "radius_out_of_range"),
    ]


def test_circle_radius_bounds_are_inclusive() -> None:
    for radius in (1.0, 500.0):
        outcome = g.validate_selection(
            extent=EXTENT, circle=CircleSpec(lat=37.0, lon=-119.0, radius_km=radius)
        )
        assert outcome.ok, radius


def test_exactly_one_of_geometry_or_circle_is_required() -> None:
    with pytest.raises(ValueError):
        g.validate_selection(extent=EXTENT)
    with pytest.raises(ValueError):
        g.validate_selection(
            _rect(-121.0, 36.0, -119.0, 38.0),
            extent=EXTENT,
            circle=CircleSpec(37.0, -120.0, 10.0),
        )


# --- clip_to_extent ----------------------------------------------------------------------


def test_clip_leaves_inside_shape_unchanged() -> None:
    shape = box(-121.0, 36.0, -119.0, 38.0)
    result = g.clip_to_extent(shape, EXTENT)
    assert result.geometry is shape
    assert not result.clipped
    assert result.clipped_percent == 0.0


def test_clip_removes_part_outside_and_reports_percent() -> None:
    result = g.clip_to_extent(box(-115.0, 36.0, -113.0, 38.0), EXTENT)
    assert result.clipped
    assert isinstance(result.geometry, Polygon)
    assert result.geometry.bounds == (-115.0, 36.0, -114.0, 38.0)
    assert result.clipped_percent == pytest.approx(50.0, abs=0.1)
    assert result.clipped_area_km2 < result.original_area_km2


def test_clip_of_shape_fully_outside_is_empty() -> None:
    result = g.clip_to_extent(box(-110.0, 36.0, -109.0, 37.0), EXTENT)
    assert result.geometry is None
    assert result.clipped
    assert result.clipped_percent == 100.0


def test_clip_keeps_multipolygon_parts_inside() -> None:
    multi = MultiPolygon([box(-121.0, 36.0, -120.0, 37.0), box(-115.0, 36.0, -113.0, 37.0)])
    result = g.clip_to_extent(multi, EXTENT)
    assert isinstance(result.geometry, MultiPolygon)
    assert len(result.geometry.geoms) == 2
    assert 0.0 < result.clipped_percent < 100.0


# --- circle and area ---------------------------------------------------------------------


@pytest.mark.parametrize(("lat", "radius"), [(37.0, 1.0), (33.0, 50.0), (41.5, 500.0)])
def test_circle_has_64_vertices_at_the_given_geodesic_radius(lat: float, radius: float) -> None:
    lon = -120.0
    polygon = g.circle_polygon(lat, lon, radius)
    coords = list(polygon.exterior.coords)
    assert len(coords) == g.CIRCLE_VERTICES + 1
    assert coords[0] == coords[-1]
    assert len(set(coords)) == g.CIRCLE_VERTICES
    for vlon, vlat in coords:
        assert g.haversine_km(lat, lon, vlat, vlon) == pytest.approx(radius, rel=0.005)
    assert polygon.exterior.is_ccw


def test_circle_area_is_close_to_the_spherical_cap() -> None:
    radius = 100.0
    polygon = g.circle_polygon(37.0, -120.0, radius)
    cap = 2 * math.pi * g.EARTH_RADIUS_KM**2 * (1 - math.cos(radius / g.EARTH_RADIUS_KM))
    # a 64-gon holds sin(2 pi / 64) * 32 / pi = 99.84 % of the circle
    assert g.geodesic_area_km2(polygon) == pytest.approx(cap * 0.9984, rel=0.01)


def test_circle_rejects_out_of_range_inputs() -> None:
    with pytest.raises(ValueError):
        g.circle_polygon(37.0, -120.0, 0.5)
    with pytest.raises(ValueError):
        g.circle_polygon(95.0, -120.0, 10.0)


def test_geodesic_area_of_a_parallel_meridian_cell_is_exact() -> None:
    south, north, west, east = 37.0, 37.1, -120.0, -119.9
    expected = (
        g.EARTH_RADIUS_KM**2
        * math.radians(east - west)
        * (math.sin(math.radians(north)) - math.sin(math.radians(south)))
    )
    assert g.geodesic_area_km2(box(west, south, east, north)) == pytest.approx(expected, rel=1e-9)
    assert 90.0 < expected < 100.0  # roughly 8.9 km by 11.1 km


def test_geodesic_area_subtracts_holes_and_sums_parts() -> None:
    outer = [(-121.0, 36.0), (-119.0, 36.0), (-119.0, 38.0), (-121.0, 38.0)]
    hole = [(-120.5, 36.5), (-120.5, 37.5), (-119.5, 37.5), (-119.5, 36.5)]
    full = g.geodesic_area_km2(Polygon(outer))
    with_hole = g.geodesic_area_km2(Polygon(outer, [hole]))
    assert with_hole == pytest.approx(full - g.geodesic_area_km2(Polygon(hole)))
    two = MultiPolygon([box(-121, 36, -120, 37), box(-119, 36, -118, 37)])
    assert g.geodesic_area_km2(two) == pytest.approx(
        g.geodesic_area_km2(box(-121, 36, -120, 37)) + g.geodesic_area_km2(box(-119, 36, -118, 37))
    )


def test_geodesic_area_does_not_depend_on_vertex_order() -> None:
    cw = Polygon([(-121.0, 36.0), (-121.0, 38.0), (-119.0, 38.0), (-119.0, 36.0)])
    ccw = Polygon([(-121.0, 36.0), (-119.0, 36.0), (-119.0, 38.0), (-121.0, 38.0)])
    assert g.geodesic_area_km2(cw) == pytest.approx(g.geodesic_area_km2(ccw))


def test_to_geojson_round_trips_through_validation() -> None:
    polygon = g.circle_polygon(37.0, -120.0, 25.0)
    geojson = g.to_geojson(polygon, ndigits=6)
    assert geojson["type"] == "Polygon"
    assert all(isinstance(p, list) for p in geojson["coordinates"][0])
    assert g.validate_selection(geojson, extent=EXTENT).ok

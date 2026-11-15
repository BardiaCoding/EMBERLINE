"""Unit tests for `POST /api/v1/selection/normalize` (task 18.6).

Requirements 9.1, 13.1 to 13.7, 29.4. Data are synthetic (`tests/fixtures.py`, TEST FIXTURE, not
NASA data). Cells in the default fixture: A (34.0, -118.1), B (34.1, -118.1), C (37.5, -120.5),
D (32.5, -114.6). Cell centres are at +0.05 degree.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient

from hotspots.api.main import create_app
from tests.fixtures import default_grid_rows, write_fixture_dir

PROJECT_CONFIG = Path(__file__).resolve().parents[2] / "config" / "app.yaml"
URL = "/api/v1/selection/normalize"


def _rect(west: float, south: float, east: float, north: float) -> dict[str, Any]:
    return {
        "type": "Polygon",
        "coordinates": [
            [[west, south], [east, south], [east, north], [west, north], [west, south]]
        ],
    }


AREA_A = _rect(-118.2, 34.0, -118.0, 34.1)
"""Contains only the centre of cell A (34.05, -118.05)."""
EMPTY_AREA = _rect(-120.0, 36.0, -119.9, 36.05)
"""Inside the region extent, no cell centre."""
BBOX_A = {"west": -118.2, "south": 34.0, "east": -118.0, "north": 34.1}
BBOX_FULL = {"west": -124.4, "south": 32.5, "east": -114.0, "north": 42.2}
BOWTIE = {
    "type": "Polygon",
    "coordinates": [[[-118, 34], [-117, 35], [-117, 34], [-118, 35], [-118, 34]]],
}


def _config(tmp_path: Path, data_dir: Path) -> Path:
    raw = yaml.safe_load(PROJECT_CONFIG.read_text(encoding="utf-8"))
    raw["data_dir"] = str(data_dir)
    path = tmp_path / "app.yaml"
    path.write_text(yaml.safe_dump(raw), encoding="utf-8")
    return path


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    data_dir = write_fixture_dir(tmp_path, default_grid_rows())
    with TestClient(create_app(_config(tmp_path, data_dir))) as c:
        yield c


def test_polygon_inside_the_region_is_not_clipped(client: TestClient) -> None:
    response = client.post(URL, json={"geometry": AREA_A})
    assert response.status_code == 200
    body = response.json()
    assert body["clipped"] is False
    assert body["clipped_percent"] == 0.0
    assert body["n_cells"] == 1
    assert body["notice"] is None
    assert body["geometry"]["type"] == "Polygon"
    assert body["geometry"]["coordinates"] == AREA_A["coordinates"]


def test_bbox_gives_the_same_area_as_the_equal_polygon(client: TestClient) -> None:
    from_bbox = client.post(URL, json={"bbox": BBOX_A}).json()
    from_polygon = client.post(URL, json={"geometry": AREA_A}).json()
    assert from_bbox["n_cells"] == from_polygon["n_cells"] == 1
    assert from_bbox["clipped_percent"] == 0.0
    assert {tuple(p) for p in from_bbox["geometry"]["coordinates"][0]} == {
        tuple(p) for p in from_polygon["geometry"]["coordinates"][0]
    }


def test_full_extent_selects_every_cell_without_clipping(client: TestClient) -> None:
    body = client.post(URL, json={"bbox": BBOX_FULL}).json()
    assert body["n_cells"] == 4
    assert body["clipped"] is False
    assert body["clipped_percent"] == 0.0


def test_partly_outside_is_clipped_and_reports_the_removed_share(client: TestClient) -> None:
    body = client.post(URL, json={"bbox": {**BBOX_A, "west": -128.4}}).json()
    assert body["clipped"] is True
    # 4.0 of 10.4 degrees of longitude lie west of the extent: 38.5 % of the area.
    assert body["clipped_percent"] == pytest.approx(38.5, abs=0.1)
    longitudes = [p[0] for p in body["geometry"]["coordinates"][0]]
    assert min(longitudes) == pytest.approx(-124.4)
    assert body["n_cells"] == 1


def test_selection_without_a_cell_centre_is_accepted_with_a_notice(client: TestClient) -> None:
    response = client.post(URL, json={"geometry": EMPTY_AREA})
    assert response.status_code == 200
    body = response.json()
    assert body["n_cells"] == 0
    assert body["notice"] == "no_cells"


def test_multipolygon_counts_cells_of_every_part(client: TestClient) -> None:
    multi = {
        "type": "MultiPolygon",
        "coordinates": [
            [_rect(-118.2, 34.0, -118.0, 34.1)["coordinates"][0]],
            [_rect(-120.6, 37.5, -120.4, 37.6)["coordinates"][0]],
        ],
    }
    body = client.post(URL, json={"geometry": multi}).json()
    assert body["n_cells"] == 2
    assert body["geometry"]["type"] == "MultiPolygon"


def test_coordinates_are_rounded_to_six_decimals(client: TestClient) -> None:
    body = client.post(URL, json={"geometry": _rect(-118.2000004, 34.0, -118.0, 34.1)}).json()
    assert [-118.2, 34.0] in body["geometry"]["coordinates"][0]


@pytest.mark.parametrize(
    ("payload", "field"),
    [
        ({"geometry": _rect(0.0, 0.0, 1.0, 1.0)}, "geometry"),
        ({"bbox": {"west": 0.0, "south": 0.0, "east": 1.0, "north": 1.0}}, "bbox"),
    ],
)
def test_entirely_outside_the_extent_is_outside_coverage(
    client: TestClient, payload: dict[str, Any], field: str
) -> None:
    response = client.post(URL, json=payload)
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "outside_coverage"
    assert error["fields"] == [{"field": field, "reason": "outside_extent"}]
    assert error["request_id"]


def test_invalid_polygon_is_422_with_the_reason(client: TestClient) -> None:
    response = client.post(URL, json={"geometry": BOWTIE})
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "invalid_geometry"
    assert error["fields"] == [{"field": "geometry", "reason": "self_intersection"}]


@pytest.mark.parametrize(
    ("bbox", "fields"),
    [
        (
            {"west": -118.0, "south": 34.0, "east": -118.2, "north": 34.1},
            [("bbox.west", "west_not_less_than_east"), ("bbox.east", "west_not_less_than_east")],
        ),
        (
            {"west": -118.2, "south": 34.1, "east": -118.0, "north": 34.1},
            [
                ("bbox.south", "south_not_less_than_north"),
                ("bbox.north", "south_not_less_than_north"),
            ],
        ),
        (
            {"west": -181.0, "south": 34.0, "east": -118.0, "north": 91.0},
            [
                ("bbox.west", "coordinate_out_of_range"),
                ("bbox.north", "coordinate_out_of_range"),
            ],
        ),
    ],
)
def test_invalid_bbox_names_each_field(
    client: TestClient, bbox: dict[str, float], fields: list[tuple[str, str]]
) -> None:
    response = client.post(URL, json={"bbox": bbox})
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "invalid_geometry"
    assert {(f["field"], f["reason"]) for f in error["fields"]} == set(fields)


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"geometry": AREA_A, "bbox": BBOX_A},
        {"bbox": {**BBOX_A, "extra": 1}},
        {"bbox": {"west": "-118'; DROP TABLE x;--", "south": 34, "east": -118, "north": 35}},
        {"bbox": BBOX_A, "circle": {"lat": 34, "lon": -118, "radius_km": 5}},
    ],
)
def test_malformed_bodies_are_422_without_echoing_input(
    client: TestClient, body: dict[str, Any]
) -> None:
    response = client.post(URL, json=body)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
    assert "DROP TABLE" not in response.text


def test_503_without_data(tmp_path: Path) -> None:
    config = _config(tmp_path, tmp_path / "missing")
    with TestClient(create_app(config)) as c:
        response = c.post(URL, json={"bbox": BBOX_A})
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "data_unavailable"


# --- circle and GeoJSON (task 23.1) ------------------------------------------------------


def _feature(geometry: dict[str, Any] | None) -> dict[str, Any]:
    return {"type": "Feature", "properties": {}, "geometry": geometry}


def _error_fields(response: Any) -> set[tuple[str, str]]:
    return {(f["field"], f["reason"]) for f in response.json()["error"]["fields"]}


def test_circle_gives_a_64_vertex_polygon_and_counts_cells(client: TestClient) -> None:
    response = client.post(URL, json={"circle": {"lat": 34.05, "lon": -118.05, "radius_km": 5}})
    assert response.status_code == 200
    body = response.json()
    assert len(body["geometry"]["coordinates"][0]) == 65
    assert body["n_cells"] == 1
    assert body["clipped"] is False
    assert body["ignored_features"] == 0


@pytest.mark.parametrize(
    ("circle", "fields"),
    [
        (
            {"lat": 34.0, "lon": -118.0, "radius_km": 0.5},
            {("circle.radius_km", "radius_out_of_range")},
        ),
        (
            {"lat": 34.0, "lon": -118.0, "radius_km": 501},
            {("circle.radius_km", "radius_out_of_range")},
        ),
        ({"lat": 95.0, "lon": -118.0, "radius_km": 5}, {("circle.lat", "coordinate_out_of_range")}),
        ({"lat": 34.0, "lon": -200.0, "radius_km": 5}, {("circle.lon", "coordinate_out_of_range")}),
        ({"lat": 10.0, "lon": 10.0, "radius_km": 5}, {("circle", "outside_extent")}),
    ],
)
def test_invalid_circle_is_422_with_a_reason_per_field(
    client: TestClient, circle: dict[str, float], fields: set[tuple[str, str]]
) -> None:
    response = client.post(URL, json={"circle": circle})
    assert response.status_code == 422
    assert _error_fields(response) == fields


def test_circle_on_the_edge_is_clipped(client: TestClient) -> None:
    body = client.post(URL, json={"circle": {"lat": 32.5, "lon": -114.6, "radius_km": 30}}).json()
    assert body["clipped"] is True
    assert 0 < body["clipped_percent"] < 100


def test_geojson_feature_collection_unions_polygons_and_counts_ignored(
    client: TestClient,
) -> None:
    point = {"type": "Point", "coordinates": [-118.1, 34.0]}
    collection = {
        "type": "FeatureCollection",
        "features": [
            _feature(AREA_A),
            _feature(_rect(-118.2, 34.1, -118.0, 34.2)),  # cell B centre, touches A
            _feature(point),
            _feature(None),
        ],
    }
    body = client.post(URL, json={"geojson": collection}).json()
    assert body["n_cells"] == 2
    assert body["ignored_features"] == 2
    assert body["geometry"]["type"] == "Polygon"


def test_geojson_feature_and_bare_geometry_are_accepted(client: TestClient) -> None:
    for content in (_feature(AREA_A), AREA_A):
        body = client.post(URL, json={"geojson": content}).json()
        assert body["n_cells"] == 1
        assert body["ignored_features"] == 0


@pytest.mark.parametrize(
    ("content", "reason"),
    [
        (
            {
                "type": "FeatureCollection",
                "features": [_feature({"type": "Point", "coordinates": [0, 0]})],
            },
            "no_polygon_features",
        ),
        ({"type": "FeatureCollection", "features": []}, "no_polygon_features"),
        ({"type": "Topology"}, "malformed_geojson"),
        ({"type": "FeatureCollection"}, "malformed_geojson"),
        ({"type": "Feature", "geometry": BOWTIE}, "self_intersection"),
        ({"type": "Feature", "geometry": _rect(-80, 10, -79, 11)}, "outside_extent"),
    ],
)
def test_invalid_geojson_is_422_on_the_geojson_field(
    client: TestClient, content: dict[str, Any], reason: str
) -> None:
    response = client.post(URL, json={"geojson": content})
    assert response.status_code == 422
    assert _error_fields(response) == {("geojson", reason)}


def test_geojson_over_5_mb_is_rejected(client: TestClient) -> None:
    padding = "x" * (5 * 1024 * 1024)
    content = {"type": "Feature", "properties": {"p": padding}, "geometry": AREA_A}
    response = client.post(URL, json={"geojson": content})
    assert response.status_code == 422
    assert _error_fields(response) == {("geojson", "file_too_large")}


def test_geojson_vertex_limit_counts_all_polygons(client: TestClient) -> None:
    features = [
        _feature(_rect(-118.2 + i * 0.001, 34.0, -118.19 + i * 0.001, 34.1)) for i in range(201)
    ]
    response = client.post(
        URL, json={"geojson": {"type": "FeatureCollection", "features": features}}
    )
    assert response.status_code == 422
    assert _error_fields(response) == {("geojson", "too_many_vertices")}

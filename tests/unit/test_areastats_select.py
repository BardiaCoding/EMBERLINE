"""Example tests for cell selection with the half-open boundary rule (task 7.3)."""

from __future__ import annotations

import numpy as np
from shapely.geometry import MultiPolygon, Polygon, box

from hotspots.areastats import select_cells


def _grid() -> tuple[np.ndarray, np.ndarray]:
    lats, lons = np.meshgrid(np.arange(0.0, 5.0, 0.5), np.arange(0.0, 5.0, 0.5))
    return lats.ravel(), lons.ravel()


def test_rectangle_is_half_open_west_south_inclusive() -> None:
    west, south, east, north = 1.0, 1.0, 3.0, 3.0
    lat, lon = _grid()
    got = select_cells(lat, lon, box(west, south, east, north))
    expected = (lon >= west) & (lon < east) & (lat >= south) & (lat < north)
    assert np.array_equal(got, expected)


def test_strictly_inside_and_outside() -> None:
    poly = box(0, 0, 2, 2)
    got = select_cells(np.array([1.0, 5.0]), np.array([1.0, 5.0]), poly)
    assert got.tolist() == [True, False]


def test_vertex_decided_by_north_east_perturbation() -> None:
    poly = box(0, 0, 2, 2)
    lat = np.array([0.0, 0.0, 2.0, 2.0])
    lon = np.array([0.0, 2.0, 0.0, 2.0])
    # Only the south-west vertex has the north-east perturbation inside.
    assert select_cells(lat, lon, poly).tolist() == [True, False, False, False]


def test_adjacent_rectangles_select_shared_edge_once() -> None:
    left, right = box(0, 0, 2, 2), box(2, 0, 4, 2)
    lower, upper = box(0, 0, 4, 2), box(0, 2, 4, 4)
    # Centres on the shared vertical edge (lon = 2) and horizontal edge (lat = 2).
    lat = np.array([0.5, 1.0, 1.5, 2.0, 2.0, 2.0])
    lon = np.array([2.0, 2.0, 2.0, 0.5, 2.0, 3.5])
    a, b = select_cells(lat, lon, left), select_cells(lat, lon, right)
    assert not (a & b).any()
    c, d = select_cells(lat, lon, lower), select_cells(lat, lon, upper)
    assert not (c & d).any()
    whole = select_cells(lat, lon, box(0, 0, 4, 4))
    assert np.array_equal(c | d, whole)
    # Vertical edge centres belong to the right (north-east) part only.
    assert b[:3].all() and not a[:3].any()


def test_union_of_parts_equals_whole() -> None:
    lat, lon = _grid()
    parts = [box(0, 0, 2, 5), box(2, 0, 5, 5)]
    union = np.zeros(lat.shape, dtype=bool)
    for part in parts:
        union |= select_cells(lat, lon, part)
    assert np.array_equal(union, select_cells(lat, lon, box(0, 0, 5, 5)))


def test_non_rectangular_polygon_edge() -> None:
    triangle = Polygon([(0, 0), (4, 0), (0, 4)])
    # (2, 2) lies on the hypotenuse; the north-east shift leaves the triangle.
    got = select_cells(np.array([2.0]), np.array([2.0]), triangle)
    assert got.tolist() == [False]
    # (1, 1) is strictly inside.
    assert select_cells(np.array([1.0]), np.array([1.0]), triangle).tolist() == [True]


def test_multipolygon() -> None:
    multi = MultiPolygon([box(0, 0, 1, 1), box(3, 3, 4, 4)])
    lat = np.array([0.5, 2.0, 3.5])
    lon = np.array([0.5, 2.0, 3.5])
    assert select_cells(lat, lon, multi).tolist() == [True, False, True]


def test_excluded_cells_never_selected() -> None:
    poly = box(0, 0, 4, 4)
    lat = np.array([1.0, 2.0, 0.0, 3.0])  # includes a boundary centre (0, 0)
    lon = np.array([1.0, 2.0, 0.0, 3.0])
    excluded = np.array([True, False, True, False])
    got = select_cells(lat, lon, poly, excluded)
    assert got.tolist() == [False, True, False, True]


def test_empty_input() -> None:
    got = select_cells(np.array([]), np.array([]), box(0, 0, 1, 1))
    assert got.shape == (0,) and got.dtype == np.bool_

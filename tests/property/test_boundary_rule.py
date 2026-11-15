# Feature: harmonized-fire-calendar, Property 57: Cell selection boundary rule
"""Property 57: for any polygon and any set of cell centres, a centre strictly inside is
selected, a centre strictly outside is not, excluded cells are never selected, and selection
depends only on the centre point (not on `disp_lat` or `disp_lon` float noise at the 1e-12
level). A centre exactly on an edge or vertex is decided by the north-east perturbation
`(lon + 1e-9, lat + 1e-12)` (design section 8.1). For two rectangles that share an edge, a
centre on the shared edge is selected exactly once.

The expected values come from an exact oracle (`fractions.Fraction`, crossing number), not from
shapely. Geometry is synthetic (not NASA data).

**Validates: Requirements 9.7**
"""

from __future__ import annotations

from fractions import Fraction

import numpy as np
from hypothesis import given
from hypothesis import strategies as st
from shapely.geometry import Polygon, box

from hotspots.areastats import BOUNDARY_SHIFT_LAT, BOUNDARY_SHIFT_LON, select_cells
from tests.fixtures import cell_coords
from tests.property.strategies.geometry import (
    ORIGIN_LAT,
    ORIGIN_LON,
    lat_at,
    lattice_index,
    lattice_points,
    lon_at,
    points_on,
    polygons,
    rectangles,
)

Ring = list[tuple[Fraction, Fraction]]

SHIFT_LON = Fraction(BOUNDARY_SHIFT_LON)
SHIFT_LAT = Fraction(BOUNDARY_SHIFT_LAT)


def _ring(polygon: Polygon) -> Ring:
    """Exterior ring with exact rational coordinates (floats convert without loss)."""
    return [(Fraction(x), Fraction(y)) for x, y in list(polygon.exterior.coords)[:-1]]


def _on_boundary(ring: Ring, px: Fraction, py: Fraction) -> bool:
    for i, (x0, y0) in enumerate(ring):
        x1, y1 = ring[(i + 1) % len(ring)]
        cross = (x1 - x0) * (py - y0) - (y1 - y0) * (px - x0)
        if cross == 0 and min(x0, x1) <= px <= max(x0, x1) and min(y0, y1) <= py <= max(y0, y1):
            return True
    return False


def _crossing_inside(ring: Ring, px: Fraction, py: Fraction) -> bool:
    """Crossing-number test, valid for a point that is not on the boundary."""
    inside = False
    for i, (x0, y0) in enumerate(ring):
        x1, y1 = ring[(i + 1) % len(ring)]
        if (y0 > py) != (y1 > py) and px < x0 + (py - y0) * (x1 - x0) / (y1 - y0):
            inside = not inside
    return inside


def classify(ring: Ring, lon: float, lat: float) -> str:
    """Return `inside`, `outside` or `boundary` for an exact point."""
    px, py = Fraction(lon), Fraction(lat)
    if _on_boundary(ring, px, py):
        return "boundary"
    return "inside" if _crossing_inside(ring, px, py) else "outside"


def expected_selected(ring: Ring, lon: float, lat: float) -> bool:
    """The design 8.1 rule: strict inside, else boundary decided by the perturbed point."""
    kind = classify(ring, lon, lat)
    if kind != "boundary":
        return kind == "inside"
    px, py = Fraction(lon) + SHIFT_LON, Fraction(lat) + SHIFT_LAT
    assert not _on_boundary(ring, px, py), "perturbed point must not be on the boundary"
    return _crossing_inside(ring, px, py)


def _select(polygon: Polygon, points: list[tuple[float, float]]) -> np.ndarray:
    lon = np.array([p[0] for p in points])
    lat = np.array([p[1] for p in points])
    return select_cells(lat, lon, polygon)


@st.composite
def polygon_with_points(draw: st.DrawFn) -> tuple[Polygon, list[tuple[float, float]]]:
    """A polygon plus half-step lattice points (inside, outside) and points on its boundary."""
    polygon = draw(polygons())
    points = draw(
        st.lists(
            st.one_of(lattice_points(polygon), points_on(polygon)),
            min_size=1,
            max_size=40,
        )
    )
    return polygon, points


@given(case=polygon_with_points())
def test_inside_selected_outside_not_boundary_by_perturbation(
    case: tuple[Polygon, list[tuple[float, float]]],
) -> None:
    polygon, points = case
    ring = _ring(polygon)
    selected = _select(polygon, points)
    for (lon, lat), got in zip(points, selected, strict=True):
        kind = classify(ring, lon, lat)
        if kind == "inside":
            assert got, f"strictly inside point ({lon}, {lat}) not selected"
        elif kind == "outside":
            assert not got, f"strictly outside point ({lon}, {lat}) selected"
        else:
            assert bool(got) == expected_selected(ring, lon, lat), (
                f"boundary point ({lon}, {lat}) decided wrongly"
            )


@given(polygon=polygons(), data=st.data())
def test_boundary_points_are_decided_and_vertices_follow_the_rule(
    polygon: Polygon, data: st.DataObject
) -> None:
    boundary = data.draw(st.lists(points_on(polygon), min_size=1, max_size=20))
    ring = _ring(polygon)
    assert all(classify(ring, lon, lat) == "boundary" for lon, lat in boundary)
    selected = _select(polygon, boundary)
    expected = [expected_selected(ring, lon, lat) for lon, lat in boundary]
    assert selected.tolist() == expected


@given(case=polygon_with_points(), data=st.data())
def test_excluded_cells_are_never_selected(
    case: tuple[Polygon, list[tuple[float, float]]], data: st.DataObject
) -> None:
    polygon, points = case
    excluded = data.draw(st.lists(st.booleans(), min_size=len(points), max_size=len(points)))
    lon = np.array([p[0] for p in points])
    lat = np.array([p[1] for p in points])
    base = select_cells(lat, lon, polygon)
    masked = select_cells(lat, lon, polygon, excluded_mask=np.array(excluded))
    assert not (masked & np.array(excluded)).any()
    assert masked.tolist() == (base & ~np.array(excluded)).tolist()


@given(rect=rectangles(), data=st.data())
def test_shared_edge_centre_is_selected_exactly_once(rect: Polygon, data: st.DataObject) -> None:
    west, south, east, north = rect.bounds
    wi, si = lattice_index(west, ORIGIN_LON), lattice_index(south, ORIGIN_LAT)
    ei, ni = lattice_index(east, ORIGIN_LON), lattice_index(north, ORIGIN_LAT)
    vertical = data.draw(st.booleans())
    lo, hi = (wi, ei) if vertical else (si, ni)
    # Split line strictly between the two sides, on the half-step lattice.
    split = data.draw(st.integers(min_value=2 * lo + 1, max_value=2 * hi - 1)) / 2
    if vertical:
        first = box(west, south, lon_at(split), north)
        second = box(lon_at(split), south, east, north)
        steps = range(2 * si + 1, 2 * ni)
        centres = [(lon_at(split), lat_at(h / 2)) for h in steps]
    else:
        first = box(west, south, east, lat_at(split))
        second = box(west, lat_at(split), east, north)
        steps = range(2 * wi + 1, 2 * ei)
        centres = [(lon_at(h / 2), lat_at(split)) for h in steps]
    chosen = data.draw(st.lists(st.sampled_from(centres), min_size=1, max_size=10))

    in_first = _select(first, chosen)
    in_second = _select(second, chosen)
    in_whole = _select(rect, chosen)
    assert (in_first.astype(int) + in_second.astype(int)).tolist() == [1] * len(chosen)
    assert in_whole.all()
    # The part lying north-east of the shared edge owns it.
    assert in_second.all()
    assert not in_first.any()


@given(
    west=st.integers(min_value=-2488, max_value=-2290),
    south=st.integers(min_value=650, max_value=840),
    width=st.integers(min_value=1, max_value=8),
    height=st.integers(min_value=1, max_value=8),
    data=st.data(),
)
def test_grid_rectangle_is_half_open_and_ignores_disp_float_noise(
    west: int, south: int, width: int, height: int, data: st.DataObject
) -> None:
    """Rectangle edges at multiples of 0.05 degree against real 0.1 degree cell centres.

    Edges are `i * 0.05` in units of 0.05 degree, so `west <= centre < east` and
    `south <= centre < north` in those units is the half-open rule `[west, east) x [south, north)`.
    """
    east, north = west + width, south + height
    rect = box(
        round(west * 0.05, 6), round(south * 0.05, 6), round(east * 0.05, 6), round(north * 0.05, 6)
    )
    # Cells whose centres (odd multiples of 0.05) fall in and around the rectangle.
    lat_idx = data.draw(
        st.lists(st.integers(min_value=(south - 2) // 2, max_value=(north + 2) // 2), min_size=1)
    )
    lon_idx = data.draw(
        st.lists(
            st.integers(min_value=(west - 2) // 2, max_value=(east + 2) // 2),
            min_size=len(lat_idx),
            max_size=len(lat_idx),
        )
    )
    noise = data.draw(
        st.lists(
            st.floats(min_value=-1e-12, max_value=1e-12),
            min_size=len(lat_idx),
            max_size=len(lat_idx),
        )
    )
    disp = [cell_coords(la, lo)[1:] for la, lo in zip(lat_idx, lon_idx, strict=True)]
    disp_lat = np.array([d[0] for d in disp])
    disp_lon = np.array([d[1] for d in disp])
    noisy_lat = disp_lat + np.array(noise)
    noisy_lon = disp_lon - np.array(noise)

    def centres(values: np.ndarray) -> np.ndarray:
        return np.round(values + 0.05, 6)

    clean = select_cells(centres(disp_lat), centres(disp_lon), rect)
    noisy = select_cells(centres(noisy_lat), centres(noisy_lon), rect)
    assert clean.tolist() == noisy.tolist()

    expected = [
        west <= 2 * lo + 1 < east and south <= 2 * la + 1 < north
        for la, lo in zip(lat_idx, lon_idx, strict=True)
    ]
    assert clean.tolist() == expected


def test_rectangle_corners_follow_half_open_rule() -> None:
    """Example: of the four corners of a rectangle only the south-west one is selected."""
    rect = box(0.0, 0.0, 1.0, 1.0)
    lat = np.array([0.0, 0.0, 1.0, 1.0])
    lon = np.array([0.0, 1.0, 0.0, 1.0])  # SW, SE, NW, NE
    assert select_cells(lat, lon, rect).tolist() == [True, False, False, False]

"""Unit tests for the selection mask cache (task 17.2; Requirements 9.3, 28.1).

Cell centres here are synthetic (a small 0.1 degree grid), not delivered data.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pytest
from shapely.geometry import MultiPolygon, Polygon
from shapely.geometry import box as shapely_box

from hotspots.areastats import select_cells
from hotspots.config import Extent
from hotspots.selection import (
    CACHE_SIZE,
    SelectionMaskCache,
    canonical_coordinates,
    canonical_key,
)

EXTENT = Extent(west=-120.0, south=35.0, east=-119.0, north=36.0)


def _centres() -> tuple[np.ndarray, np.ndarray]:
    lats = np.round(35.0 + 0.05 + 0.1 * np.arange(10), 6)
    lons = np.round(-120.0 + 0.05 + 0.1 * np.arange(10), 6)
    lat, lon = np.meshgrid(lats, lons, indexing="ij")
    return lat.ravel(), lon.ravel()


@pytest.fixture
def cache() -> SelectionMaskCache:
    lat, lon = _centres()
    return SelectionMaskCache(lat, lon, EXTENT)


def _square(i: int) -> Polygon:
    """Distinct small squares: a different key for each `i`."""
    west = -119.9 + 0.00001 * i
    return shapely_box(west, 35.2, west + 0.4, 35.6)


def test_miss_then_hit_returns_same_readonly_mask(cache: SelectionMaskCache) -> None:
    poly = shapely_box(-119.78, 35.18, -119.42, 35.52)
    first = cache.get_mask(poly)
    second = cache.get_mask(poly)
    assert first is second
    assert first.dtype == np.bool_
    assert not first.flags.writeable
    info = cache.cache_info()
    assert (info.hits, info.misses, info.size, info.maxsize) == (1, 1, 1, CACHE_SIZE)
    with pytest.raises(ValueError):
        first[0] = True


def test_default_size_is_64() -> None:
    assert CACHE_SIZE == 64


def test_evicts_least_recently_used_at_64(cache: SelectionMaskCache) -> None:
    polys = [_square(i) for i in range(CACHE_SIZE)]
    masks = [cache.get_mask(p) for p in polys]
    assert len(cache) == CACHE_SIZE
    cache.get_mask(polys[0])  # refresh the oldest entry; polys[1] becomes the oldest
    cache.get_mask(_square(CACHE_SIZE))  # 65th key evicts polys[1]
    assert len(cache) == CACHE_SIZE
    misses = cache.cache_info().misses
    assert cache.get_mask(polys[0]) is masks[0]  # still cached
    assert cache.cache_info().misses == misses
    cache.get_mask(polys[1])  # evicted, recomputed
    assert cache.cache_info().misses == misses + 1


def test_equals_select_cells(cache: SelectionMaskCache) -> None:
    lat, lon = _centres()
    triangle = Polygon([(-119.9, 35.1), (-119.2, 35.1), (-119.55, 35.9), (-119.9, 35.1)])
    ring_with_hole = Polygon(
        [(-119.95, 35.05), (-119.05, 35.05), (-119.05, 35.95), (-119.95, 35.95)],
        [[(-119.65, 35.35), (-119.35, 35.35), (-119.35, 35.65), (-119.65, 35.65)]],
    )
    parts = MultiPolygon(
        [shapely_box(-119.95, 35.0, -119.7, 35.3), shapely_box(-119.4, 35.6, -119.1, 35.9)]
    )
    on_centres = shapely_box(-119.85, 35.15, -119.45, 35.55)  # edges pass through centres
    for geometry in (triangle, ring_with_hole, parts, on_centres):
        expected = select_cells(lat, lon, geometry)
        assert expected.any()
        np.testing.assert_array_equal(cache.get_mask(geometry), expected)


def test_full_extent_fast_path(cache: SelectionMaskCache) -> None:
    lat, lon = _centres()
    bigger = shapely_box(-121.0, 34.0, -118.0, 37.0)
    mask = cache.get_mask(bigger)
    assert mask.all()
    np.testing.assert_array_equal(mask, select_cells(lat, lon, bigger))
    assert cache.cache_info().fast_path == 1
    # Exactly the extent rectangle also covers it.
    assert cache.get_mask(shapely_box(-120.0, 35.0, -119.0, 36.0)).all()
    assert cache.cache_info().fast_path == 2


def test_fast_path_not_used_when_extent_is_not_covered(cache: SelectionMaskCache) -> None:
    lat, lon = _centres()
    almost = shapely_box(-120.0, 35.0, -119.0, 35.95)  # misses the top row of centres (35.95)
    with_hole = Polygon(
        [(-121.0, 34.0), (-118.0, 34.0), (-118.0, 37.0), (-121.0, 37.0)],
        [[(-119.6, 35.4), (-119.4, 35.4), (-119.4, 35.6), (-119.6, 35.6)]],
    )
    for geometry in (almost, with_hole):
        mask = cache.get_mask(geometry)
        assert not mask.all()
        np.testing.assert_array_equal(mask, select_cells(lat, lon, geometry))
    assert cache.cache_info().fast_path == 0


def test_fast_path_disabled_when_a_centre_is_on_the_extent_edge() -> None:
    lat = np.array([35.0, 35.5])  # first centre lies on the south edge
    lon = np.array([-119.5, -119.5])
    cache = SelectionMaskCache(lat, lon, EXTENT)
    bigger = shapely_box(-121.0, 34.0, -118.0, 37.0)
    np.testing.assert_array_equal(cache.get_mask(bigger), select_cells(lat, lon, bigger))
    assert cache.cache_info().fast_path == 0


def test_canonical_key_stable_for_equivalent_inputs() -> None:
    base = Polygon([(-119.9, 35.1), (-119.2, 35.1), (-119.55, 35.9), (-119.9, 35.1)])
    start = (-119.9 + 4e-8, 35.1 - 4e-8)
    noisy = Polygon([start, (-119.2, 35.1 + 3e-8), (-119.55, 35.9), start])
    assert canonical_key(base) == canonical_key(noisy)
    assert canonical_key(base) == canonical_key(Polygon(base.exterior.coords))
    assert len(canonical_key(base)) == 64


def test_canonical_key_differs_for_different_inputs() -> None:
    a = shapely_box(-119.9, 35.1, -119.5, 35.5)
    assert canonical_key(a) != canonical_key(shapely_box(-119.9, 35.1, -119.5, 35.500002))
    reordered = Polygon(list(a.exterior.coords)[1:] + [list(a.exterior.coords)[1]])
    assert canonical_key(a) != canonical_key(reordered)  # ring order is not normalised
    assert canonical_key(a) != canonical_key(MultiPolygon([a]))


def test_canonical_rounds_to_six_decimals_and_clears_negative_zero() -> None:
    poly = Polygon([(-1e-9, 0.0), (1.2345674, 0.0), (0.0, 1.2345676), (-1e-9, 0.0)])
    coords = canonical_coordinates(poly)["coordinates"][0]
    assert coords == [[0.0, 0.0], [1.234567, 0.0], [0.0, 1.234568], [0.0, 0.0]]
    assert str(coords[0][0]) == "0.0"


def test_nearly_equal_inputs_share_one_cache_entry(cache: SelectionMaskCache) -> None:
    base = shapely_box(-119.78, 35.18, -119.42, 35.52)
    near = shapely_box(-119.78 + 1e-8, 35.18, -119.42, 35.52 - 1e-8)
    assert cache.get_mask(base) is cache.get_mask(near)
    assert cache.cache_info().misses == 1


def test_rejects_non_polygon(cache: SelectionMaskCache) -> None:
    from shapely.geometry import Point

    with pytest.raises(TypeError):
        cache.get_mask(Point(-119.5, 35.5))  # type: ignore[arg-type]


def test_rejects_bad_construction() -> None:
    lat, lon = _centres()
    with pytest.raises(ValueError):
        SelectionMaskCache(lat, lon[:-1], EXTENT)
    with pytest.raises(ValueError):
        SelectionMaskCache(lat, lon, EXTENT, maxsize=0)


def test_thread_safety_smoke() -> None:
    lat, lon = _centres()
    cache = SelectionMaskCache(lat, lon, EXTENT, maxsize=8)
    polys = [_square(i) for i in range(20)] + [shapely_box(-121.0, 34.0, -118.0, 37.0)]
    expected = [select_cells(lat, lon, p) for p in polys]

    def work(n: int) -> bool:
        i = n % len(polys)
        return bool(np.array_equal(cache.get_mask(polys[i]), expected[i]))

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(work, range(800)))
    assert all(results)
    info = cache.cache_info()
    assert info.size <= 8
    assert info.hits + info.misses == 800

"""Selection mask cache (design section 8.1, Requirements 9.3 and 28.1).

`SelectionMaskCache` turns a selection geometry into a boolean mask over the grid cells (axis 0
of `GridArrays`) and remembers the last 64 masks, so repeated queries on the same area (panning
the date range, changing the baseline, downloading) skip the point-in-polygon test.

Cell selection itself is `hotspots.areastats.select_cells` (half-open boundary rule). Excluded
cells (`EXCLUDED_CELLS`) are already dropped when the grid is loaded, so the centre arrays given
here contain none of them and no exclusion mask is needed.

Key
---
The key is the SHA-256 of a canonical JSON text of the geometry: the type, then the coordinates
with every number rounded to 6 decimals (about 0.1 m), negative zero turned into zero, keys
sorted and no spaces. Ring order, ring orientation and vertex order are kept as given, so only
the numeric rounding is normalised. Two inputs that differ by less than half a unit in the sixth
decimal therefore share a key.

The mask is computed from the canonical (rounded) geometry, not from the raw input. That makes
"same key, same mask" hold exactly. Inputs that already have 6 decimals (the API, the URL and the
shared links all do, see `hotspots.geometry.to_geojson`) give the same mask as calling
`select_cells` on the input itself.

Full-extent fast path
---------------------
When the geometry covers the whole region extent, every cell is selected and the polygon test is
skipped. It is detected in two steps:

1. At construction, the cache checks that every cell centre lies strictly inside the open extent
   rectangle (west < lon < east, south < lat < north). If any centre is on or outside the edge,
   the fast path is switched off for the lifetime of the cache.
2. For a query, `shapely.covers(geometry, extent_rectangle)` must be true. Then the open
   rectangle is inside the geometry's interior, so each centre is strictly inside the geometry
   and `select_cells` would also return True for it (no boundary case arises).

The fast path is therefore equivalent to `select_cells`. A geometry with a hole inside the extent
does not cover it and takes the normal path.

Returned masks are shared and read-only (`mask.flags.writeable` is False). Callers that need to
modify one must copy it. All methods are safe to call from several threads.
"""

from __future__ import annotations

import hashlib
import json
import threading
from collections import OrderedDict
from collections.abc import Sequence
from typing import Any, Final, NamedTuple

import numpy as np
import shapely
from numpy.typing import ArrayLike, NDArray
from shapely.geometry import MultiPolygon, Polygon
from shapely.geometry import box as shapely_box

from hotspots.areastats import select_cells
from hotspots.config import Extent
from hotspots.data import GridArrays
from hotspots.geometry import AreaGeometry

CACHE_SIZE: Final[int] = 64
"""Number of masks kept (design section 8.1)."""

COORDINATE_DECIMALS: Final[int] = 6
"""Decimals kept in every coordinate of the canonical geometry."""

Mask = NDArray[np.bool_]


class CacheInfo(NamedTuple):
    """Counters since the cache was created or last cleared."""

    hits: int
    misses: int
    fast_path: int
    """Misses answered by the full-extent fast path (a subset of `misses`)."""
    size: int
    maxsize: int


def _canonical_number(value: float) -> float:
    return round(float(value), COORDINATE_DECIMALS) + 0.0  # `+ 0.0` turns -0.0 into 0.0


def _canonical_ring(coords: Sequence[Sequence[float]]) -> list[list[float]]:
    return [[_canonical_number(c[0]), _canonical_number(c[1])] for c in coords]


def _canonical_polygon_rings(polygon: Polygon) -> list[list[list[float]]]:
    return [_canonical_ring(ring.coords) for ring in (polygon.exterior, *polygon.interiors)]


def canonical_coordinates(geometry: AreaGeometry) -> dict[str, Any]:
    """GeoJSON-like mapping of `geometry` with every coordinate rounded to 6 decimals.

    Vertex, ring and part order are unchanged. Raises `TypeError` for anything other than a
    Polygon or MultiPolygon.
    """
    if isinstance(geometry, MultiPolygon):
        return {
            "type": "MultiPolygon",
            "coordinates": [_canonical_polygon_rings(p) for p in geometry.geoms],
        }
    if isinstance(geometry, Polygon):
        return {"type": "Polygon", "coordinates": _canonical_polygon_rings(geometry)}
    raise TypeError(f"expected a shapely Polygon or MultiPolygon, got {type(geometry).__name__}")


def canonical_key(geometry: AreaGeometry) -> str:
    """SHA-256 hex digest of the canonical JSON of `geometry` (see the module note)."""
    return _key_of(canonical_coordinates(geometry))


def _key_of(canonical: dict[str, Any]) -> str:
    text = json.dumps(canonical, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _from_canonical(canonical: dict[str, Any]) -> AreaGeometry:
    def polygon(rings: list[list[list[float]]]) -> Polygon:
        return Polygon(rings[0], rings[1:])

    if canonical["type"] == "MultiPolygon":
        return MultiPolygon([polygon(rings) for rings in canonical["coordinates"]])
    return polygon(canonical["coordinates"])


class SelectionMaskCache:
    """LRU cache of cell-selection masks for one grid (size 64 by default)."""

    def __init__(
        self,
        centre_lat: ArrayLike,
        centre_lon: ArrayLike,
        extent: Extent,
        maxsize: int = CACHE_SIZE,
    ) -> None:
        if maxsize < 1:
            raise ValueError("maxsize must be at least 1")
        lat = np.array(centre_lat, dtype=np.float64)
        lon = np.array(centre_lon, dtype=np.float64)
        if lat.shape != lon.shape or lat.ndim != 1:
            raise ValueError("centre_lat and centre_lon must be 1-D arrays of the same length")
        lat.flags.writeable = False
        lon.flags.writeable = False
        self._lat = lat
        self._lon = lon
        self._extent = extent
        self._window = shapely_box(extent.west, extent.south, extent.east, extent.north)
        self._fast_path_enabled = bool(
            np.all((lon > extent.west) & (lon < extent.east))
            and np.all((lat > extent.south) & (lat < extent.north))
        )
        full = np.ones(lat.shape, dtype=np.bool_)
        full.flags.writeable = False
        self._full = full
        self._maxsize = maxsize
        self._masks: OrderedDict[str, Mask] = OrderedDict()
        self._lock = threading.Lock()
        self._hits = 0
        self._misses = 0
        self._fast = 0

    @classmethod
    def from_grid(
        cls, grid: GridArrays, extent: Extent, maxsize: int = CACHE_SIZE
    ) -> SelectionMaskCache:
        """Cache over the cells of a loaded grid (excluded cells are already dropped)."""
        return cls(grid.centre_lat, grid.centre_lon, extent, maxsize)

    def __len__(self) -> int:
        with self._lock:
            return len(self._masks)

    def cache_info(self) -> CacheInfo:
        """Hit, miss and fast-path counters and the current size."""
        with self._lock:
            return CacheInfo(self._hits, self._misses, self._fast, len(self._masks), self._maxsize)

    def clear(self) -> None:
        """Drop every mask and reset the counters."""
        with self._lock:
            self._masks.clear()
            self._hits = self._misses = self._fast = 0

    def covers_extent(self, geometry: AreaGeometry) -> bool:
        """True when the fast path applies: see "Full-extent fast path" in the module note."""
        if not self._fast_path_enabled:
            return False
        bounds = geometry.bounds
        ext = self._extent
        if not (
            bounds[0] <= ext.west
            and bounds[1] <= ext.south
            and bounds[2] >= ext.east
            and bounds[3] >= ext.north
        ):
            return False
        return bool(shapely.covers(geometry, self._window))

    def get_mask(self, geometry: AreaGeometry) -> Mask:
        """Boolean mask over the cells for `geometry`, from the cache when possible.

        The array is read-only and shared between callers. Equal to
        `select_cells(centre_lat, centre_lon, canonical_geometry)`.
        """
        canonical = canonical_coordinates(geometry)
        key = _key_of(canonical)
        with self._lock:
            cached = self._masks.get(key)
            if cached is not None:
                self._masks.move_to_end(key)
                self._hits += 1
                return cached

        # Computed outside the lock. Two threads may compute the same mask; both results are
        # identical and the second store only refreshes the entry.
        canon_geometry = _from_canonical(canonical)
        fast = self.covers_extent(canon_geometry)
        if fast:
            mask = self._full
        else:
            mask = select_cells(self._lat, self._lon, canon_geometry)
            mask.flags.writeable = False

        with self._lock:
            self._misses += 1
            if fast:
                self._fast += 1
            self._masks[key] = mask
            self._masks.move_to_end(key)
            while len(self._masks) > self._maxsize:
                self._masks.popitem(last=False)
        return mask

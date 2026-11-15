"""`POST /api/v1/map-layer`: hotspot layer for the map (Requirement 11.5).

The layer shows filtered RAW detections, not harmonized values. Days use fixed UTC-8
(`acq_date_local`), `acq_datetime_utc` is not returned. Coordinates are EPSG:4326 degrees.

Two modes, chosen by the number of detections in the area and dates (`total`):

- `points`: `total` is at most `MAX_MAP_POINTS` (20,000). One point per detection, with its
  satellite, local date and FRP (MW). The selection rule is the one of the CSV export (bbox and
  date pre-filter, then point in polygon).
- `density`: `total` is above the cap. One entry per 0.1 degree cell (cell centre inside the
  area) with raw cell-days from the monthly grid, summed over the months that touch the date
  range (whole months, as in the Calendar). `count` adds `raw_modis` and `raw_viirs` for
  colouring only. It is not harmonized, and a cell-day seen by both sensor families counts twice.

An optional `month` (`YYYY-MM`) narrows the date range to that month.
"""

from __future__ import annotations

import calendar as _calendar
import re
from datetime import date
from typing import Final, Literal

import numpy as np
import numpy.typing as npt
from fastapi import APIRouter
from pydantic import Field, ValidationInfo, field_validator
from shapely.geometry.base import BaseGeometry

from hotspots.api.deps import ConfigDep, MaskCacheDep, StoreDep
from hotspots.api.routes.calendar import resolve_area
from hotspots.api.schemas import ApiModel, Geometry
from hotspots.constants import CELL_SIZE_DEG, TIME_CONVENTION
from hotspots.data import DataStore, GridArrays
from hotspots.data.types import YearMonth
from hotspots.export import hotspots_csv

router = APIRouter(prefix="/api/v1", tags=["map"])

MAX_MAP_POINTS: Final[int] = 20_000
"""Most points one response holds. Above it the layer is a density layer. DEFAULT (confirm)."""

LAYER_LABEL: Final[str] = "Filtered raw detections, not harmonized"

_MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


class MapLayerIn(ApiModel):
    """Map layer query. `geometry` is null for the full region. Dates are local (UTC-8)."""

    geometry: Geometry | None = None
    start: date
    end: date
    """Both ends are included."""
    month: str | None = None
    """Optional `YYYY-MM`: only that month of the date range."""

    @field_validator("end")
    @classmethod
    def _end_not_before_start(cls, value: date, info: ValidationInfo) -> date:
        start = info.data.get("start")
        if start is not None and value < start:
            raise ValueError("end must not be before start")
        return value

    @field_validator("month")
    @classmethod
    def _month_shape(cls, value: str | None) -> str | None:
        if value is not None and not _MONTH_RE.match(value):
            raise ValueError("month must look like YYYY-MM")
        return value


class MapPoint(ApiModel):
    """One filtered raw detection."""

    lat: float
    lon: float
    satellite: str
    """For example Terra, Aqua, SNPP, N20, N21."""
    local_date: date
    """Local date (`acq_date_local`), fixed UTC-8."""
    frp: float | None = None
    """Fire radiative power in MW, null when missing."""


class MapCell(ApiModel):
    """One 0.1 degree cell of the density layer."""

    lat: float
    lon: float
    """Cell centre."""
    count: int = Field(ge=1)
    """Raw cell-days, `raw_modis + raw_viirs`. Not harmonized."""
    raw_modis: int
    raw_viirs: int


class MapLayerOut(ApiModel):
    """Response of `POST /api/v1/map-layer`."""

    mode: Literal["points", "density"]
    total: int
    """Detections in the area and dates (filtered raw detections, not harmonized)."""
    max_points: int
    points: list[MapPoint] = Field(default_factory=list)
    cells: list[MapCell] = Field(default_factory=list)
    cell_size_deg: float = CELL_SIZE_DEG
    label: str = LAYER_LABEL
    time_convention: str = TIME_CONVENTION
    month: str | None = None


def _effective_dates(start: date, end: date, month: str | None) -> tuple[date, date] | None:
    """Date range after applying `month`, or None when they do not overlap."""
    if month is None:
        return start, end
    ym = YearMonth.parse(month)
    first = date(ym.year, ym.month, 1)
    last = date(ym.year, ym.month, _calendar.monthrange(ym.year, ym.month)[1])
    lo, hi = max(start, first), min(end, last)
    return (lo, hi) if lo <= hi else None


def _points(store: DataStore, polygon: BaseGeometry, d0: date, d1: date) -> list[MapPoint]:
    out: list[MapPoint] = []
    for table in hotspots_csv.iter_hotspot_batches(store, polygon, d0, d1):
        if table.num_rows == 0:
            continue
        lat = table.column("lat").to_pylist()
        lon = table.column("lon").to_pylist()
        sat = table.column("satellite").to_pylist()
        day = table.column("acq_date_local").to_pylist()
        frp = table.column("frp").to_pylist()
        for la, lo, sa, da, fr in zip(lat, lon, sat, day, frp, strict=True):
            out.append(
                MapPoint(
                    lat=float(la),
                    lon=float(lo),
                    satellite=str(sa),
                    local_date=da,
                    frp=None if fr is None or fr != fr else float(fr),
                )
            )
    return out


def _cells(grid: GridArrays, mask: npt.NDArray[np.bool_], d0: date, d1: date) -> list[MapCell]:
    """Raw cell-days per selected cell over the whole months touching `[d0, d1]`."""
    first = YearMonth(d0.year, d0.month).index
    last = YearMonth(d1.year, d1.month).index
    cols = (grid.month_index >= first) & (grid.month_index <= last)
    if not cols.any() or not mask.any():
        return []
    rows = np.flatnonzero(mask)
    modis = grid.raw_modis[np.ix_(rows, np.flatnonzero(cols))].sum(axis=1, dtype=np.int64)
    viirs = grid.raw_viirs[np.ix_(rows, np.flatnonzero(cols))].sum(axis=1, dtype=np.int64)
    out: list[MapCell] = []
    for k in np.flatnonzero(modis + viirs > 0):
        r = int(rows[k])
        out.append(
            MapCell(
                lat=float(grid.centre_lat[r]),
                lon=float(grid.centre_lon[r]),
                count=int(modis[k] + viirs[k]),
                raw_modis=int(modis[k]),
                raw_viirs=int(viirs[k]),
            )
        )
    return out


@router.post("/map-layer", response_model=MapLayerOut)
def map_layer(
    body: MapLayerIn, config: ConfigDep, store: StoreDep, masks: MaskCacheDep
) -> MapLayerOut:
    """Points or a density layer of filtered raw detections for an area and dates.

    `mode` is `points` when the area and dates hold at most 20,000 detections, otherwise
    `density`. `total` is the detection count. Detections are filtered raw detections, not
    harmonized. Days use fixed UTC-8.

    HTTP 422 for an invalid area (`invalid_geometry`, `outside_coverage`). HTTP 503 without data.
    """
    geometry = None if body.geometry is None else body.geometry.model_dump()
    polygon, _ = resolve_area(geometry, config.region.extent)
    limit = MAX_MAP_POINTS
    dates = _effective_dates(body.start, body.end, body.month)
    if dates is None:
        return MapLayerOut(mode="points", total=0, max_points=limit, month=body.month)
    d0, d1 = dates

    bbox = hotspots_csv.polygon_bbox(polygon)
    if store.count_detections(bbox, d0, d1) <= limit:
        points = _points(store, polygon, d0, d1)
        return MapLayerOut(
            mode="points", total=len(points), max_points=limit, points=points, month=body.month
        )
    total = hotspots_csv.count_hotspot_rows(store, polygon, d0, d1)
    if total <= limit:
        points = _points(store, polygon, d0, d1)
        return MapLayerOut(
            mode="points", total=len(points), max_points=limit, points=points, month=body.month
        )
    cells = _cells(store.grid(), masks.get_mask(polygon), d0, d1)
    return MapLayerOut(mode="density", total=total, max_points=limit, cells=cells, month=body.month)

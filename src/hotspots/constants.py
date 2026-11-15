"""Shared constants. Units, CRS and time convention are stated here once and reused."""

from typing import Final

CRS: Final[str] = "EPSG:4326"
"""Coordinate reference system for all lat/lon values (lon, lat order in geometries)."""

CELL_SIZE_DEG: Final[float] = 0.1
"""Display cell size in degrees. `disp_lat` and `disp_lon` are the SW corner."""

UNIT: Final[str] = "cell-days (MODIS-equivalent)"
"""Counting unit: one 1 km cell with at least one kept detection on a local day."""

FRP_UNIT: Final[str] = "MW"

TIME_CONVENTION: Final[str] = "local standard time, fixed UTC-8 (PST, no daylight saving)"
"""Days, months and years use fixed UTC-8. `acq_datetime_utc` is true UTC."""

REGION_LABEL: Final[str] = "California region"

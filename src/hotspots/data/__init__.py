"""Data access layer: the only place that reads the delivered Parquet files."""

from hotspots.data.grid import GridArrays, GridDataError, build_grid_arrays
from hotspots.data.store import DataStore
from hotspots.data.types import BBox, DataUnavailableError, YearMonth

__all__ = [
    "BBox",
    "DataStore",
    "DataUnavailableError",
    "GridArrays",
    "GridDataError",
    "YearMonth",
    "build_grid_arrays",
]

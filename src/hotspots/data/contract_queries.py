"""Queries that measure the delivered files for the data-contract check.

Every query goes through `DataStore.raw_query`: read-only, bound parameters, and the files as
delivered (no excluded cells or pre-record months dropped). Nothing here judges the numbers;
`hotspots.data.check` compares them with the contract.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Literal

from hotspots.data.store import DataStore
from hotspots.data.types import DataUnavailableError

EXCLUDED_CELL_ID = "38.7000_-117.4000"
"""The stray cell outside California (data contract, `EXCLUDED_CELLS`)."""

PRE_RECORD_YEAR = 2000
PRE_RECORD_MONTH = 10


@dataclass(frozen=True)
class ColumnInfo:
    """One column from `DESCRIBE`: its name and DuckDB type."""

    name: str
    type: str


@dataclass(frozen=True)
class GridFacts:
    columns: tuple[ColumnInfo, ...]
    row_count: int
    cell_count: int
    lat_min: float
    lat_max: float
    lon_min: float
    lon_max: float
    """SW-corner extremes of `disp_lat` and `disp_lon`. A cell spans 0.1 degree north and east."""
    pre_record_rows: int
    """Rows in October 2000."""
    excluded_cell_rows: int
    excluded_cell_count_min: float | None
    excluded_cell_count_max: float | None
    frp_mean_null_rows: int


@dataclass(frozen=True)
class DetectionFacts:
    columns: tuple[ColumnInfo, ...]
    row_count: int
    lat_min: float
    lat_max: float
    lon_min: float
    lon_max: float
    pre_record_local_dates: tuple[date, ...]
    """Distinct `acq_date_local` values in October 2000 (local month)."""


@dataclass(frozen=True)
class ContractFacts:
    grid: GridFacts
    detections: DetectionFacts


def collect_facts(store: DataStore) -> ContractFacts:
    """Measure both delivered files. Raises `DataUnavailableError` if a file cannot be read."""
    return ContractFacts(grid=_grid_facts(store), detections=_detection_facts(store))


def _describe(store: DataStore, source: Literal["grid", "detections"]) -> tuple[ColumnInfo, ...]:
    rows = store.raw_query(source, "DESCRIBE SELECT * FROM {src}")
    return tuple(ColumnInfo(name=str(r[0]), type=str(r[1])) for r in rows)


def _one(rows: list[tuple[Any, ...]], what: str) -> tuple[Any, ...]:
    if len(rows) != 1:
        raise DataUnavailableError(f"expected one row for {what}, got {len(rows)}")
    return rows[0]


def _float(value: object, what: str) -> float:
    if not isinstance(value, int | float):
        raise DataUnavailableError(f"{what} is not a number: {value!r}")
    return float(value)


def _int(value: object, what: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise DataUnavailableError(f"{what} is not an integer: {value!r}")
    return value


def _grid_facts(store: DataStore) -> GridFacts:
    columns = _describe(store, "grid")

    totals = _one(
        store.raw_query(
            "grid",
            "SELECT count(*), count(DISTINCT cell_id), min(disp_lat), max(disp_lat), "
            "min(disp_lon), max(disp_lon), count(*) FILTER (WHERE frp_mean IS NULL) FROM {src}",
        ),
        "grid totals",
    )
    pre_record = _one(
        store.raw_query(
            "grid",
            "SELECT count(*) FROM {src} WHERE year = ? AND month = ?",
            [PRE_RECORD_YEAR, PRE_RECORD_MONTH],
        ),
        "grid October 2000 rows",
    )
    excluded = _one(
        store.raw_query(
            "grid",
            "SELECT count(*), min(count_harmonized), max(count_harmonized) "
            "FROM {src} WHERE cell_id = ?",
            [EXCLUDED_CELL_ID],
        ),
        "grid excluded cell",
    )
    excl_min, excl_max = excluded[1], excluded[2]
    return GridFacts(
        columns=columns,
        row_count=_int(totals[0], "grid row count"),
        cell_count=_int(totals[1], "grid cell count"),
        lat_min=_float(totals[2], "min disp_lat"),
        lat_max=_float(totals[3], "max disp_lat"),
        lon_min=_float(totals[4], "min disp_lon"),
        lon_max=_float(totals[5], "max disp_lon"),
        pre_record_rows=_int(pre_record[0], "October 2000 grid rows"),
        excluded_cell_rows=_int(excluded[0], "excluded cell rows"),
        excluded_cell_count_min=None if excl_min is None else _float(excl_min, "excluded min"),
        excluded_cell_count_max=None if excl_max is None else _float(excl_max, "excluded max"),
        frp_mean_null_rows=_int(totals[6], "frp_mean null rows"),
    )


def _detection_facts(store: DataStore) -> DetectionFacts:
    columns = _describe(store, "detections")

    totals = _one(
        store.raw_query(
            "detections",
            "SELECT count(*), min(lat), max(lat), min(lon), max(lon) FROM {src}",
        ),
        "detections totals",
    )
    date_rows = store.raw_query(
        "detections",
        "SELECT DISTINCT acq_date_local FROM {src} WHERE year = ? AND month = ? "
        "ORDER BY acq_date_local",
        [PRE_RECORD_YEAR, PRE_RECORD_MONTH],
    )
    dates: list[date] = []
    for (value,) in date_rows:
        if not isinstance(value, date):
            raise DataUnavailableError(f"acq_date_local is not a date: {value!r}")
        dates.append(value)
    return DetectionFacts(
        columns=columns,
        row_count=_int(totals[0], "detections row count"),
        lat_min=_float(totals[1], "min lat"),
        lat_max=_float(totals[2], "max lat"),
        lon_min=_float(totals[3], "min lon"),
        lon_max=_float(totals[4], "max lon"),
        pre_record_local_dates=tuple(dates),
    )

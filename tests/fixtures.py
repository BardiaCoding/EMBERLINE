"""TEST FIXTURE, not NASA data.

Writes small synthetic Parquet files with the delivered data contract schema
(`.kiro/steering/data-contract.md`). Every value here is invented for tests. Nothing in this
module is NASA data, and none of it may appear in the app or in documentation as real values.

The files carry the delivered file names (the app config looks for them by name), so the label
"TEST FIXTURE, not NASA data" is in the folder name (`TEST_FIXTURE_not_NASA_data`), in the
Parquet schema metadata (`fixture_label`) and in this docstring.

The default fixture includes:
- sparse rows (most cell-months are absent, which means zero cell-days),
- an incomplete latest month (2026-11),
- October 2000 (one row, before `RECORD_START`),
- the excluded cell `38.7000_-117.4000` (one incomplete-month row with count 0),
- `disp_lon` floating-point noise (for example -114.60000000000001), as in the delivered grid.
"""

from __future__ import annotations

import random
from collections.abc import Iterable, Sequence
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import pyarrow as pa
import pyarrow.parquet as pq

FIXTURE_LABEL = "TEST FIXTURE, not NASA data"
FIXTURE_DIRNAME = "TEST_FIXTURE_not_NASA_data"
GRID_FILENAME = "harmonized_monthly_grid.parquet"
DETECTIONS_FILENAME = "detections_harmonized.parquet"

RECORD_START = (2000, 11)
LATEST_MONTH = (2026, 11)
"""Latest (incomplete) month in the fixtures, as in the delivered data."""
CALIBRATED_FROM_YEAR = 2012
EXCLUDED_CELL_ID = "38.7000_-117.4000"
EXCLUDED_CELL_INDEX = (387, -1174)
"""(lat_idx, lon_idx) of the excluded cell, in units of 0.1 degree."""
LOCAL_UTC_OFFSET_HOURS = -8
"""Fixed UTC-8 local standard time (PST, no daylight saving)."""

_METADATA = {"fixture_label": FIXTURE_LABEL}

GRID_SCHEMA = pa.schema(
    [
        pa.field("cell_id", pa.string(), nullable=False),
        pa.field("disp_lat", pa.float64(), nullable=False),
        pa.field("disp_lon", pa.float64(), nullable=False),
        pa.field("region_id", pa.string(), nullable=False),
        pa.field("year", pa.int32(), nullable=False),
        pa.field("month", pa.int32(), nullable=False),
        pa.field("count_harmonized", pa.float64(), nullable=False),
        pa.field("count_raw_modis", pa.int32(), nullable=False),
        pa.field("count_raw_viirs", pa.int32(), nullable=False),
        pa.field("frp_sum", pa.float64(), nullable=False),
        pa.field("frp_mean", pa.float64(), nullable=True),
        pa.field("source_flag", pa.string(), nullable=False),
        pa.field("calib_model", pa.string(), nullable=False),
        pa.field("provenance", pa.string(), nullable=False),
        pa.field("incomplete", pa.bool_(), nullable=False),
    ],
    metadata=_METADATA,
)

DETECTIONS_SCHEMA = pa.schema(
    [
        pa.field("sensor_family", pa.string()),
        pa.field("satellite", pa.string()),
        pa.field("source", pa.string()),
        pa.field("lat", pa.float64()),
        pa.field("lon", pa.float64()),
        pa.field("acq_datetime_utc", pa.timestamp("us")),
        pa.field("acq_date_local", pa.date32()),
        pa.field("year", pa.int64()),
        pa.field("month", pa.int32()),
        pa.field("daynight", pa.string()),
        pa.field("confidence_class", pa.string()),
        pa.field("confidence_raw", pa.string()),
        pa.field("frp", pa.float64()),
        pa.field("type", pa.int32()),
        pa.field("pixel_size_m", pa.int32()),
        pa.field("version", pa.string()),
    ],
    metadata=_METADATA,
)


# ---------------------------------------------------------------------------
# Row builders (TEST FIXTURE, not NASA data)
# ---------------------------------------------------------------------------


def cell_coords(lat_idx: int, lon_idx: int) -> tuple[str, float, float]:
    """Return `(cell_id, disp_lat, disp_lon)` for a 0.1 degree cell. TEST FIXTURE, not NASA data.

    `lat_idx` and `lon_idx` are the SW corner in units of 0.1 degree (for example 340, -1181 for
    lat 34.0, lon -118.1). `disp_lon` is computed by multiplication, so it carries float noise
    (-1146 * 0.1 is -114.60000000000001), like the delivered grid. Join on `cell_id`.
    """
    cell_id = f"{lat_idx / 10:.4f}_{lon_idx / 10:.4f}"
    return cell_id, lat_idx / 10, lon_idx * 0.1


def region_id_for(lat_idx: int, lon_idx: int) -> str:
    """1.0 degree region id in the delivered style, for example `R+032.0_-0115.0`."""
    return f"R{lat_idx // 10:+04d}.0_{lon_idx // 10:+05d}.0"


def make_grid_row(
    lat_idx: int,
    lon_idx: int,
    year: int,
    month: int,
    count_harmonized: float,
    *,
    frp_mean_null: bool = False,
    incomplete: bool | None = None,
) -> dict[str, Any]:
    """One synthetic grid row with the contract schema. TEST FIXTURE, not NASA data.

    Years from 2012 are `calibrated` (VIIRS-based, quantile map), earlier years are `native`
    (MODIS). `incomplete` defaults to True only for the latest month (2026-11).
    """
    cell_id, disp_lat, disp_lon = cell_coords(lat_idx, lon_idx)
    calibrated = year >= CALIBRATED_FROM_YEAR
    if incomplete is None:
        incomplete = (year, month) == LATEST_MONTH
    frp_sum = round(count_harmonized * 12.5, 3)
    has_frp_mean = count_harmonized > 0 and not (calibrated and frp_mean_null)
    return {
        "cell_id": cell_id,
        "disp_lat": disp_lat,
        "disp_lon": disp_lon,
        "region_id": region_id_for(lat_idx, lon_idx),
        "year": year,
        "month": month,
        "count_harmonized": float(count_harmonized),
        "count_raw_modis": 0 if calibrated else round(count_harmonized),
        "count_raw_viirs": int(-(-count_harmonized * 1.25 // 1)) if calibrated else 0,
        "frp_sum": frp_sum if count_harmonized > 0 else 0.0,
        "frp_mean": frp_sum / count_harmonized if has_frp_mean else None,
        "source_flag": "calibrated" if calibrated else "native",
        "calib_model": "quantile_map" if calibrated else "none",
        "provenance": "N20+N21+SNPP" if calibrated else "Aqua+Terra",
        "incomplete": incomplete,
    }


def local_date(utc: datetime) -> date:
    """Local calendar day at fixed UTC-8 (no daylight saving)."""
    return (utc + timedelta(hours=LOCAL_UTC_OFFSET_HOURS)).date()


def make_detection_row(
    lat: float,
    lon: float,
    utc: datetime,
    *,
    sensor_family: str | None = None,
    frp: float = 10.0,
    confidence_class: str = "nominal",
) -> dict[str, Any]:
    """One synthetic detection row with the 16 contract columns. TEST FIXTURE, not NASA data.

    `year` and `month` follow the local day (UTC-8), as in the delivered file. MODIS by default
    before 2012 and VIIRS from 2012. Rows are filtered raw detections, not harmonized.
    """
    if sensor_family is None:
        sensor_family = "VIIRS" if utc.year >= CALIBRATED_FROM_YEAR else "MODIS"
    day = local_date(utc)
    viirs = sensor_family == "VIIRS"
    return {
        "sensor_family": sensor_family,
        "satellite": "SNPP" if viirs else "Terra",
        "source": "SP",
        "lat": lat,
        "lon": lon,
        "acq_datetime_utc": utc,
        "acq_date_local": day,
        "year": day.year,
        "month": day.month,
        "daynight": "D" if utc.hour >= 12 or utc.hour < 4 else "N",
        "confidence_class": confidence_class,
        "confidence_raw": "n" if viirs else "75",
        "frp": frp,
        "type": 0,
        "pixel_size_m": 375 if viirs else 1000,
        "version": "2.0" if viirs else "6.03",
    }


# ---------------------------------------------------------------------------
# Default fixture content
# ---------------------------------------------------------------------------

_CELL_A = (340, -1181)
_CELL_B = (341, -1181)
_CELL_C = (375, -1205)
_CELL_D = (325, -1146)
"""Cell D has `disp_lon` -114.60000000000001 (float noise)."""


def default_grid_rows() -> list[dict[str, Any]]:
    """Sparse grid rows for four real-looking cells plus the excluded cell.

    TEST FIXTURE, not NASA data. Most cell-months are absent (zero cell-days).
    """
    rows = [
        # October 2000: before RECORD_START, must be excluded from the Calendar and baselines.
        make_grid_row(*_CELL_A, 2000, 10, 1.0),
        make_grid_row(*_CELL_A, 2000, 11, 2.0),
        make_grid_row(*_CELL_A, 2001, 7, 5.0),
        make_grid_row(*_CELL_A, 2012, 7, 6.4),
        make_grid_row(*_CELL_A, 2018, 8, 31.0, frp_mean_null=True),
        make_grid_row(*_CELL_A, 2026, 10, 4.0),
        make_grid_row(*_CELL_A, 2026, 11, 3.0),
        make_grid_row(*_CELL_B, 2000, 11, 1.0),
        make_grid_row(*_CELL_B, 2013, 7, 9.0),
        make_grid_row(*_CELL_B, 2026, 11, 2.0),
        make_grid_row(*_CELL_C, 2005, 9, 7.0),
        make_grid_row(*_CELL_C, 2020, 9, 14.5),
        make_grid_row(*_CELL_D, 2003, 10, 3.0),
        make_grid_row(*_CELL_D, 2015, 6, 2.5),
        # Excluded cell: one incomplete-month row with count 0.
        make_grid_row(*EXCLUDED_CELL_INDEX, *LATEST_MONTH, 0.0),
    ]
    return rows


def default_detections_rows(seed: int = 2026) -> list[dict[str, Any]]:
    """Synthetic detections sorted by local date. TEST FIXTURE, not NASA data.

    Includes a detection at 2000-11-01 06:12 UTC, which is local 2000-10-31 (October 2000).
    """
    rng = random.Random(seed)
    rows = [make_detection_row(34.0 + 0.05, -118.1 + 0.05, datetime(2000, 11, 1, 6, 12, 48))]
    for year, month in [(2001, 7), (2012, 7), (2018, 8), (2020, 9), (2026, 10), (2026, 11)]:
        for _ in range(3):
            utc = datetime(year, month, rng.randint(2, 27), rng.randint(0, 23), rng.randint(0, 59))
            lat = round(rng.uniform(32.6, 42.0), 4)
            lon = round(rng.uniform(-124.3, -114.2), 4)
            rows.append(make_detection_row(lat, lon, utc, frp=round(rng.uniform(1, 80), 1)))
    return sorted(rows, key=lambda r: (r["acq_date_local"], r["acq_datetime_utc"]))


# ---------------------------------------------------------------------------
# Writers
# ---------------------------------------------------------------------------


def grid_table(rows: Iterable[dict[str, Any]]) -> pa.Table:
    """Arrow table with `GRID_SCHEMA` (and the fixture label in its metadata)."""
    return pa.Table.from_pylist(list(rows), schema=GRID_SCHEMA)


def detections_table(rows: Iterable[dict[str, Any]]) -> pa.Table:
    """Arrow table with `DETECTIONS_SCHEMA` (and the fixture label in its metadata)."""
    return pa.Table.from_pylist(list(rows), schema=DETECTIONS_SCHEMA)


def write_grid(path: Path, rows: Sequence[dict[str, Any]] | None = None) -> Path:
    """Write grid rows (default fixture rows) to `path` as Parquet. TEST FIXTURE, not NASA data."""
    path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(grid_table(default_grid_rows() if rows is None else rows), path)
    return path


def write_detections(path: Path, rows: Sequence[dict[str, Any]] | None = None) -> Path:
    """Write detection rows (default fixture rows) to `path`. TEST FIXTURE, not NASA data."""
    path.parent.mkdir(parents=True, exist_ok=True)
    data = default_detections_rows() if rows is None else rows
    pq.write_table(detections_table(data), path)
    return path


def write_fixture_dir(
    tmp_path: Path,
    grid_rows: Sequence[dict[str, Any]] | None = None,
    detections_rows: Sequence[dict[str, Any]] | None = None,
) -> Path:
    """Write both Parquet files into `tmp_path/TEST_FIXTURE_not_NASA_data` and return that folder.

    The folder is usable as the app's `data_dir`. TEST FIXTURE, not NASA data.
    """
    data_dir = tmp_path / FIXTURE_DIRNAME
    write_grid(data_dir / GRID_FILENAME, grid_rows)
    write_detections(data_dir / DETECTIONS_FILENAME, detections_rows)
    return data_dir

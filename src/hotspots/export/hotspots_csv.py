"""Hotspot CSV exporter (Requirement 17, design section 10 "Hotspot CSV").

The rows are filtered RAW detections from `detections_harmonized.parquet`. They are not
individually harmonized: harmonization applies only to monthly cell-day counts.

Selection (one rule for the count and the export, so estimate rows equal exported rows):

1. bounding-box and date pre-filter in DuckDB (`DataStore.iter_detections`, inclusive edges,
   `acq_date_local` in the exact range, fixed UTC-8 local days),
2. point-in-polygon on `(lon, lat)` with the boundary rule of `hotspots.areastats.select_cells`
   (a point on an edge or vertex counts when the point shifted slightly north-east is inside).

File layout: `#` comment lines, one header row with the 16 contract columns, the data rows and,
only for a complete file, a final `# rows: N` line. `N` is the number of data rows. If the
generator fails, it raises without writing the final line, so a reader can tell the file is
incomplete (Requirement 17.8).

Value text: missing values are empty fields. `acq_datetime_utc` is true UTC in ISO 8601 with a
`Z` designator, `acq_date_local` is `YYYY-MM-DD` (local standard time, UTC-8). Floats are written
with the shortest text that reads back to the same number. Text is quoted when it holds a comma,
a quote, a line break, or starts with `#` in the first column (so no data row looks like a
comment). Lines end with `\\n`.
"""

from __future__ import annotations

import json
import math
from collections.abc import Iterator, Sequence
from datetime import UTC, date, datetime
from typing import Any, Final

import numpy as np
import pyarrow as pa

from hotspots.areastats import select_cells
from hotspots.constants import CRS, REGION_LABEL
from hotspots.data import DataStore
from hotspots.data.types import BBox
from hotspots.geometry import AreaGeometry, to_geojson

COLUMNS: Final[tuple[str, ...]] = (
    "sensor_family",
    "satellite",
    "source",
    "lat",
    "lon",
    "acq_datetime_utc",
    "acq_date_local",
    "year",
    "month",
    "daynight",
    "confidence_class",
    "confidence_raw",
    "frp",
    "type",
    "pixel_size_m",
    "version",
)
"""The 16 columns of `detections_harmonized.parquet`, in export order (data contract)."""

MAX_EXPORT_ROWS: Final[int] = 2_000_000
"""Most data rows one export may have. DEFAULT (confirm), Requirement 17.6."""

# DEFAULT (confirm): the build date is stated in `outputs2.0/DATA_README.md`. Requirement 30.3
# wants it in the app configuration; until that exists the export uses this constant.
DELIVERED_DATA_BUILD_DATE: Final[str] = "2026-11-14"

TIME_CONVENTION_LINE: Final[str] = (
    "local standard time, fixed UTC-8, no daylight saving; acq_datetime_utc is true UTC"
)
SOURCE_LINE: Final[str] = (
    "NASA FIRMS MODIS and VIIRS active-fire detections, delivered data"
    f" (build date {DELIVERED_DATA_BUILD_DATE})"
)
FILTERS_LINE: Final[str] = (
    "low-confidence detections dropped; only type 0 (vegetation or other fire) kept;"
    " near-real-time rows filtered with an approximate static-cell mask"
)
RAW_LINE: Final[str] = (
    "rows are filtered raw detections, not individually harmonized;"
    " harmonization applies only to monthly cell-day counts"
)
RECONCILE_LINE: Final[str] = (
    "CSV rows are detections while Calendar counts are cell-days, so they do not reconcile"
)
UNITS_LINE: Final[str] = (
    f"lat and lon in degrees ({CRS}); frp in MW; pixel_size_m in metres; each row is one"
    " raw detection"
)
SELECTION_LINE: Final[str] = (
    "a detection is included when its lat and lon lie inside the geometry (a point on an edge"
    " counts when the point shifted slightly north-east is inside) and acq_date_local is in the"
    " date range, both ends included"
)
# DEFAULT (confirm): FIRMS acknowledgement wording as published by NASA FIRMS (unverified here).
CITATION_LINE: Final[str] = (
    "We acknowledge the use of data and/or imagery from NASA's Fire Information for Resource"
    " Management System (FIRMS) (https://earthdata.nasa.gov/firms), part of NASA's Earth Science"
    " Data and Information System (ESDIS)."
)

_ROWS_PREFIX: Final[str] = "# rows: "

# --- geometry ----------------------------------------------------------------------------


def polygon_bbox(polygon: AreaGeometry) -> BBox:
    """Bounding box of a selection polygon, as the pre-filter of the detections query."""
    west, south, east, north = polygon.bounds
    return BBox(west=west, south=south, east=east, north=north)


def describe_geometry(polygon: AreaGeometry, *, full_region: bool) -> str:
    """One-line text of the query geometry: compact GeoJSON, 6 decimals, `[lon, lat]` order."""
    geojson = json.dumps(
        to_geojson(polygon, 6),
        separators=(",", ":"),
        allow_nan=False,
    )
    prefix = "full region extent, " if full_region else ""
    return f"{prefix}GeoJSON ({CRS}, [longitude, latitude]) {geojson}"


# --- selection ---------------------------------------------------------------------------


def iter_hotspot_batches(
    store: DataStore,
    polygon: AreaGeometry,
    start: date,
    end: date,
    batch: int | None = None,
) -> Iterator[pa.Table]:
    """Yield the detections of a query as Arrow tables (bbox pre-filter, then polygon test).

    Tables hold the 16 columns in file order and may be empty. Closing the generator early
    releases the DuckDB cursor.
    """
    bbox = polygon_bbox(polygon)
    source = (
        store.iter_detections(bbox, start, end)
        if batch is None
        else store.iter_detections(bbox, start, end, batch)
    )
    for table in source:
        if table.num_rows == 0:
            yield table
            continue
        lat = table.column("lat").to_numpy(zero_copy_only=False).astype(np.float64)
        lon = table.column("lon").to_numpy(zero_copy_only=False).astype(np.float64)
        keep = select_cells(lat, lon, polygon)  # NaN coordinates are never selected
        yield table.filter(pa.array(keep))


def count_hotspot_rows(
    store: DataStore,
    polygon: AreaGeometry,
    start: date,
    end: date,
    batch: int | None = None,
) -> int:
    """Number of data rows the export of this query writes (same selection as the export)."""
    return sum(t.num_rows for t in iter_hotspot_batches(store, polygon, start, end, batch))


# --- text --------------------------------------------------------------------------------


def _quote(text: str, *, first: bool) -> str:
    if text == "":
        return ""
    if any(ch in text for ch in ',"\r\n') or (first and text.startswith("#")):
        return '"' + text.replace('"', '""') + '"'
    return text


def format_value(value: object) -> str:
    """Text of one value. Missing values (None, NaN, infinite) are empty."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float):
        return repr(value) if math.isfinite(value) else ""
    if isinstance(value, datetime):
        utc = value if value.tzinfo is None else value.astimezone(UTC).replace(tzinfo=None)
        return utc.isoformat() + "Z"
    if isinstance(value, date):
        return value.isoformat()
    return str(value)


def format_row(values: Sequence[object]) -> str:
    """One CSV line (with its line break) for a sequence of values."""
    cells = [_quote(format_value(v), first=i == 0) for i, v in enumerate(values)]
    return ",".join(cells) + "\n"


def csv_header_row() -> str:
    """The header line with the 16 column names."""
    return ",".join(COLUMNS) + "\n"


def build_comment_lines(
    *,
    geometry_description: str,
    start: date,
    end: date,
    generated_at: datetime,
    region_label: str = REGION_LABEL,
) -> list[str]:
    """The `#` comment lines that start the file, each ending with a line break.

    `geometry_description` must be one line (no line breaks). `generated_at` is written in UTC.
    """
    if "\n" in geometry_description or "\r" in geometry_description:
        raise ValueError("geometry_description must be a single line")
    stamp = (
        generated_at.astimezone(UTC) if generated_at.tzinfo else generated_at.replace(tzinfo=UTC)
    )
    lines = [
        f"Hotspot detections export, {region_label}",
        f"Region: {region_label}",
        f"Query geometry: {geometry_description}",
        f"Selection rule: {SELECTION_LINE}",
        f"Date range (local dates, inclusive): {start.isoformat()} to {end.isoformat()}",
        f"Time convention: {TIME_CONVENTION_LINE}",
        f"Generated (UTC): {stamp.strftime('%Y-%m-%dT%H:%M:%SZ')}",
        f"Source: {SOURCE_LINE}",
        f"Filters already applied: {FILTERS_LINE}",
        f"Note: {RAW_LINE}",
        f"Note: {RECONCILE_LINE}",
        f"Units: {UNITS_LINE}",
        f"Citation: {CITATION_LINE}",
    ]
    return [f"# {text}\n" for text in lines]


def rows_footer(n_rows: int) -> str:
    """The final comment line of a complete file."""
    return f"{_ROWS_PREFIX}{n_rows}\n"


def _table_lines(table: pa.Table) -> list[str]:
    columns: list[list[Any]] = [table.column(name).to_pylist() for name in COLUMNS]
    return [format_row(values) for values in zip(*columns, strict=True)]


# --- streaming ---------------------------------------------------------------------------


def iter_hotspot_csv(
    store: DataStore,
    polygon: AreaGeometry,
    start: date,
    end: date,
    *,
    geometry_description: str,
    region_label: str = REGION_LABEL,
    generated_at: datetime | None = None,
    batch: int | None = None,
) -> Iterator[bytes]:
    """Stream the hotspot CSV as UTF-8 chunks: comments and header first, then one chunk per batch.

    The final `# rows: N` line is yielded only after every batch was written. If reading or
    formatting fails, the exception propagates and no final line is written (Requirement 17.8).
    Only one batch is held in memory at a time (Requirement 17.3).
    """
    stamp = generated_at if generated_at is not None else datetime.now(UTC)
    head = build_comment_lines(
        geometry_description=geometry_description,
        start=start,
        end=end,
        generated_at=stamp,
        region_label=region_label,
    )
    yield ("".join(head) + csv_header_row()).encode("utf-8")
    written = 0
    for table in iter_hotspot_batches(store, polygon, start, end, batch):
        if table.num_rows == 0:
            continue
        lines = _table_lines(table)
        written += len(lines)
        yield "".join(lines).encode("utf-8")
    yield rows_footer(written).encode("utf-8")

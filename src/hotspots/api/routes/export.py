"""`POST /api/v1/export/hotspots`: streaming hotspot CSV (Requirements 17.1 to 17.3, 17.6 to 17.8).

The rows are filtered RAW detections, not individually harmonized. Days use fixed UTC-8
(`acq_date_local`), `acq_datetime_utc` is true UTC. The file layout and the selection rule are in
`hotspots.export.hotspots_csv`.

Flow: validate and clip the area (422 with a reason), count the rows the query would export and
answer 422 `export_too_large` over `MAX_EXPORT_ROWS` before any byte is streamed, then stream
the file. A failure after streaming started ends the response without the final `# rows: N`
line. The count is skipped when the cheap bbox count is already within the limit.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from datetime import UTC, date, datetime

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from shapely.geometry.base import BaseGeometry

from hotspots.api.deps import ConfigDep, StoreDep
from hotspots.api.errors import ApiValidationError
from hotspots.api.routes.calendar import resolve_area
from hotspots.api.schemas import FieldError, HotspotEstimateOut, HotspotExportIn
from hotspots.data import DataStore
from hotspots.export import hotspots_csv
from hotspots.export.filenames import export_filename

logger = logging.getLogger("hotspots.api")

router = APIRouter(prefix="/api/v1", tags=["export"])

EXPORT_TOO_LARGE_CODE = "export_too_large"
CSV_MEDIA_TYPE = "text/csv; charset=utf-8"
FULL_REGION_FILE_LABEL = "California-region"
CUSTOM_AREA_FILE_LABEL = "custom-area"
FALLBACK_CSV_AVG_BYTES_PER_ROW = 98.0
"""Used when the config has `csv_avg_bytes_per_row: 0`. Measured on the delivered detections
(mean 97.98 bytes per row, `scripts/measure_csv_row_bytes.py`). DEFAULT (confirm)."""


def _check_size(store: DataStore, polygon: BaseGeometry, start: date, end: date) -> None:
    """Raise 422 `export_too_large` when the query has more than `MAX_EXPORT_ROWS` rows."""
    limit = hotspots_csv.MAX_EXPORT_ROWS
    bbox = hotspots_csv.polygon_bbox(polygon)
    if store.count_detections(bbox, start, end) <= limit:
        return  # the polygon test only removes rows
    rows = hotspots_csv.count_hotspot_rows(store, polygon, start, end)
    if rows > limit:
        raise ApiValidationError(
            EXPORT_TOO_LARGE_CODE,
            f"The query has {rows:,} detections, which is over the limit of {limit:,} rows. "
            "Narrow the area or the date range.",
            [FieldError(field="query", reason=f"{rows} rows; the limit is {limit}")],
        )


def header_bytes(
    polygon: BaseGeometry, start: date, end: date, *, region_label: str, full_region: bool
) -> int:
    """UTF-8 size of what the export writes besides the data rows.

    That is the `#` comment lines, the column header row and the final `# rows: N` line (N is
    taken at the limit width, so the size never falls short by a digit).
    """
    head = hotspots_csv.build_comment_lines(
        geometry_description=hotspots_csv.describe_geometry(polygon, full_region=full_region),
        start=start,
        end=end,
        generated_at=datetime.now(UTC),
        region_label=region_label,
    )
    text = "".join(head) + hotspots_csv.csv_header_row()
    text += hotspots_csv.rows_footer(hotspots_csv.MAX_EXPORT_ROWS)
    return len(text.encode("utf-8"))


def estimate_export(
    store: DataStore,
    polygon: BaseGeometry,
    start: date,
    end: date,
    *,
    avg_bytes_per_row: float,
    header: int,
    limit: int | None = None,
) -> HotspotEstimateOut:
    """Row count and approximate file size of a hotspot export.

    The rows come from `hotspots_csv.count_hotspot_rows`, the selection the export streams, so
    the estimate rows equal the exported rows. `approx_bytes = rows * avg + header`. When
    `avg_bytes_per_row` is 0 (not measured in the config), `FALLBACK_CSV_AVG_BYTES_PER_ROW` is used.
    """
    max_rows = hotspots_csv.MAX_EXPORT_ROWS if limit is None else limit
    rows = hotspots_csv.count_hotspot_rows(store, polygon, start, end)
    average = avg_bytes_per_row if avg_bytes_per_row > 0 else FALLBACK_CSV_AVG_BYTES_PER_ROW
    return HotspotEstimateOut(
        rows=rows,
        approx_bytes=round(rows * average + header),
        over_limit=rows > max_rows,
        limit=max_rows,
    )


@router.post("/export/hotspots/estimate")
def estimate_hotspots(
    body: HotspotExportIn, config: ConfigDep, store: StoreDep
) -> HotspotEstimateOut:
    """Row count and approximate size of the hotspot CSV for an area and a date range.

    Uses the same selection as `POST /api/v1/export/hotspots`, so `rows` equals the number of
    data rows that export writes. `over_limit` is true above 2,000,000 rows; the export then
    answers 422 `export_too_large`. `approx_bytes` is approximate.

    HTTP 422 for an invalid area (`invalid_geometry`, `outside_coverage`). HTTP 503 without data.
    """
    geometry = None if body.geometry is None else body.geometry.model_dump()
    polygon, _ = resolve_area(geometry, config.region.extent)
    header = header_bytes(
        polygon,
        body.start,
        body.end,
        region_label=config.region.name,
        full_region=body.geometry is None,
    )
    return estimate_export(
        store,
        polygon,
        body.start,
        body.end,
        avg_bytes_per_row=config.csv_avg_bytes_per_row,
        header=header,
    )


def _stream(chunks: Iterator[bytes]) -> Iterator[bytes]:
    """Pass chunks through and log a failure. The error ends the response without the footer."""
    try:
        yield from chunks
    except Exception:
        logger.exception("Hotspot CSV export failed after streaming started; file is incomplete")
        raise


@router.post("/export/hotspots", response_class=StreamingResponse)
def export_hotspots(body: HotspotExportIn, config: ConfigDep, store: StoreDep) -> StreamingResponse:
    """Stream the detections of an area and a date range as a UTF-8 CSV (`text/csv`).

    The file starts with `#` comment lines (query, time convention, source, filters, raw-not-
    harmonized notes, citation), then one header row with the 16 contract columns, then one row
    per detection, and ends with `# rows: N` only when complete. Missing values are empty fields.
    A query with no detections gives the comments, the header and `# rows: 0`.

    HTTP 422 for an invalid area (`invalid_geometry`, `outside_coverage`) or more than
    2,000,000 rows (`export_too_large`, nothing is streamed). HTTP 503 without data.
    """
    geometry = None if body.geometry is None else body.geometry.model_dump()
    polygon, _ = resolve_area(geometry, config.region.extent)
    _check_size(store, polygon, body.start, body.end)

    region_label = config.region.name
    chunks = hotspots_csv.iter_hotspot_csv(
        store,
        polygon,
        body.start,
        body.end,
        geometry_description=hotspots_csv.describe_geometry(
            polygon, full_region=body.geometry is None
        ),
        region_label=region_label,
    )
    filename = export_filename(
        "hotspots",
        FULL_REGION_FILE_LABEL if body.geometry is None else CUSTOM_AREA_FILE_LABEL,
        body.start,
        body.end,
        "csv",
    )
    return StreamingResponse(
        _stream(chunks),
        media_type=CSV_MEDIA_TYPE,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )

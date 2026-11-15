"""`POST /api/v1/export/analytics`: analytics CSV (Requirements 18.1, 18.4, 18.5, 30.7).

Same query body and computation as `POST /api/v1/calendar`, written as one CSV with a row per
month and per year. Counts are cell-days (MODIS-equivalent). Days, months and years use fixed
UTC-8. Layout in `hotspots.export.analytics_csv`.
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter
from fastapi.responses import Response

from hotspots.api.deps import ConfigDep, MaskCacheDep, StoreDep
from hotspots.api.routes.calendar import resolve_area, resolve_baseline_years
from hotspots.api.schemas import QueryIn
from hotspots.api.serialize import serialize_area_result
from hotspots.areastats import compute_area_result
from hotspots.data.types import YearMonth
from hotspots.export import analytics_csv, hotspots_csv
from hotspots.export.filenames import export_filename

router = APIRouter(prefix="/api/v1", tags=["export"])

CSV_MEDIA_TYPE = "text/csv; charset=utf-8"
FULL_REGION_FILE_LABEL = "California-region"
CUSTOM_AREA_FILE_LABEL = "custom-area"


@router.post("/export/analytics", response_class=Response)
def export_analytics(
    body: QueryIn, config: ConfigDep, store: StoreDep, masks: MaskCacheDep
) -> Response:
    """Analytics of an area and a date range as a UTF-8 CSV (`text/csv`).

    One row per month and per year in the range: harmonized count, raw MODIS and raw VIIRS
    cell-days in separate columns, baseline, anomaly columns, empty `lower_bound` and
    `upper_bound`, and a `provisional` flag. The file starts with `#` metadata lines and ends
    with `# rows: N`.

    HTTP 422 for an invalid area, an area outside the region or invalid baseline years.
    HTTP 503 without data.
    """
    grid = store.grid()
    record_start = YearMonth.parse(config.record_start)
    geometry = None if body.geometry is None else body.geometry.model_dump()
    polygon, _ = resolve_area(geometry, config.region.extent)
    baseline = resolve_baseline_years(body.baseline_years, grid, record_start)
    result = serialize_area_result(
        compute_area_result(
            grid,
            polygon,
            body.start,
            body.end,
            baseline,
            mask=masks.get_mask(polygon),
            record_start=record_start,
        )
    )
    text = analytics_csv.build_analytics_csv(
        result,
        query_description=hotspots_csv.describe_geometry(
            polygon, full_region=body.geometry is None
        ),
        start=body.start,
        end=body.end,
        region_label=config.region.name,
        generated_at=datetime.now(UTC),
    )
    filename = export_filename(
        "analytics",
        FULL_REGION_FILE_LABEL if body.geometry is None else CUSTOM_AREA_FILE_LABEL,
        body.start,
        body.end,
        "csv",
    )
    return Response(
        content=text.encode("utf-8"),
        media_type=CSV_MEDIA_TYPE,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )

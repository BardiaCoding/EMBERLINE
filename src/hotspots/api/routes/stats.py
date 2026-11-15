"""`POST /api/v1/stats`: key figures and chart data for an area and a date range.

Requirements 9.1, 10.3, 16.1, 16.2, 16.3, 16.5, 16.10, 29.4.

Same body and the same area handling as `POST /api/v1/calendar` (validate, clip, select cells by
centre point through the shared mask cache). The response holds:

- `summary`: total harmonized cell-days (the sum of the yearly totals, requirement 16.10), and raw
  MODIS and raw VIIRS cell-days as two separate values that are never added;
- `current_month` and `current_year`: the month and year that contain the end of the range,
  against their baseline (the provisional month has no comparison);
- `top_months` and `top_years`: the 10 largest, without the provisional month and its year;
- `seasonal_profile`: baseline median, p10 and p90 for the 12 calendar months;
- `briefing_inputs`: the numbers behind the plain-language briefing (monthly only);
- `watch`: the monthly watch level of the latest complete month (configured `watch_threshold`),
  independent of the date range.

Counts are cell-days (MODIS-equivalent for harmonized values). Days, months and years use fixed
UTC-8. The baseline does not depend on the date range.
"""

from __future__ import annotations

from fastapi import APIRouter

from hotspots.api.deps import ConfigDep, MaskCacheDep, StoreDep
from hotspots.api.routes.calendar import resolve_area, resolve_baseline_years
from hotspots.api.schemas import QueryIn, StatsOut
from hotspots.api.serialize import serialize_stats
from hotspots.areastats import compute_area_result
from hotspots.data.types import YearMonth
from hotspots.stats import briefing_inputs, watch_level

router = APIRouter(prefix="/api/v1", tags=["stats"])


@router.post("/stats", response_model=StatsOut)
def stats(body: QueryIn, config: ConfigDep, store: StoreDep, masks: MaskCacheDep) -> StatsOut:
    """Summary figures, rankings, seasonal profile and briefing inputs for an area and range.

    A range that cuts a month is answered with the whole month (see `coverage`). A selection
    with no cell centre gives zero totals and `notice: "no_cells"`. HTTP 422 for an invalid area
    (`invalid_geometry`), an area outside the region (`outside_coverage`) or invalid baseline
    years (`invalid_baseline_years`). HTTP 503 `data_unavailable` without data.
    """
    grid = store.grid()
    record_start = YearMonth.parse(config.record_start)
    geometry = None if body.geometry is None else body.geometry.model_dump()
    polygon, clipped_percent = resolve_area(geometry, config.region.extent)
    baseline = resolve_baseline_years(body.baseline_years, grid, record_start)

    result = compute_area_result(
        grid,
        polygon,
        body.start,
        body.end,
        baseline,
        mask=masks.get_mask(polygon),
        record_start=record_start,
    )
    # `compute_area_result` always sets the series; it is the input of the briefing numbers.
    if result.series is None:
        raise RuntimeError("area result has no series")
    briefing = briefing_inputs(result, result.series, baseline)
    # Watch is monthly, for the latest complete month, and does not depend on the date range.
    watch = watch_level(result.series, result.baseline_by_month, config.watch_threshold)
    return serialize_stats(result, body.end, briefing, watch).model_copy(
        update={"clipped_percent": clipped_percent}
    )

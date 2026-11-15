"""`POST /api/v1/season`: cumulative season curves against the p10 to p90 envelope.

Requirements 21.1, 21.2, 21.3, 21.6, 21.7, 21.8, 21.10.
Same area handling as `POST /api/v1/stats`. The curves come from the zero-filled monthly series
of the whole record (the date range does not limit them). The envelope uses the season years that
lie entirely inside the baseline period, and is null with fewer than 5. The in-progress season
stops at the latest complete month and the provisional month is returned beside it. Monthly
resolution only. Counts are cell-days (MODIS-equivalent). Days, months and years use fixed UTC-8.
Season timing metrics (onset, peak, end) are deferred.
"""

from __future__ import annotations

from fastapi import APIRouter

from hotspots.api.deps import ConfigDep, MaskCacheDep, StoreDep
from hotspots.api.routes.calendar import resolve_area, resolve_baseline_years
from hotspots.api.schemas import SeasonIn, SeasonOut
from hotspots.api.serialize import serialize_season
from hotspots.areastats import compute_area_result
from hotspots.data.types import YearMonth
from hotspots.stats import season_tracker

router = APIRouter(prefix="/api/v1", tags=["season"])


@router.post("/season", response_model=SeasonOut)
def season(body: SeasonIn, config: ConfigDep, store: StoreDep, masks: MaskCacheDep) -> SeasonOut:
    """Season tracker for an area. Errors are the same as for `POST /api/v1/stats`."""
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
    if result.series is None:
        raise RuntimeError("area result has no series")
    tracker = season_tracker(result.series, baseline, body.season_start_month, body.season_year)
    return serialize_season(result, tracker).model_copy(update={"clipped_percent": clipped_percent})

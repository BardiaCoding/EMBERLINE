"""`GET /api/v1/meta`: region and data metadata (Requirements 14.1, 30.3)."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter

from hotspots.api.deps import ConfigDep, FactsDep
from hotspots.api.limitations import LIMITATIONS
from hotspots.api.schemas import ExampleArea, Extent, Geometry, MetaOut
from hotspots.constants import TIME_CONVENTION, UNIT
from hotspots.data.types import YearMonth

router = APIRouter(prefix="/api/v1", tags=["meta"])


@router.get("/meta", response_model=MetaOut)
def meta(config: ConfigDep, facts: FactsDep) -> MetaOut:
    """Region name and extent, record bounds, units, time convention, limitations.

    Values come from the app configuration and from the delivered files (read at startup).
    The extent is the measured extent of the delivered data. No claim is made about a state
    boundary. HTTP 503 `data_unavailable` when the delivered data are missing.
    """
    start = YearMonth.parse(config.record_start)
    extent = config.region.extent
    return MetaOut(
        name=config.region.name,
        extent=Extent(west=extent.west, south=extent.south, east=extent.east, north=extent.north),
        record_start=config.record_start,
        first_date=date(start.year, start.month, 1),
        latest_month=facts.latest_month,
        latest_month_incomplete=facts.latest_month_incomplete,
        latest_complete_month=facts.latest_complete_month,
        latest_detection_local_date=facts.latest_detection_local_date,
        latest_detection_utc=facts.latest_detection_utc,
        time_convention=TIME_CONVENTION,
        unit=UNIT,
        watch_threshold=config.watch_threshold,
        limitations=list(LIMITATIONS),
        example_areas=[
            ExampleArea(name=a.name, description=a.description, geometry=Geometry(**a.geometry))
            for a in config.example_areas
        ],
        bounds_available=False,
    )

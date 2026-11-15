"""`POST /api/v1/recent`: raw detections of the last 7 local days (Requirement 20.1 to 20.6, 20.8).

The delivered data have no daily harmonized counts, so this view shows filtered RAW detections
only (not harmonized, not comparable across sensors). The window is the 7 consecutive local days
(fixed UTC-8) ending on the local date of the latest detection in `detections_harmonized.parquet`
(DEFAULT (confirm)). The selection rule is the one of the CSV export (bbox and date pre-filter,
then point in polygon). The response holds per-day counts (7 entries, zeros included), points
(capped at 5,000, newest kept, with the number omitted), the latest detection time in UTC, the
data age in whole days and the monthly `watch` object (never a 7-day watch level).

The 10 second budget of Requirement 20.6 is enforced by the client, which gives up and shows an
error after 10 seconds.
"""

from __future__ import annotations

import calendar as _calendar
from datetime import UTC, date, datetime
from typing import Final

from fastapi import APIRouter
from pydantic import Field
from shapely.geometry.base import BaseGeometry

from hotspots.api import recent as rc
from hotspots.api.deps import ConfigDep, MaskCacheDep, StoreDep
from hotspots.api.routes.calendar import resolve_area, resolve_baseline_years
from hotspots.api.schemas import ApiModel, Geometry, WatchOut
from hotspots.api.serialize import serialize_watch
from hotspots.areastats import compute_area_result
from hotspots.constants import TIME_CONVENTION
from hotspots.data import DataStore
from hotspots.data.types import YearMonth
from hotspots.export import hotspots_csv
from hotspots.stats import watch_level

router = APIRouter(prefix="/api/v1", tags=["recent"])

RECENT_LABEL: Final[str] = "raw, not harmonized, not comparable across sensors"
RECENT_UNIT: Final[str] = "detections (raw)"
STALE_AFTER_DAYS: Final[int] = 3
"""The client shows a stale-data notice when `data_age_days` is above this. DEFAULT (confirm)."""


class RecentIn(ApiModel):
    """Recent view query. `geometry` is null for the full region."""

    geometry: Geometry | None = None
    baseline_years: tuple[int, int] | None = None
    """Optional user baseline for the monthly `watch` object (first and last year)."""


class RecentDay(ApiModel):
    """Raw detections of one local day."""

    date: date
    """Local date (`acq_date_local`), fixed UTC-8."""
    count: int = Field(ge=0)


class RecentPoint(ApiModel):
    """One filtered raw detection."""

    lat: float
    lon: float
    satellite: str
    source: str | None = None
    """As delivered. No provisional or near-real-time label is added."""
    local_date: date
    acq_datetime_utc: datetime
    frp: float | None = None
    """Fire radiative power in MW, null when missing."""


class RecentOut(ApiModel):
    """Response of `POST /api/v1/recent`. All counts are raw detections, not harmonized."""

    window_start: date
    window_end: date
    """Local date of the latest detection in the delivered data."""
    days: list[RecentDay]
    total: int
    points: list[RecentPoint]
    points_omitted: int
    max_points: int
    latest_utc: datetime
    """Latest `acq_datetime_utc` in the delivered data (UTC)."""
    data_age_days: int
    stale_after_days: int = STALE_AFTER_DAYS
    watch: WatchOut | None = None
    label: str = RECENT_LABEL
    unit: str = RECENT_UNIT
    time_convention: str = TIME_CONVENTION


def _now_utc() -> datetime:
    """The current UTC time. A separate function so tests can replace it."""
    return datetime.now(UTC)


def _collect(
    store: DataStore, polygon: BaseGeometry, first: date, last: date
) -> tuple[list[date], list[RecentPoint]]:
    """Local dates of every detection in the area and the points of all of them."""
    dates: list[date] = []
    points: list[RecentPoint] = []
    for table in hotspots_csv.iter_hotspot_batches(store, polygon, first, last):
        if table.num_rows == 0:
            continue
        cols = {
            name: table.column(name).to_pylist()
            for name in (
                "lat",
                "lon",
                "satellite",
                "source",
                "acq_date_local",
                "acq_datetime_utc",
                "frp",
            )
        }
        for i in range(table.num_rows):
            frp = cols["frp"][i]
            utc = cols["acq_datetime_utc"][i]
            dates.append(cols["acq_date_local"][i])
            points.append(
                RecentPoint(
                    lat=float(cols["lat"][i]),
                    lon=float(cols["lon"][i]),
                    satellite=str(cols["satellite"][i]),
                    source=None if cols["source"][i] is None else str(cols["source"][i]),
                    local_date=cols["acq_date_local"][i],
                    acq_datetime_utc=utc if utc.tzinfo else utc.replace(tzinfo=UTC),
                    frp=None if frp is None or frp != frp else float(frp),
                )
            )
    return dates, points


@router.post("/recent", response_model=RecentOut)
def recent(body: RecentIn, config: ConfigDep, store: StoreDep, masks: MaskCacheDep) -> RecentOut:
    """Raw detections of the last 7 local days for an area.

    `days` always has 7 entries (zeros included). `points` holds at most 5,000 detections, the
    newest first, and `points_omitted` says how many were left out. Detections are filtered raw
    detections, not harmonized. The `watch` object is the monthly one of `/stats`.

    HTTP 422 for an invalid area (`invalid_geometry`, `outside_coverage`) or invalid baseline
    years. HTTP 503 without data.
    """
    geometry = None if body.geometry is None else body.geometry.model_dump()
    polygon, _ = resolve_area(geometry, config.region.extent)

    latest_local = store.detections_latest_local_date()
    latest_utc = store.detections_latest_utc()
    days = rc.window_days(latest_local)
    dates, points = _collect(store, polygon, days[0], days[-1])
    counts = rc.daily_counts(days, dates)

    points.sort(key=lambda p: p.acq_datetime_utc, reverse=True)
    kept = points[: rc.MAX_RECENT_POINTS]

    grid = store.grid()
    record_start = YearMonth.parse(config.record_start)
    baseline = resolve_baseline_years(body.baseline_years, grid, record_start)
    latest_month = store.latest_month()
    result = compute_area_result(
        grid,
        polygon,
        date(record_start.year, record_start.month, 1),
        date(
            latest_month.year,
            latest_month.month,
            _calendar.monthrange(latest_month.year, latest_month.month)[1],
        ),
        baseline,
        mask=masks.get_mask(polygon),
        record_start=record_start,
    )
    watch = None
    if result.series is not None:
        watch = serialize_watch(
            watch_level(result.series, result.baseline_by_month, config.watch_threshold)
        )

    return RecentOut(
        window_start=days[0],
        window_end=days[-1],
        days=[RecentDay(date=d, count=c) for d, c in zip(days, counts, strict=True)],
        total=len(points),
        points=kept,
        points_omitted=len(points) - len(kept),
        max_points=rc.MAX_RECENT_POINTS,
        latest_utc=latest_utc,
        data_age_days=rc.data_age_days(latest_local, _now_utc()),
        watch=watch,
    )

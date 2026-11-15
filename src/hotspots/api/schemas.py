"""API models (pydantic v2), mirrored to TypeScript by `openapi-typescript`.

Every model forbids unknown fields (`extra="forbid"`). Geometry bodies are limited to
`MAX_VERTICES` vertices (counted across all rings and parts, Requirement 13.4) and request
bodies to `MAX_BODY_BYTES` (enforced in `hotspots.api.errors`). All coordinates are EPSG:4326
(lon, lat) in decimal degrees. Counts are cell-days (MODIS-equivalent) unless a field says
raw. Days, months and years use fixed UTC-8.

Rounding (one decimal for harmonized values, integers for raw counts) happens in
`hotspots.api.serialize`, not here.
"""

from __future__ import annotations

import math
from datetime import date, datetime
from typing import Any, Final, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationInfo,
    field_validator,
    model_validator,
)

MAX_BODY_BYTES: Final[int] = 6 * 1024 * 1024
"""Largest accepted request body (6 MB)."""

MAX_VERTICES: Final[int] = 1000
"""Most vertices a geometry may have, counted across all rings and all parts."""

_MIN_YEAR: Final[int] = 1900
_MAX_YEAR: Final[int] = 2200


class ApiModel(BaseModel):
    """Base for every API model: unknown fields are rejected."""

    model_config = ConfigDict(extra="forbid")


# --- geometry ----------------------------------------------------------------------------


def _is_number(value: object) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)


def _check_position(position: object) -> None:
    if not isinstance(position, list) or len(position) not in (2, 3):
        raise ValueError("each position must be a list of [longitude, latitude]")
    if not all(_is_number(v) for v in position):
        raise ValueError("coordinates must be finite numbers")
    lon, lat = float(position[0]), float(position[1])
    if not -180.0 <= lon <= 180.0:
        raise ValueError(f"longitude must be between -180 and 180, got {lon:g}")
    if not -90.0 <= lat <= 90.0:
        raise ValueError(f"latitude must be between -90 and 90, got {lat:g}")


def _count_ring_vertices(ring: object) -> int:
    if not isinstance(ring, list):
        raise ValueError("each ring must be a list of positions")
    for position in ring:
        _check_position(position)
    return len(ring)


def _count_polygon_vertices(polygon: object) -> int:
    if not isinstance(polygon, list) or not polygon:
        raise ValueError("a polygon must be a non-empty list of rings")
    return sum(_count_ring_vertices(ring) for ring in polygon)


class Geometry(ApiModel):
    """GeoJSON Polygon or MultiPolygon in EPSG:4326 (lon, lat).

    This model checks structure, coordinate ranges and the vertex limit only. Self-intersection,
    zero area, clipping and region coverage are checked by the selection module.
    """

    type: Literal["Polygon", "MultiPolygon"]
    coordinates: list[Any]

    @field_validator("coordinates")
    @classmethod
    def _check_coordinates(cls, value: list[Any], info: ValidationInfo) -> list[Any]:
        kind = info.data.get("type")
        if kind is None:
            return value  # `type` already failed; report only that error
        if kind == "Polygon":
            count = _count_polygon_vertices(value)
        else:
            if not value:
                raise ValueError("a MultiPolygon must be a non-empty list of polygons")
            count = sum(_count_polygon_vertices(polygon) for polygon in value)
        if count > MAX_VERTICES:
            raise ValueError(
                f"geometry has {count} vertices; the limit is {MAX_VERTICES} "
                "(counted across all rings and parts)"
            )
        return value


class ExampleArea(ApiModel):
    """A named example area read from the app configuration (Requirement 1.9)."""

    name: str
    description: str
    geometry: Geometry


class Extent(ApiModel):
    """Region extent in EPSG:4326 degrees."""

    west: float
    south: float
    east: float
    north: float


# --- request -----------------------------------------------------------------------------


class QueryIn(ApiModel):
    """Calendar query. `geometry` is null for the full region."""

    geometry: Geometry | None = None
    start: date
    end: date
    baseline_years: tuple[int, int] | None = None
    """Optional user baseline, first and last year (inclusive). Limits are checked later."""

    @field_validator("end")
    @classmethod
    def _end_not_before_start(cls, value: date, info: ValidationInfo) -> date:
        start = info.data.get("start")
        if start is not None and value < start:
            raise ValueError("end must not be before start")
        return value

    @field_validator("baseline_years")
    @classmethod
    def _baseline_years_ordered(cls, value: tuple[int, int] | None) -> tuple[int, int] | None:
        if value is None:
            return None
        first, last = value
        if not (_MIN_YEAR <= first <= _MAX_YEAR and _MIN_YEAR <= last <= _MAX_YEAR):
            raise ValueError(f"years must be between {_MIN_YEAR} and {_MAX_YEAR}")
        if first > last:
            raise ValueError("the first baseline year must not be after the last")
        return value


# --- response ----------------------------------------------------------------------------


class Anomaly(ApiModel):
    """Difference of a value from its baseline (Requirement 10)."""

    absolute: float
    percent: float | None = None
    percent_text: str | None = None
    zscore: float | None = None
    percentile_rank: float
    baseline_start_year: int
    baseline_end_year: int
    n_years: int


class MonthRow(ApiModel):
    """One calendar month of an area. Counts are cell-days; FRP is MW (area total)."""

    year: int
    month: int = Field(ge=1, le=12)
    harmonized: float
    """Cell-days, MODIS-equivalent."""
    raw_modis: int
    raw_viirs: int
    """Raw cell-days per sensor family. Never added to each other."""
    frp_sum_mw: float | None = None
    source_flag: str | None = None
    calib_model: str | None = None
    provenance: str | None = None
    provisional: bool = False
    lower_bound: float | None = None
    upper_bound: float | None = None
    """Uncertainty interval (Requirement 7, deferred): always null for now."""
    anomaly: Anomaly | None = None


class YearRow(ApiModel):
    """One calendar year of an area (sum over the months in the range)."""

    year: int
    harmonized: float
    raw_modis: int
    raw_viirs: int
    frp_sum_mw: float | None = None
    n_months: int | None = None
    """Months of this year inside the result (12 for a full year)."""
    provisional: bool = False
    anomaly: Anomaly | None = None


class BaselineStats(ApiModel):
    """Baseline statistics over the zero-filled series."""

    median: float
    p10: float
    p90: float
    mean: float
    std: float | None = None
    n_years: int


class BaselineRow(BaselineStats):
    """Baseline for one calendar month (1 to 12)."""

    month: int = Field(ge=1, le=12)


class Coverage(ApiModel):
    """Months of the record that the result covers. DEFAULT (confirm): fields may change in 9.3."""

    first_month: str | None = None
    last_month: str | None = None
    n_months: int = 0
    requested_start: date | None = None
    requested_end: date | None = None
    starts_mid_month: bool = False
    ends_mid_month: bool = False
    """Statistics cover the whole month when the range starts or ends partway through it."""
    before_record: bool = False
    after_latest: bool = False
    """The range extends before the record start or after the latest month of the grid."""


class CalendarOut(ApiModel):
    """Response of `POST /api/v1/calendar`."""

    months: list[MonthRow]
    years: list[YearRow]
    baseline_by_month: list[BaselineRow]
    baseline_year: BaselineStats | None = None
    coverage: Coverage
    n_cells: int
    notice: str | None = None
    provisional_months: list[str] = Field(default_factory=list)
    """Provisional months as `YYYY-MM`."""
    clipped_percent: float | None = None
    """Share (0 to 100, one decimal) of the submitted area removed by clipping to the region
    extent. 0 when the area lies inside it, null when no geometry was sent (full region)."""
    area_km2: float | None = None
    """Geodesic area in km2 of the selection after clipping to the region extent (the full
    region rectangle when no geometry was sent), rounded to one decimal. Null only when the
    area is not known. Used by the front end for the per-1000 km2 comparison."""


class StatsSummary(ApiModel):
    """Totals over the months of the date range (Requirement 16.1). Units: cell-days."""

    total_harmonized: float
    """Sum of the yearly totals as shown (each rounded to one decimal), MODIS-equivalent
    cell-days. Equals the sum of the yearly bars (Requirement 16.10)."""
    raw_modis: int
    raw_viirs: int
    """Raw cell-days per sensor family. Two separate values, never added."""
    frp_sum_mw: float | None = None
    """FRP area total in MW (sum of `frp_sum`), null when no FRP value exists."""
    n_months: int
    includes_provisional: bool = False
    """True when the range contains the provisional month (its count to date is in the totals)."""


class CurrentMonthOut(ApiModel):
    """The calendar month that contains the end of the date range, against its baseline."""

    year: int
    month: int = Field(ge=1, le=12)
    harmonized: float
    provisional: bool = False
    baseline_median: float | None = None
    """Baseline median of this calendar month. Null for the provisional month (no comparison)
    or when no baseline year exists."""
    baseline_n_years: int = 0
    anomaly: Anomaly | None = None


class CurrentYearOut(ApiModel):
    """The calendar year that contains the end of the date range, against the yearly baseline."""

    year: int
    harmonized: float
    """Total of the months of this year inside the result."""
    n_months: int
    """Months of this year in the result (12 for a full year)."""
    provisional: bool = False
    baseline_median: float | None = None
    """Median of the baseline yearly totals. Null when the year is provisional or partial."""
    baseline_n_years: int = 0
    percentile_rank: float | None = None
    """Percentile rank (0 to 100) of the year total among the baseline yearly totals."""
    anomaly: Anomaly | None = None


class RankedMonthOut(ApiModel):
    year: int
    month: int = Field(ge=1, le=12)
    harmonized: float


class RankedYearOut(ApiModel):
    year: int
    harmonized: float
    n_months: int | None = None
    """Months of this year in the query. Fewer than 12 is a partial total."""


class SeasonalPointOut(ApiModel):
    """Baseline of one calendar month. Statistics are null when no baseline year exists."""

    month: int = Field(ge=1, le=12)
    median: float | None = None
    p10: float | None = None
    p90: float | None = None
    n_years: int


class RecordRankOut(ApiModel):
    """Rank of the latest complete month among the same calendar month of the baseline."""

    month: str
    """`YYYY-MM`."""
    harmonized: float
    rank: int
    n_years: int
    percentile: float
    since_year: int


class YearToDateOut(ApiModel):
    """Cumulative count of the season year to date against the median cumulative."""

    season_year: int
    season_start_month: int
    month_of_season: int
    through: str
    """`YYYY-MM`."""
    count: float
    median_cumulative: float | None = None
    n_seasons: int
    percent_difference: float | None = None
    direction: Literal["above", "below", "equal"] | None = None


class BriefingInputsOut(ApiModel):
    """Numbers behind the plain-language briefing. Monthly only (Requirement 23)."""

    latest_complete: str | None = None
    latest_complete_harmonized: float | None = None
    short_record: bool
    record_rank: RecordRankOut | None = None
    year_to_date: YearToDateOut | None = None
    peak_months: list[int]
    baseline_all_zero: bool
    provisional_months: list[str]


class WatchOut(ApiModel):
    """Watch level of the latest complete month (monthly, independent of the Date_Range).

    `count` and `median` are MODIS-equivalent cell-days. `percentile` is the mid-rank percentile
    (0 to 100) of `count` among the baseline years of that calendar month, `period` is the
    evaluated month as `YYYY-MM`. `provisional` is true when the record also has an incomplete
    latest month: it is reported in `provisional_month` and `provisional_count` (count to date)
    and is never evaluated. For "Not available", `reason` says why.
    """

    level: Literal["Above normal", "Within normal range", "Not available"] | None = None
    count: float | None = None
    median: float | None = None
    percentile: float | None = None
    period: str | None = None
    baseline_start: int | None = None
    baseline_end: int | None = None
    n_years: int | None = None
    provisional: bool | None = None
    provisional_month: str | None = None
    provisional_count: float | None = None
    reason: str | None = None
    threshold: float | None = None


class StatsOut(ApiModel):
    """Response of `POST /api/v1/stats`: key figures and chart data for an area and range."""

    summary: StatsSummary
    current_month: CurrentMonthOut | None = None
    current_year: CurrentYearOut | None = None
    top_months: list[RankedMonthOut]
    top_years: list[RankedYearOut]
    seasonal_profile: list[SeasonalPointOut]
    briefing_inputs: BriefingInputsOut
    watch: WatchOut | None = None
    coverage: Coverage
    n_cells: int
    notice: str | None = None
    provisional_months: list[str] = Field(default_factory=list)
    clipped_percent: float | None = None


class Bbox(ApiModel):
    """Rectangle in EPSG:4326 degrees. Ordering and ranges are checked by the route."""

    west: float = Field(allow_inf_nan=False)
    south: float = Field(allow_inf_nan=False)
    east: float = Field(allow_inf_nan=False)
    north: float = Field(allow_inf_nan=False)


class CircleIn(ApiModel):
    """Circle in EPSG:4326 degrees and km. Ranges are checked by the selection module."""

    lat: float = Field(allow_inf_nan=False)
    lon: float = Field(allow_inf_nan=False)
    radius_km: float = Field(allow_inf_nan=False)


class NormalizeIn(ApiModel):
    """Body of `POST /api/v1/selection/normalize`.

    Exactly one of `geometry` (Polygon or MultiPolygon), `bbox`, `circle` or `geojson` (the
    content of an uploaded GeoJSON file: FeatureCollection, Feature or geometry; the route
    unions its polygon features and counts the others as ignored).
    """

    geometry: Geometry | None = None
    bbox: Bbox | None = None
    circle: CircleIn | None = None
    geojson: dict[str, Any] | None = None

    @model_validator(mode="after")
    def _exactly_one(self) -> NormalizeIn:
        given = [v is not None for v in (self.geometry, self.bbox, self.circle, self.geojson)]
        if sum(given) != 1:
            raise ValueError("give exactly one of geometry, bbox, circle or geojson")
        return self


class NormalizeOut(ApiModel):
    """Selection after validation and clipping to the region extent."""

    geometry: Geometry
    """Clipped polygon, coordinates rounded to 6 decimals (EPSG:4326)."""
    clipped: bool
    clipped_percent: float
    """Share (0 to 100, one decimal) of the submitted area removed by clipping."""
    n_cells: int
    """Cells whose centre lies inside the clipped area."""
    notice: str | None = None
    """`no_cells` when the area holds no cell centre."""
    ignored_features: int = 0
    """GeoJSON upload only: features or geometries that are not polygons and were left out."""


class MetaOut(ApiModel):
    """Response of `GET /api/v1/meta`."""

    name: str
    extent: Extent
    record_start: str
    first_date: date
    latest_month: str
    latest_month_incomplete: bool
    latest_complete_month: str | None = None
    latest_detection_local_date: date | None = None
    latest_detection_utc: datetime | None = None
    time_convention: str
    unit: str
    watch_threshold: float
    limitations: list[str]
    example_areas: list[ExampleArea] = Field(default_factory=list)
    bounds_available: bool = False


# --- errors ------------------------------------------------------------------------------


class FieldError(ApiModel):
    """One invalid field and why."""

    field: str
    reason: str


class ErrorBody(ApiModel):
    code: str
    message: str
    fields: list[FieldError] = Field(default_factory=list)
    request_id: str


class ErrorOut(ApiModel):
    """The one error envelope used by every error response."""

    error: ErrorBody


# --- hotspot CSV export ------------------------------------------------------------------


class HotspotExportIn(ApiModel):
    """Hotspot CSV query. `geometry` is null for the full region. Dates are local (UTC-8)."""

    geometry: Geometry | None = None
    start: date
    end: date
    """Both ends are included."""

    @field_validator("end")
    @classmethod
    def _end_not_before_start(cls, value: date, info: ValidationInfo) -> date:
        start = info.data.get("start")
        if start is not None and value < start:
            raise ValueError("end must not be before start")
        return value


class HotspotEstimateOut(ApiModel):
    """Size estimate of a hotspot CSV export. Same query body as `HotspotExportIn`."""

    rows: int
    """Data rows the export would write (detections, same selection as the export)."""
    approx_bytes: int
    """`rows * csv_avg_bytes_per_row + header_bytes`, rounded. Approximate."""
    over_limit: bool
    """True when `rows` is more than `limit`; the export then answers 422 `export_too_large`."""
    limit: int
    """Most data rows one export may have."""


# --- season tracker (requirement 21) -----------------------------------------------------
class SeasonIn(QueryIn):
    """Season tracker query. The date range is accepted for consistency with the other routes
    but does not limit the curves: a season year always runs over its 12 months."""

    season_start_month: int = Field(default=1, ge=1, le=12)
    """First calendar month of a season year (1 to 12, default January)."""
    season_year: int | None = Field(default=None, ge=_MIN_YEAR, le=_MAX_YEAR)
    """Season year to select (the year in which it starts). Null selects the season of the
    latest complete month."""


class SeasonCurveOut(ApiModel):
    """Cumulative harmonized cell-days of one season year, by month-of-season from 1."""

    season_year: int
    cumulative: list[float]
    complete: bool


class SeasonEnvelopeOut(ApiModel):
    """p10, median and p90 of the cumulative counts at one month-of-season."""

    month_of_season: int
    calendar_month: int
    p10: float
    median: float
    p90: float


class SeasonOut(ApiModel):
    """Response of `POST /api/v1/season`. Monthly resolution, MODIS-equivalent cell-days,
    fixed UTC-8. The provisional month is never in a curve or the envelope."""

    season_start_month: int
    season_year: int | None = None
    selected: list[float]
    through: str | None = None
    """`YYYY-MM`, the last month of the selected curve."""
    count: float | None = None
    median_cumulative: float | None = None
    percent_of_median: float | None = None
    """100 x count / median at `through`. Null when the median is 0 or there is no envelope."""
    envelope: list[SeasonEnvelopeOut] | None = None
    n_envelope_years: int
    curves: list[SeasonCurveOut]
    provisional_month: str | None = None
    provisional_count: float | None = None
    reason: str | None = None
    available_season_years: list[int]
    coverage: Coverage
    n_cells: int
    notice: str | None = None
    clipped_percent: float | None = None

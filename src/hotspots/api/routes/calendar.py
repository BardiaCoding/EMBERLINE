"""`POST /api/v1/calendar`: monthly and yearly counts, baselines and anomalies for an area.

Requirements 9.1, 9.2, 9.6, 9.8, 15.1, 16.1, 29.5.

Flow: validate the geometry (422 with a reason), clip it to the region extent, select cells by
centre point through the shared `SelectionMaskCache`, assemble the result with
`compute_area_result` and round only in `serialize_area_result`.

- No `geometry` means the full region (the extent rectangle).
- Dates are typed (`datetime.date`) and geometry is a typed GeoJSON model, so no user string
  reaches a query. The area statistics run on in-memory arrays and there is no SQL here.
- Counts are cell-days (MODIS-equivalent for `harmonized`). Days, months and years use fixed UTC-8.
- A range that cuts a month is answered with the whole month (see `coverage`).
"""

from __future__ import annotations

from collections import Counter

from fastapi import APIRouter
from shapely.geometry import box as shapely_box

from hotspots.api.deps import ConfigDep, MaskCacheDep, StoreDep
from hotspots.api.errors import ApiValidationError
from hotspots.api.schemas import CalendarOut, FieldError, QueryIn
from hotspots.api.serialize import PERCENT_DECIMALS, round_half_up, serialize_area_result
from hotspots.areastats import BaselineYearsError, compute_area_result, validate_baseline_years
from hotspots.config import Extent
from hotspots.data import GridArrays
from hotspots.data.types import YearMonth
from hotspots.geometry import (
    ERROR_CODE_INVALID_GEOMETRY,
    AreaGeometry,
    clip_to_extent,
    geodesic_area_km2,
    validate_selection,
)

router = APIRouter(prefix="/api/v1", tags=["calendar"])

INVALID_BASELINE_CODE = "invalid_baseline_years"
BASELINE_FIELD = "baseline_years"


def resolve_area(
    geometry: dict[str, object] | None, extent: Extent
) -> tuple[AreaGeometry, float | None]:
    """Validated and clipped selection polygon and the removed share (percent).

    `geometry=None` is the full region and gives `(extent rectangle, None)`.

    Raises:
        ApiValidationError: `invalid_geometry` or `outside_coverage` with `fields` holding one
            `{field, reason}` per problem. Submitted coordinates are not echoed.
    """
    if geometry is None:
        return shapely_box(extent.west, extent.south, extent.east, extent.north), None
    validation = validate_selection(geometry, extent=extent)
    if not validation.ok or validation.polygon is None:
        issues = validation.issues
        raise ApiValidationError(
            validation.error_code or ERROR_CODE_INVALID_GEOMETRY,
            issues[0].message if issues else "The area is not valid.",
            [FieldError(field=i.field, reason=i.reason) for i in issues],
        )
    clip = clip_to_extent(validation.polygon, extent)
    if clip.geometry is None:  # defensive: validation already requires an overlap
        raise ApiValidationError(
            "outside_coverage",
            "The area is outside the California region.",
            [FieldError(field="geometry", reason="outside_extent")],
        )
    return clip.geometry, round_half_up(clip.clipped_percent, PERCENT_DECIMALS)


def complete_record_years(grid: GridArrays, record_start: YearMonth) -> list[int]:
    """Calendar years in which all 12 months are in the record and complete."""
    per_year: Counter[int] = Counter(
        ym.year
        for ym, incomplete in zip(grid.months, grid.incomplete, strict=True)
        if ym.index >= record_start.index and not incomplete
    )
    return sorted(year for year, n in per_year.items() if n == 12)


def resolve_baseline_years(
    baseline_years: tuple[int, int] | None, grid: GridArrays, record_start: YearMonth
) -> tuple[int, ...] | None:
    """Expand and validate a user baseline `(first, last)`. None keeps the default baseline.

    Raises:
        ApiValidationError: 422 `invalid_baseline_years` whose message names the violated limit
            (5 to 30 complete in-record years).
    """
    if baseline_years is None:
        return None
    first, last = baseline_years
    try:
        return validate_baseline_years(
            range(first, last + 1), complete_record_years(grid, record_start)
        )
    except BaselineYearsError as exc:
        raise ApiValidationError(
            INVALID_BASELINE_CODE,
            str(exc),
            [FieldError(field=BASELINE_FIELD, reason=str(exc))],
        ) from None


@router.post("/calendar", response_model=CalendarOut)
def calendar(body: QueryIn, config: ConfigDep, store: StoreDep, masks: MaskCacheDep) -> CalendarOut:
    """Calendar data for an area and a date range.

    Returns one row per in-record month overlapping the range (harmonized cell-days rounded to
    one decimal, raw MODIS and raw VIIRS cell-days as integers), one row per year, the baseline
    per calendar month and per year, the coverage, `n_cells` and `notice`. A selection with no
    cell centre gives all-zero months and `notice: "no_cells"`. The provisional month is flagged
    and has no anomaly. `clipped_percent` reports the share clipped to the region extent and
    `area_km2` the geodesic area of the clipped selection.

    HTTP 422 for an invalid area (`invalid_geometry`), an area outside the region
    (`outside_coverage`) or invalid baseline years. HTTP 503 `data_unavailable` without data.
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
    return serialize_area_result(result).model_copy(
        update={
            "clipped_percent": clipped_percent,
            "area_km2": round_half_up(geodesic_area_km2(polygon), 1),
        }
    )

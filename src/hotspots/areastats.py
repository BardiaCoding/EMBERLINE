"""Area statistics: pure functions over arrays and geometries, no I/O.

Cell selection follows design section 8.1. Coordinates are EPSG:4326 degrees
(x = longitude, y = latitude).
"""

from __future__ import annotations

import math
from collections.abc import Collection, Iterable, Sequence
from dataclasses import dataclass, field
from datetime import date, timedelta

import numpy as np
import shapely
from numpy.typing import ArrayLike, NDArray
from shapely.geometry.base import BaseGeometry

from hotspots.data.grid import GridArrays
from hotspots.data.types import YearMonth

# Fixed infinitesimal shift toward north-east, applied only to centres that lie
# exactly on the polygon boundary (design section 8.1, "simulation of simplicity").
BOUNDARY_SHIFT_LON: float = 1e-9
BOUNDARY_SHIFT_LAT: float = 1e-12


def select_cells(
    centre_lat: ArrayLike,
    centre_lon: ArrayLike,
    polygon: BaseGeometry,
    excluded_mask: ArrayLike | None = None,
) -> NDArray[np.bool_]:
    """Select cells whose centre point lies inside ``polygon`` (half-open rule).

    A centre strictly inside is selected and a centre strictly outside is not.
    A centre exactly on an edge or vertex is decided by the perturbed point
    ``(lon + 1e-9, lat + 1e-12)`` being strictly inside. For an axis-aligned
    rectangle this equals ``[west, east) x [south, north)``. Cells flagged in
    ``excluded_mask`` are never selected. The result depends only on the
    centre points, the polygon and the mask.

    Args:
        centre_lat: Cell centre latitudes (degrees, EPSG:4326).
        centre_lon: Cell centre longitudes (degrees, EPSG:4326).
        polygon: Shapely Polygon or MultiPolygon.
        excluded_mask: Optional boolean array, True for cells to exclude.

    Returns:
        Boolean array with the shape of the centre arrays.
    """
    lat = np.asarray(centre_lat, dtype=np.float64)
    lon = np.asarray(centre_lon, dtype=np.float64)
    if lat.shape != lon.shape:
        raise ValueError("centre_lat and centre_lon must have the same shape")

    if not shapely.is_prepared(polygon):
        shapely.prepare(polygon)

    inside = np.asarray(shapely.contains_xy(polygon, lon, lat), dtype=np.bool_)
    on_boundary = np.asarray(shapely.intersects_xy(polygon, lon, lat), dtype=np.bool_) & ~inside

    selected = inside
    if on_boundary.any():
        shifted = np.asarray(
            shapely.contains_xy(
                polygon,
                lon[on_boundary] + BOUNDARY_SHIFT_LON,
                lat[on_boundary] + BOUNDARY_SHIFT_LAT,
            ),
            dtype=np.bool_,
        )
        selected = inside.copy()
        selected[on_boundary] = shifted

    if excluded_mask is not None:
        excluded = np.asarray(excluded_mask, dtype=np.bool_)
        if excluded.shape != selected.shape:
            raise ValueError("excluded_mask must have the same shape as the centres")
        selected = selected & ~excluded

    return selected


@dataclass(frozen=True)
class ProvisionalMonth:
    """An incomplete (provisional) month. Never part of the zero-filled series or a baseline.

    Counts are MODIS-equivalent cell-days (`harmonized`) and raw cell-days per sensor family.
    `frp_sum_mw` is in MW, `None` when no FRP value exists for the area in that month.
    """

    month: YearMonth
    harmonized: float
    raw_modis: int
    raw_viirs: int
    frp_sum_mw: float | None


@dataclass(frozen=True)
class ZeroFilledSeries:
    """Area series over in-record complete months, one entry per month in `months`.

    `harmonized` is MODIS-equivalent cell-days, `raw_modis` and `raw_viirs` are raw cell-days kept
    as two separate series (never added). `frp_sum_mw` is the sum of `frp_sum` in MW, NaN where
    no selected cell has an FRP value in that month (render as a dash, never as 0).
    Months are on the fixed UTC-8 local-day convention.
    """

    months: list[YearMonth]
    harmonized: NDArray[np.float64]
    raw_modis: NDArray[np.int64]
    raw_viirs: NDArray[np.int64]
    frp_sum_mw: NDArray[np.float64]
    provisional: tuple[ProvisionalMonth, ...] = ()


def zero_filled_series(
    harm: NDArray[np.float64],
    mask: ArrayLike,
    months: Sequence[YearMonth],
    complete: ArrayLike,
    record_start: YearMonth,
    *,
    raw_modis: NDArray[np.integer],
    raw_viirs: NDArray[np.integer],
    frp_sum: NDArray[np.float64],
    frp_known: NDArray[np.bool_],
) -> ZeroFilledSeries:
    """Area series over every in-record complete month, zero-filled (design section 8.2).

    The matrices have shape ``(n_cells, n_months)`` with one column per entry of ``months``.
    A month with no activity in the area is 0.0 (a missing sparse row means zero cell-days).
    Months before ``record_start`` are dropped. Months with ``complete`` False go to
    ``provisional`` and never enter the series. Raw MODIS and raw VIIRS are summed
    separately. FRP is summed, NaN where no selected cell has FRP data in the month.

    Args:
        harm: ``count_harmonized`` per cell and month (MODIS-equivalent cell-days).
        mask: Boolean selection per cell, from `select_cells`.
        months: Year-month of each column.
        complete: Boolean per month, True when the month is complete.
        record_start: First month of the record (``RECORD_START``).
        raw_modis: Raw MODIS cell-days per cell and month.
        raw_viirs: Raw VIIRS cell-days per cell and month.
        frp_sum: FRP sum (MW) per cell and month, 0 where unknown.
        frp_known: True where ``frp_sum`` is a real value.
    """
    sel = np.asarray(mask, dtype=np.bool_)
    comp = np.asarray(complete, dtype=np.bool_)
    n_cells, n_months = harm.shape
    if sel.shape != (n_cells,):
        raise ValueError("mask must have one entry per cell")
    if len(months) != n_months or comp.shape != (n_months,):
        raise ValueError("months and complete must have one entry per month column")
    for name, arr in (
        ("raw_modis", raw_modis),
        ("raw_viirs", raw_viirs),
        ("frp_sum", frp_sum),
        ("frp_known", frp_known),
    ):
        if arr.shape != harm.shape:
            raise ValueError(f"{name} must have the same shape as harm")

    harm_sum = harm[sel].sum(axis=0, dtype=np.float64)
    modis_sum = raw_modis[sel].sum(axis=0, dtype=np.int64)
    viirs_sum = raw_viirs[sel].sum(axis=0, dtype=np.int64)
    frp_total = frp_sum[sel].sum(axis=0, dtype=np.float64)
    frp_any = frp_known[sel].any(axis=0)
    frp_total = np.where(frp_any, frp_total, np.nan)

    start = record_start.index
    in_record = np.array([m.index >= start for m in months], dtype=np.bool_)
    keep = np.flatnonzero(in_record & comp)
    provisional = tuple(
        ProvisionalMonth(
            month=months[j],
            harmonized=float(harm_sum[j]),
            raw_modis=int(modis_sum[j]),
            raw_viirs=int(viirs_sum[j]),
            frp_sum_mw=float(frp_total[j]) if frp_any[j] else None,
        )
        for j in np.flatnonzero(in_record & ~comp)
    )
    return ZeroFilledSeries(
        months=[months[j] for j in keep],
        harmonized=harm_sum[keep],
        raw_modis=modis_sum[keep],
        raw_viirs=viirs_sum[keep],
        frp_sum_mw=frp_total[keep],
        provisional=provisional,
    )


# ---------------------------------------------------------------------------
# Baselines and anomalies (design sections 8.3 and 8.4, requirement 10)
# ---------------------------------------------------------------------------

MIN_BASELINE_YEARS: int = 5
MAX_BASELINE_YEARS: int = 30
NO_TYPICAL_FIRES_TEXT: str = "no typical fires in this month"


@dataclass(frozen=True)
class Baseline:
    """Distribution of one calendar month (or of calendar-year totals) over the baseline years.

    Values are MODIS-equivalent cell-days from the zero-filled series. Percentiles use linear
    interpolation. `std` is the sample standard deviation (divisor N - 1), `None` when
    `n_years < 2`. When `n_years == 0` every statistic is `None`. `start_year` and `end_year`
    are the first and last baseline year that contributed a value. `values` holds the
    contributing values in year order and is used for the percentile rank.
    """

    median: float | None
    p10: float | None
    p90: float | None
    mean: float | None
    std: float | None
    n_years: int
    start_year: int | None = None
    end_year: int | None = None
    values: tuple[float, ...] = field(default=(), repr=False, compare=False)


@dataclass(frozen=True)
class Anomaly:
    """Comparison of one count against a `Baseline`. Never holds infinity or NaN.

    `absolute` is x - median. `percent` is 100 (x - median) / median, `None` when the median is 0
    (then `percent_text` is "no typical fires in this month"). `zscore` is (x - mean) / std,
    `None` when std is 0 (not defined, never 0 or infinity). `percentile_rank` is the mid-rank
    100 (L + 0.5 E) / N in 0..100.
    """

    absolute: float
    percent: float | None
    percent_text: str | None
    zscore: float | None
    percentile_rank: float
    baseline_start_year: int
    baseline_end_year: int
    n_years: int


class BaselineYearsError(ValueError):
    """A user baseline period violates a limit. The message names the violated limit."""


def _baseline_from_values(values: Sequence[float], years: Sequence[int]) -> Baseline:
    n = len(values)
    if n == 0:
        return Baseline(None, None, None, None, None, 0)
    arr = np.asarray(values, dtype=np.float64)
    p10, med, p90 = (float(v) for v in np.percentile(arr, [10, 50, 90], method="linear"))
    constant = bool((arr == arr[0]).all())
    mean = float(arr[0]) if constant else float(arr.mean())
    if n < 2:
        std: float | None = None
    elif constant:
        std = 0.0
    else:
        std = float(arr.std(ddof=1))
    return Baseline(
        median=med,
        p10=p10,
        p90=p90,
        mean=mean,
        std=std,
        n_years=n,
        start_year=min(years),
        end_year=max(years),
        values=tuple(float(v) for v in arr),
    )


def monthly_baselines(
    series: ZeroFilledSeries,
    baseline_years: Collection[int] | None = None,
) -> dict[int, Baseline]:
    """Baseline for each calendar month 1 to 12 from the zero-filled series (design 8.3).

    Args:
        series: Zero-filled series of in-record complete months.
        baseline_years: Optional years that make up the baseline period. `None` uses the whole
            series (the default baseline: full record, incomplete months excluded).

    Returns:
        A dict with keys 1 to 12. A calendar month with no value in the period gets an empty
        `Baseline` (`n_years == 0`).
    """
    allowed = None if baseline_years is None else set(baseline_years)
    values: dict[int, list[float]] = {m: [] for m in range(1, 13)}
    years: dict[int, list[int]] = {m: [] for m in range(1, 13)}
    for ym, x in zip(series.months, series.harmonized, strict=True):
        if allowed is not None and ym.year not in allowed:
            continue
        values[ym.month].append(float(x))
        years[ym.month].append(ym.year)
    return {m: _baseline_from_values(values[m], years[m]) for m in range(1, 13)}


def complete_years(series: ZeroFilledSeries) -> list[int]:
    """Calendar years with all 12 months in the series, ascending."""
    seen: dict[int, set[int]] = {}
    for ym in series.months:
        seen.setdefault(ym.year, set()).add(ym.month)
    return sorted(y for y, ms in seen.items() if len(ms) == 12)


def yearly_totals(series: ZeroFilledSeries) -> dict[int, float]:
    """Harmonized cell-day total per complete calendar year (sum of its 12 months)."""
    full = set(complete_years(series))
    totals: dict[int, float] = {}
    for ym, x in zip(series.months, series.harmonized, strict=True):
        if ym.year in full:
            totals[ym.year] = totals.get(ym.year, 0.0) + float(x)
    return totals


def provisional_years(series: ZeroFilledSeries) -> frozenset[int]:
    """Years that contain a provisional month. Their totals are never evaluated."""
    return frozenset(p.month.year for p in series.provisional)


def yearly_baseline(
    series: ZeroFilledSeries,
    baseline_years: Collection[int] | None = None,
) -> Baseline:
    """Baseline of calendar-year totals over complete years (design 8.3).

    Args:
        series: Zero-filled series.
        baseline_years: Optional years that make up the baseline period, `None` for all
            complete years of the series.
    """
    totals = yearly_totals(series)
    if baseline_years is not None:
        allowed = set(baseline_years)
        totals = {y: v for y, v in totals.items() if y in allowed}
    ys = sorted(totals)
    return _baseline_from_values([totals[y] for y in ys], ys)


def evaluate_anomaly(
    x: float,
    baseline: Baseline,
    *,
    provisional: bool = False,
) -> Anomaly | None:
    """Anomaly of count ``x`` against ``baseline`` (requirement 10.3 to 10.9, 10.12).

    Returns ``None`` (all anomaly fields null) for a provisional month or year, and when the
    baseline has no years. Raises ``ValueError`` when ``x`` is not finite.
    """
    if not math.isfinite(x):
        raise ValueError("count must be finite")
    if provisional or baseline.n_years == 0:
        return None
    assert baseline.median is not None
    assert baseline.mean is not None
    assert baseline.start_year is not None
    assert baseline.end_year is not None

    absolute = x - baseline.median

    percent: float | None = None
    percent_text: str | None = None
    if baseline.median == 0:
        percent_text = NO_TYPICAL_FIRES_TEXT
    else:
        candidate = 100.0 * absolute / baseline.median
        percent = candidate if math.isfinite(candidate) else None

    zscore: float | None = None
    if baseline.std is not None and baseline.std > 0:
        candidate = (x - baseline.mean) / baseline.std
        zscore = candidate if math.isfinite(candidate) else None

    vals = np.asarray(baseline.values, dtype=np.float64)
    less = int((vals < x).sum())
    equal = int((vals == x).sum())
    rank = 100.0 * (less + 0.5 * equal) / baseline.n_years

    return Anomaly(
        absolute=absolute,
        percent=percent,
        percent_text=percent_text,
        zscore=zscore,
        percentile_rank=rank,
        baseline_start_year=baseline.start_year,
        baseline_end_year=baseline.end_year,
        n_years=baseline.n_years,
    )


def validate_baseline_years(years: Iterable[int], record: Collection[int]) -> tuple[int, ...]:
    """Validate a user baseline period (requirements 10.2 and 10.10).

    Args:
        years: Requested baseline years.
        record: Complete in-record calendar years (for example from `complete_years`).

    Returns:
        The distinct years in ascending order.

    Raises:
        BaselineYearsError: When a year is outside the in-record complete years, or the number
            of distinct years is below 5 or above 30. The message names the violated limit.
    """
    distinct = sorted(set(years))
    allowed = set(record)
    outside = [y for y in distinct if y not in allowed]
    if outside:
        listed = ", ".join(str(y) for y in outside)
        raise BaselineYearsError(
            f"Baseline years must be complete in-record years. Not available: {listed}."
        )
    if len(distinct) < MIN_BASELINE_YEARS:
        raise BaselineYearsError(
            f"Baseline period needs at least {MIN_BASELINE_YEARS} complete years, "
            f"got {len(distinct)}."
        )
    if len(distinct) > MAX_BASELINE_YEARS:
        raise BaselineYearsError(
            f"Baseline period allows at most {MAX_BASELINE_YEARS} complete years, "
            f"got {len(distinct)}."
        )
    return tuple(distinct)


# ---------------------------------------------------------------------------
# Area result assembler (design section 8.5, requirements 9.1, 9.2, 9.4, 9.8, 9.12, 15.18)
# ---------------------------------------------------------------------------

NOTICE_NO_CELLS: str = "no_cells"
_ONE_DAY = timedelta(days=1)


@dataclass(frozen=True)
class MonthRow:
    """One calendar month of an area result. Values are unrounded (the API serializer rounds).

    `harmonized` is MODIS-equivalent cell-days. `raw_modis` and `raw_viirs` are raw cell-days and
    are never added. `frp_sum_mw` is the FRP sum in MW, `None` when no selected cell has FRP data
    (render as a dash). `source_flag`, `calib_model` and `provenance` come from the grid for the
    month, `None` when the grid has no row for the month. `provisional` equals the grid
    `incomplete` flag. `lower_bound` and `upper_bound` are deferred (Req 7) and always `None`.
    `anomaly` is `None` for a provisional month and when the baseline has no years.
    """

    year: int
    month: int
    harmonized: float
    raw_modis: int
    raw_viirs: int
    frp_sum_mw: float | None
    source_flag: str | None
    calib_model: str | None
    provenance: str | None
    provisional: bool
    lower_bound: float | None = None
    upper_bound: float | None = None
    anomaly: Anomaly | None = None


@dataclass(frozen=True)
class YearRow:
    """Totals of the result months that fall in one calendar year.

    `n_months` is the number of result months of that year (12 for a full year, fewer when the
    date range or the record cuts the year). `provisional` is True when the year contains the
    provisional month. `anomaly` is evaluated against the year-level baseline only for a year
    with all 12 months in the result that is a complete in-record year and not provisional,
    otherwise `None` (a partial total must not be compared with full-year totals).
    """

    year: int
    harmonized: float
    raw_modis: int
    raw_viirs: int
    frp_sum_mw: float | None
    n_months: int
    provisional: bool
    anomaly: Anomaly | None = None


@dataclass(frozen=True)
class Coverage:
    """How the requested date range maps onto the result months (whole months, UTC-8).

    `first_month` and `last_month` are the first and last month returned, `None` when no month
    overlaps the range. `starts_mid_month` and `ends_mid_month` are True when the requested
    start is not the first day, or the end not the last day, of its month (statistics still cover
    the whole month, Req 14.12). `before_record` and `after_latest` are True when the range
    extends outside the months held by the grid.
    """

    requested_start: date
    requested_end: date
    first_month: YearMonth | None
    last_month: YearMonth | None
    n_months: int
    starts_mid_month: bool
    ends_mid_month: bool
    before_record: bool
    after_latest: bool


@dataclass(frozen=True)
class AreaResult:
    """Result of `compute_area_result`: unrounded values, one row per month and per year.

    `baseline_by_month` has keys 1 to 12 and `baseline_year` is the year-level baseline, both
    over the baseline period (default: full record, incomplete months excluded) and independent
    of the date range. `notice` is `"no_cells"` when no cell centre lies in the area.

    `series` is the zero-filled series the result was built from (whole record, not limited to the
    date range). `hotspots.stats.briefing_inputs` needs it. It is left out of equality and repr.
    """

    months: tuple[MonthRow, ...]
    years: tuple[YearRow, ...]
    baseline_by_month: dict[int, Baseline]
    baseline_year: Baseline
    coverage: Coverage
    n_cells: int
    notice: str | None
    series: ZeroFilledSeries | None = field(default=None, repr=False, compare=False)

    @property
    def provisional_months(self) -> tuple[YearMonth, ...]:
        """Provisional months in the result, in order."""
        return tuple(YearMonth(r.year, r.month) for r in self.months if r.provisional)


def _nan_to_none(value: float) -> float | None:
    return None if math.isnan(value) else float(value)


def _add_frp(values: Iterable[float | None]) -> float | None:
    present = [v for v in values if v is not None]
    return math.fsum(present) if present else None


def compute_area_result(
    grid: GridArrays,
    polygon: BaseGeometry,
    start: date,
    end: date,
    baseline_years: Collection[int] | None = None,
    *,
    mask: ArrayLike | None = None,
    record_start: YearMonth | None = None,
) -> AreaResult:
    """Assemble months, years, baselines and anomalies for an area (design 8.2 to 8.5).

    Cells are selected by centre point (`select_cells`) unless a precomputed ``mask`` is given
    (for example from `hotspots.selection.SelectionMaskCache`, in which case ``polygon`` is not
    used). The result holds every in-record month that overlaps ``[start, end]`` as a whole
    month, including the provisional month (flagged, anomaly `None`). Months with no activity in
    the area are 0.0 with raw counts 0. Baselines come from the zero-filled series over the
    whole record (or over ``baseline_years``), not from the date range. Nothing is rounded here.

    Args:
        grid: Dense grid from `build_grid_arrays` (excluded cells already dropped).
        polygon: Selection polygon in EPSG:4326 (x = longitude, y = latitude).
        start: First local date of the range (UTC-8).
        end: Last local date of the range, inclusive.
        baseline_years: Optional baseline period (already validated by the caller).
        mask: Optional boolean selection per grid cell.
        record_start: First in-record month. Defaults to the first month of the grid.

    Raises:
        ValueError: When ``end`` is before ``start`` or ``mask`` has the wrong shape.
    """
    if end < start:
        raise ValueError("end must not be before start")

    if mask is None:
        sel = select_cells(grid.centre_lat, grid.centre_lon, polygon)
    else:
        sel = np.asarray(mask, dtype=np.bool_)
        if sel.shape != (grid.n_cells,):
            raise ValueError("mask must have one entry per grid cell")
    n_cells = int(sel.sum())

    grid_months = grid.months
    if record_start is None:
        record_start = grid_months[0]
    series = zero_filled_series(
        grid.harm,
        sel,
        grid_months,
        ~grid.incomplete,
        record_start,
        raw_modis=grid.raw_modis,
        raw_viirs=grid.raw_viirs,
        frp_sum=grid.frp_sum,
        frp_known=grid.frp_known,
    )
    by_month = monthly_baselines(series, baseline_years)
    by_year = yearly_baseline(series, baseline_years)
    full_years = set(complete_years(series))

    column = {ym.index: j for j, ym in enumerate(grid_months)}
    first_idx = YearMonth(start.year, start.month).index
    last_idx = YearMonth(end.year, end.month).index

    def meta(ym: YearMonth) -> tuple[str | None, str | None, str | None]:
        j = column[ym.index]
        return grid.source_flag[j], grid.calib_model[j], grid.provenance[j]

    rows: list[MonthRow] = []
    for i, ym in enumerate(series.months):
        if not first_idx <= ym.index <= last_idx:
            continue
        x = float(series.harmonized[i])
        source_flag, calib_model, provenance = meta(ym)
        rows.append(
            MonthRow(
                year=ym.year,
                month=ym.month,
                harmonized=x,
                raw_modis=int(series.raw_modis[i]),
                raw_viirs=int(series.raw_viirs[i]),
                frp_sum_mw=_nan_to_none(float(series.frp_sum_mw[i])),
                source_flag=source_flag,
                calib_model=calib_model,
                provenance=provenance,
                provisional=False,
                anomaly=evaluate_anomaly(x, by_month[ym.month]),
            )
        )
    for p in series.provisional:
        if not first_idx <= p.month.index <= last_idx:
            continue
        source_flag, calib_model, provenance = meta(p.month)
        rows.append(
            MonthRow(
                year=p.month.year,
                month=p.month.month,
                harmonized=p.harmonized,
                raw_modis=p.raw_modis,
                raw_viirs=p.raw_viirs,
                frp_sum_mw=p.frp_sum_mw,
                source_flag=source_flag,
                calib_model=calib_model,
                provenance=provenance,
                provisional=True,
                anomaly=None,
            )
        )
    rows.sort(key=lambda r: (r.year, r.month))

    year_rows: list[YearRow] = []
    for year in sorted({r.year for r in rows}):
        in_year = [r for r in rows if r.year == year]
        total = math.fsum(r.harmonized for r in in_year)
        provisional = any(r.provisional for r in in_year)
        evaluable = len(in_year) == 12 and year in full_years and not provisional
        year_rows.append(
            YearRow(
                year=year,
                harmonized=total,
                raw_modis=sum(r.raw_modis for r in in_year),
                raw_viirs=sum(r.raw_viirs for r in in_year),
                frp_sum_mw=_add_frp(r.frp_sum_mw for r in in_year),
                n_months=len(in_year),
                provisional=provisional,
                anomaly=evaluate_anomaly(total, by_year, provisional=not evaluable),
            )
        )

    record_first = max(grid_months[0].index, record_start.index)
    record_last = grid_months[-1].index
    coverage = Coverage(
        requested_start=start,
        requested_end=end,
        first_month=YearMonth(rows[0].year, rows[0].month) if rows else None,
        last_month=YearMonth(rows[-1].year, rows[-1].month) if rows else None,
        n_months=len(rows),
        starts_mid_month=start.day != 1,
        ends_mid_month=(end + _ONE_DAY).month == end.month,
        before_record=first_idx < record_first,
        after_latest=last_idx > record_last,
    )
    return AreaResult(
        months=tuple(rows),
        years=tuple(year_rows),
        baseline_by_month=by_month,
        baseline_year=by_year,
        coverage=coverage,
        n_cells=n_cells,
        notice=NOTICE_NO_CELLS if n_cells == 0 else None,
        series=series,
    )

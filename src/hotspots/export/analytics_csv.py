"""Analytics CSV exporter (Requirement 18, design section 10 "Analytics CSV").

One row per calendar month and one row per calendar year of a `CalendarOut` result, so the file
equals the numbers the Calendar shows (rounded as the API serializes them).

File layout: `#` comment lines, one header row, the month rows, the year rows and a final
`# rows: N` line (N = data rows).

Columns: `period_type` (`month` or `year`), `year`, `month` (empty for year rows),
`harmonized_cell_days` (MODIS-equivalent), `raw_modis_cell_days` and `raw_viirs_cell_days`
(two separate columns, never added), `frp_sum_mw`, the baseline of the same calendar month (or of
the year for year rows), the anomaly fields, `lower_bound` and `upper_bound` (empty: Requirement 7
is deferred, so no uncertainty interval exists), `provisional`, `source_flag`, `calib_model`
and `provenance`. Missing values are empty fields. The provisional month has no baseline
comparison, so its anomaly columns are empty.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, date, datetime
from typing import Final

from hotspots.api.schemas import Anomaly, BaselineStats, CalendarOut
from hotspots.constants import REGION_LABEL
from hotspots.export.hotspots_csv import (
    CITATION_LINE,
    SOURCE_LINE,
    TIME_CONVENTION_LINE,
    format_row,
    rows_footer,
)

COLUMNS: Final[tuple[str, ...]] = (
    "period_type",
    "year",
    "month",
    "harmonized_cell_days",
    "raw_modis_cell_days",
    "raw_viirs_cell_days",
    "frp_sum_mw",
    "baseline_median",
    "baseline_p10",
    "baseline_p90",
    "baseline_mean",
    "baseline_n_years",
    "anomaly_absolute",
    "anomaly_percent",
    "anomaly_percent_text",
    "anomaly_zscore",
    "anomaly_percentile_rank",
    "lower_bound",
    "upper_bound",
    "provisional",
    "source_flag",
    "calib_model",
    "provenance",
)

UNITS_LINE: Final[str] = (
    "harmonized_cell_days, baseline_* and anomaly_absolute are cell-days (one 1 km cell with at"
    " least one kept detection on a local day), MODIS-equivalent; raw_modis_cell_days and"
    " raw_viirs_cell_days are raw cell-days per sensor family and are never added to each other;"
    " frp_sum_mw is the area total in MW; anomaly_percent is a percent, anomaly_percentile_rank"
    " is 0 to 100"
)
HARMONIZATION_LINE: Final[str] = (
    "harmonization applies only to monthly cell-day counts (MODIS-equivalent scale); it is not"
    " applied to individual detections"
)
BOUNDS_LINE: Final[str] = (
    "lower_bound and upper_bound are empty because uncertainty intervals are not available"
)
PROVISIONAL_LINE: Final[str] = (
    "provisional = true marks the latest, incomplete month (count to date, no anomaly) and a"
    " year that contains it"
)
BASELINE_LINE: Final[str] = (
    "baseline = median, p10, p90 and mean of the zero-filled series of complete in-record months"
    " (month rows: same calendar month over the baseline years; year rows: yearly totals)"
)


def _anomaly_cells(anomaly: Anomaly | None) -> list[object]:
    if anomaly is None:
        return [None] * 5
    return [
        anomaly.absolute,
        anomaly.percent,
        anomaly.percent_text,
        anomaly.zscore,
        anomaly.percentile_rank,
    ]


def _baseline_cells(baseline: BaselineStats | None, *, show: bool) -> list[object]:
    if baseline is None or not show:
        return [None] * 5
    return [baseline.median, baseline.p10, baseline.p90, baseline.mean, baseline.n_years]


def build_comment_lines(
    *,
    query_description: str,
    start: date,
    end: date,
    generated_at: datetime,
    region_label: str = REGION_LABEL,
    coverage_text: str | None = None,
) -> list[str]:
    """The `#` comment lines that start the file, each ending with a line break."""
    if "\n" in query_description or "\r" in query_description:
        raise ValueError("query_description must be a single line")
    stamp = (
        generated_at.astimezone(UTC) if generated_at.tzinfo else generated_at.replace(tzinfo=UTC)
    )
    lines = [
        f"Burning activity analytics export, {region_label}",
        f"Region: {region_label}",
        f"Query: {query_description}",
        f"Date range requested (local dates, inclusive): {start.isoformat()} to {end.isoformat()}",
    ]
    if coverage_text:
        lines.append(f"Months covered: {coverage_text}")
    lines += [
        f"Time convention: {TIME_CONVENTION_LINE}",
        f"Generated (UTC): {stamp.strftime('%Y-%m-%dT%H:%M:%SZ')}",
        f"Source: {SOURCE_LINE}",
        f"Units: {UNITS_LINE}",
        f"Note: {HARMONIZATION_LINE}",
        f"Note: {PROVISIONAL_LINE}",
        f"Note: {BOUNDS_LINE}",
        f"Note: {BASELINE_LINE}",
        f"Citation: {CITATION_LINE}",
    ]
    return [f"# {text}\n" for text in lines]


def analytics_rows(result: CalendarOut) -> list[list[object]]:
    """Month rows (in order), then year rows, as lists of values in `COLUMNS` order."""
    by_month = {b.month: b for b in result.baseline_by_month}
    rows: list[list[object]] = []
    for m in result.months:
        rows.append(
            [
                "month",
                m.year,
                m.month,
                m.harmonized,
                m.raw_modis,
                m.raw_viirs,
                m.frp_sum_mw,
                *_baseline_cells(by_month.get(m.month), show=not m.provisional),
                *_anomaly_cells(None if m.provisional else m.anomaly),
                m.lower_bound,
                m.upper_bound,
                m.provisional,
                m.source_flag,
                m.calib_model,
                m.provenance,
            ]
        )
    for y in result.years:
        rows.append(
            [
                "year",
                y.year,
                None,
                y.harmonized,
                y.raw_modis,
                y.raw_viirs,
                y.frp_sum_mw,
                *_baseline_cells(result.baseline_year, show=not y.provisional),
                *_anomaly_cells(None if y.provisional else y.anomaly),
                None,
                None,
                y.provisional,
                None,
                None,
                None,
            ]
        )
    return rows


def build_analytics_csv(
    result: CalendarOut,
    *,
    query_description: str,
    start: date,
    end: date,
    region_label: str = REGION_LABEL,
    generated_at: datetime | None = None,
) -> str:
    """The complete analytics CSV text (comments, header, month rows, year rows, row count)."""
    coverage = result.coverage
    coverage_text = (
        f"{coverage.first_month} to {coverage.last_month} ({coverage.n_months} months)"
        if coverage.first_month and coverage.last_month
        else None
    )
    head = build_comment_lines(
        query_description=query_description,
        start=start,
        end=end,
        generated_at=generated_at if generated_at is not None else datetime.now(UTC),
        region_label=region_label,
        coverage_text=coverage_text,
    )
    data: Sequence[Sequence[object]] = analytics_rows(result)
    body = "".join(format_row(row) for row in data)
    return "".join(head) + ",".join(COLUMNS) + "\n" + body + rows_footer(len(data))

# Feature: harmonized-fire-calendar, Property 55: CSV estimate row count equals exported row count
"""Property 55: for any detections table, polygon and date range, the estimate row count equals
the number of data rows exported, every exported row lies inside the polygon (boundary rule
applied) and has `acq_date_local` within the exact inclusive range, and `approx_bytes` equals
rows times the configured average plus the header size.

Detections are synthetic (TEST FIXTURE, not NASA data). Their coordinates sit on the half-step
lattice of `tests.property.strategies.geometry`, so many fall exactly on an edge or vertex of the
polygon. The expected selection is computed here from the generated rows with shapely (a point
on the boundary counts when the point shifted slightly north-east is inside) and from the local
day `utc - 8 hours`. It does not use the selection code under test.

**Validates: Requirements 17.1, 17.5, 17.9, 17.11, 17.12**
"""

from __future__ import annotations

import csv
import io
import tempfile
from collections import Counter
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

from hypothesis import given
from hypothesis import strategies as st
from shapely.geometry import Point, Polygon

from hotspots.api.routes.export import (
    FALLBACK_CSV_AVG_BYTES_PER_ROW,
    estimate_export,
    header_bytes,
)
from hotspots.config import AppConfig, BaselineConfig, Extent, RegionConfig
from hotspots.constants import REGION_LABEL
from hotspots.data import DataStore
from hotspots.export import hotspots_csv
from tests.fixtures import make_detection_row, write_fixture_dir
from tests.property.strategies.geometry import lattice_points, points_on, polygons

BASE_UTC = datetime(2020, 7, 10, 0, 0, 0)
DAY_SPAN = 5
"""Rows are placed within this many days after `BASE_UTC`."""
LOCAL_OFFSET = timedelta(hours=-8)
SHIFT_LON = 1e-9
SHIFT_LAT = 1e-12
GENERATED_AT = datetime(2026, 11, 14, 12, 0, 0, tzinfo=UTC)


@dataclass(frozen=True)
class Case:
    polygon: Polygon
    rows: list[dict[str, Any]]
    start: date
    end: date
    avg_bytes: float
    header: int
    limit: int | None


# --- generators ---------------------------------------------------------------------------


@st.composite
def cases(draw: st.DrawFn) -> Case:
    polygon = draw(polygons())
    points = st.one_of(lattice_points(polygon), points_on(polygon))
    n_rows = draw(st.integers(min_value=0, max_value=10))
    rows: list[dict[str, Any]] = []
    for _ in range(n_rows):
        lon, lat = draw(points)
        offset = timedelta(
            days=draw(st.integers(min_value=0, max_value=DAY_SPAN)),
            hours=draw(st.integers(min_value=0, max_value=23)),
            minutes=draw(st.sampled_from([0, 59])),
        )
        rows.append(make_detection_row(lat, lon, BASE_UTC + offset))

    # The range may start before and end after every row, so it is sometimes empty or whole.
    first_day = (BASE_UTC + LOCAL_OFFSET).date()
    days = st.integers(min_value=-1, max_value=DAY_SPAN + 1)
    a, b = draw(days), draw(days)
    start, end = first_day + timedelta(days=min(a, b)), first_day + timedelta(days=max(a, b))
    return Case(
        polygon=polygon,
        rows=rows,
        start=start,
        end=end,
        avg_bytes=draw(st.one_of(st.just(0.0), st.floats(min_value=1.0, max_value=500.0))),
        header=draw(st.integers(min_value=0, max_value=20_000)),
        limit=draw(st.one_of(st.none(), st.integers(min_value=0, max_value=12))),
    )


# --- expected selection (independent of the code under test) -------------------------------


def _inside(polygon: Polygon, lon: float, lat: float) -> bool:
    if polygon.boundary.intersects(Point(lon, lat)):
        return polygon.contains(Point(lon + SHIFT_LON, lat + SHIFT_LAT))
    return polygon.contains(Point(lon, lat))


def _local_day(utc: datetime) -> date:
    return (utc + LOCAL_OFFSET).date()


def expected_points(case: Case) -> list[tuple[float, float, date]]:
    return [
        (r["lon"], r["lat"], _local_day(r["acq_datetime_utc"]))
        for r in case.rows
        if case.start <= _local_day(r["acq_datetime_utc"]) <= case.end
        and _inside(case.polygon, r["lon"], r["lat"])
    ]


# --- code under test ----------------------------------------------------------------------


def _cfg(data_dir: Path) -> AppConfig:
    return AppConfig(
        region=RegionConfig(name="Test region", extent=Extent(-124.4, 32.5, -114.0, 42.2)),
        data_dir=data_dir,
        record_start="2000-11",
        excluded_cells=(),
        baseline=BaselineConfig(start="2000-11", exclude_incomplete=True),
        watch_threshold=90.0,
        csv_avg_bytes_per_row=0.0,
    )


@contextmanager
def _store(rows: list[dict[str, Any]]) -> Iterator[DataStore]:
    with tempfile.TemporaryDirectory() as tmp:
        store = DataStore(_cfg(write_fixture_dir(Path(tmp), detections_rows=rows)))
        try:
            yield store
        finally:
            store.close()


def _read_export(text: str) -> tuple[list[tuple[float, float, date]], int, int]:
    """`(exported (lon, lat, local date) rows, footer row count, bytes of the data rows)`.

    The generated text fields hold no commas, quotes or line breaks, so each data row is one line.
    """
    lines = text.split("\n")
    assert lines[-1] == "" and lines[-2].startswith("# rows: "), lines[-2:]
    footer_rows = int(lines[-2].removeprefix("# rows: "))
    header_at = next(i for i, line in enumerate(lines) if line == ",".join(hotspots_csv.COLUMNS))
    data_lines = lines[header_at + 1 : -2]
    parsed = list(
        csv.DictReader(io.StringIO("\n".join(data_lines)), fieldnames=hotspots_csv.COLUMNS)
    )
    points = [
        (float(r["lon"]), float(r["lat"]), date.fromisoformat(r["acq_date_local"])) for r in parsed
    ]
    data_bytes = sum(len(line.encode("utf-8")) + 1 for line in data_lines)
    return points, footer_rows, data_bytes


@given(case=cases())
def test_csv_estimate_equals_export(case: Case) -> None:
    expected = expected_points(case)

    with _store(case.rows) as store:
        estimate = estimate_export(
            store,
            case.polygon,
            case.start,
            case.end,
            avg_bytes_per_row=case.avg_bytes,
            header=case.header,
            limit=case.limit,
        )
        text = b"".join(
            hotspots_csv.iter_hotspot_csv(
                store,
                case.polygon,
                case.start,
                case.end,
                geometry_description=hotspots_csv.describe_geometry(
                    case.polygon, full_region=False
                ),
                generated_at=GENERATED_AT,
            )
        ).decode("utf-8")
        header = header_bytes(
            case.polygon, case.start, case.end, region_label=REGION_LABEL, full_region=False
        )

    exported, footer_rows, data_bytes = _read_export(text)

    # The estimate row count equals the exported data rows and the generated expectation (17.9).
    assert estimate.rows == len(exported) == footer_rows == len(expected)

    # Every exported row is inside the polygon (boundary rule) and in the inclusive date range
    # (17.1, 17.5): the exported rows are exactly the expected ones.
    assert Counter(exported) == Counter(expected)
    assert all(case.start <= day <= case.end for _, _, day in exported)

    # The limit and the over-limit flag are consistent with the row count (17.11, 17.12).
    limit = hotspots_csv.MAX_EXPORT_ROWS if case.limit is None else case.limit
    assert estimate.limit == limit
    assert estimate.over_limit == (len(expected) > limit)

    # approx_bytes = rows * average + header; an unmeasured average (0) uses the fallback (17.9).
    average = case.avg_bytes if case.avg_bytes > 0 else FALLBACK_CSV_AVG_BYTES_PER_ROW
    assert abs(estimate.approx_bytes - (len(expected) * average + case.header)) <= 0.5

    # The header size never falls short of what the file holds besides the data rows.
    assert len(text.encode("utf-8")) - data_bytes <= header

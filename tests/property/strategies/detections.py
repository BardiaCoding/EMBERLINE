"""Hypothesis generators for detection rows and queries. All values are synthetic (not NASA data).

Rows have the 16 contract columns of `detections_harmonized.parquet` (`tests.fixtures`
`DETECTIONS_SCHEMA`). Text fields hold commas, quotes, line breaks, leading `#` and even a line
that looks like the `# rows: N` footer, to stress the CSV writer. Missing values (`None`) appear
in every column except `lat`, `lon`, `acq_date_local`, `year` and `month`.

Text values are never the empty string: the exporter writes a missing value as an empty field
(Requirement 17.4), so an empty string cannot be told apart from `None` after the export.

Contents:
- `CONTRACT_COLUMNS`: the 16 column names in contract order, written out independently of the
  exporter.
- `AREA_BOUNDS`: lon/lat box that holds every generated point strictly inside.
- `detection_rows()`: list of row dicts.
- `detection_queries()`: `(rows, start, end, batch)`, a date range that is often narrow.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from hypothesis import strategies as st

from tests.fixtures import local_date

CONTRACT_COLUMNS: tuple[str, ...] = (
    "sensor_family",
    "satellite",
    "source",
    "lat",
    "lon",
    "acq_datetime_utc",
    "acq_date_local",
    "year",
    "month",
    "daynight",
    "confidence_class",
    "confidence_raw",
    "frp",
    "type",
    "pixel_size_m",
    "version",
)

AREA_BOUNDS = (-125.0, 32.0, -113.0, 43.0)
"""`(west, south, east, north)` of the query box used by the round-trip test."""

FIRST_DAY = date(2000, 11, 1)
LAST_DAY = date(2026, 12, 31)
QUERY_START = date(2000, 1, 1)
QUERY_END = date(2027, 1, 31)
"""Date range that holds every generated row (full-range queries)."""

_SPECIAL_TEXT = st.sampled_from(
    ["#", ",", '"', "\n", "\r", "\r\n", " ", "# rows: 1", "\n# rows: 1\n", "a,b", '""', "é", "😀"]
)
_PLAIN_TEXT = st.text(
    alphabet=st.characters(codec="utf-8", exclude_characters="\x00"), min_size=1, max_size=6
)


def csv_text() -> st.SearchStrategy[str]:
    """Non-empty text that often needs quoting in a CSV file."""
    return st.lists(st.one_of(_SPECIAL_TEXT, _PLAIN_TEXT), min_size=1, max_size=4).map("".join)


def _maybe(strategy: st.SearchStrategy[Any]) -> st.SearchStrategy[Any]:
    return st.one_of(st.none(), strategy)


@st.composite
def detection_row(draw: st.DrawFn) -> dict[str, Any]:
    """One synthetic detection row. TEST FIXTURE, not NASA data.

    `acq_date_local` is the UTC-8 day of a drawn UTC time (kept even when the UTC time is
    missing), and `year` and `month` follow that local day, as in the delivered file.
    """
    utc = draw(
        st.datetimes(
            min_value=datetime(2000, 11, 1),
            max_value=datetime.combine(LAST_DAY, datetime.min.time()) + timedelta(hours=23),
        )
    )
    day = local_date(utc)
    west, south, east, north = AREA_BOUNDS
    return {
        "sensor_family": draw(_maybe(csv_text())),
        "satellite": draw(_maybe(csv_text())),
        "source": draw(_maybe(csv_text())),
        "lat": draw(st.floats(min_value=south + 0.5, max_value=north - 0.5, allow_nan=False)),
        "lon": draw(st.floats(min_value=west + 0.5, max_value=east - 0.5, allow_nan=False)),
        "acq_datetime_utc": draw(st.sampled_from([utc, utc, None])),
        "acq_date_local": day,
        "year": day.year,
        "month": day.month,
        "daynight": draw(_maybe(csv_text())),
        "confidence_class": draw(_maybe(csv_text())),
        "confidence_raw": draw(_maybe(csv_text())),
        # NaN is a missing value: it is written as an empty field.
        "frp": draw(_maybe(st.floats(allow_infinity=False))),
        "type": draw(_maybe(st.integers(min_value=-5, max_value=5))),
        "pixel_size_m": draw(_maybe(st.integers(min_value=0, max_value=2**31 - 1))),
        "version": draw(_maybe(csv_text())),
    }


def detection_rows(max_size: int = 12) -> st.SearchStrategy[list[dict[str, Any]]]:
    """Lists of 0 to `max_size` detection rows (an empty list gives a zero-row export)."""
    return st.lists(detection_row(), min_size=0, max_size=max_size)


@st.composite
def detection_queries(
    draw: st.DrawFn,
) -> tuple[list[dict[str, Any]], date, date, int]:
    """`(rows, start, end, batch)`: rows, an inclusive local date range and a batch size.

    The range is the full range, or two dates (often taken from the rows) put in order, so
    that the selection is sometimes a strict subset and sometimes empty. `batch` is small so
    that most exports span several batches.
    """
    rows = draw(detection_rows())
    batch = draw(st.integers(min_value=1, max_value=5))
    if draw(st.booleans()):
        return rows, QUERY_START, QUERY_END, batch
    days = st.dates(min_value=QUERY_START, max_value=QUERY_END)
    if rows:
        days = st.one_of(days, st.sampled_from([r["acq_date_local"] for r in rows]))
    first, second = draw(days), draw(days)
    return rows, min(first, second), max(first, second), batch

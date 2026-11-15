# Feature: harmonized-fire-calendar, Property 32: Hotspot CSV round trip
"""Property 32: for any set of detection rows with the 16 contract columns (including missing
values, commas, quotes and newlines in text fields), writing the CSV and reading it with a
reader that skips `#` lines reproduces the same rows. The header has exactly the 16 columns in
order, a zero-row export contains the comments and the header, and a complete file ends with
`# rows: N` equal to the row count.

Rows are written to a synthetic Parquet file (TEST FIXTURE, not NASA data), read back through
`DataStore` and exported with `iter_hotspot_csv`. The CSV is parsed with Python's standard `csv`
module. Only the leading `#` comment block and the trailing `# rows:` footer are removed before
parsing: a quoted multi-line field may hold a line that starts with `#`, so a blind "drop every
line that starts with #" filter would be wrong.

Expected values are the generated rows, not anything read from the exporter. Missing values
(`None` and NaN) are expected as empty fields, read back as `None`.

**Validates: Requirements 17.1, 17.2, 17.4, 17.7**
"""

from __future__ import annotations

import csv
import io
import math
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

from hypothesis import example, given
from shapely.geometry import box

from hotspots.config import AppConfig, BaselineConfig, Extent, RegionConfig
from hotspots.data import DataStore
from hotspots.export import hotspots_csv
from tests.fixtures import make_detection_row, write_fixture_dir
from tests.property.strategies.detections import (
    AREA_BOUNDS,
    CONTRACT_COLUMNS,
    QUERY_END,
    QUERY_START,
    detection_queries,
)

COMMENT_PREFIX = "# "
FOOTER_MARK = "\n# rows: "
GENERATED_AT = datetime(2026, 11, 14, 12, 0, 0, tzinfo=UTC)

_TEXT_COLUMNS = (
    "sensor_family",
    "satellite",
    "source",
    "daynight",
    "confidence_class",
    "confidence_raw",
    "version",
)
_FLOAT_COLUMNS = ("lat", "lon", "frp")
_INT_COLUMNS = ("year", "month", "type", "pixel_size_m")


# --- reader -------------------------------------------------------------------------------


def _split_file(text: str) -> tuple[list[str], str, int]:
    """Split the file into leading comment lines, the CSV body and the footer row count.

    The comment block is the run of `#` lines at the start. The footer is the last line. Text
    between them is the CSV body (header and data rows), where a quoted field may contain lines
    that start with `#`.
    """
    assert text.endswith("\n")
    footer_at = text.rindex(FOOTER_MARK) + 1
    footer = text[footer_at:]
    assert footer.startswith("# rows: ") and footer.count("\n") == 1, footer
    rows_in_footer = int(footer.removeprefix("# rows: ").strip())

    comments: list[str] = []
    rest = text[:footer_at]
    while rest.startswith("#"):
        line, _, rest = rest.partition("\n")
        comments.append(line)
    return comments, rest, rows_in_footer


def _parse_value(column: str, text: str) -> Any:
    if text == "":
        return None
    if column in _TEXT_COLUMNS:
        return text
    if column in _FLOAT_COLUMNS:
        return float(text)
    if column in _INT_COLUMNS:
        return int(text)
    if column == "acq_datetime_utc":
        assert text.endswith("Z"), text
        return datetime.fromisoformat(text.removesuffix("Z"))
    if column == "acq_date_local":
        return date.fromisoformat(text)
    raise AssertionError(f"unexpected column {column}")


def read_hotspot_csv(text: str) -> tuple[list[str], list[str], list[dict[str, Any]], int]:
    """Parse an export: `(comment lines, header, typed rows, footer row count)`."""
    comments, body, footer_rows = _split_file(text)
    records = list(csv.reader(io.StringIO(body, newline="")))
    header, data = records[0], records[1:]
    rows: list[dict[str, Any]] = []
    for record in data:
        assert len(record) == len(header), record
        rows.append({c: _parse_value(c, v) for c, v in zip(header, record, strict=True)})
    return comments, header, rows, footer_rows


# --- expected rows ------------------------------------------------------------------------


def _expected(row: dict[str, Any]) -> dict[str, Any]:
    """The generated row as it must read back: NaN is a missing value."""
    return {c: (None if isinstance(v, float) and math.isnan(v) else v) for c, v in row.items()}


def _same(expected: dict[str, Any], actual: dict[str, Any]) -> bool:
    return expected.keys() == actual.keys() and all(
        expected[c] == actual[c] and type(expected[c]) is type(actual[c]) for c in expected
    )


# --- writer under test --------------------------------------------------------------------


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
        data_dir = write_fixture_dir(Path(tmp), detections_rows=rows)
        store = DataStore(_cfg(data_dir))
        try:
            yield store
        finally:
            store.close()


def export_text(rows: list[dict[str, Any]], start: date, end: date, batch: int) -> str:
    """Write `rows` to Parquet and export the query that covers the whole area box."""
    polygon = box(*AREA_BOUNDS)
    with _store(rows) as store:
        chunks = hotspots_csv.iter_hotspot_csv(
            store,
            polygon,
            start,
            end,
            geometry_description=hotspots_csv.describe_geometry(polygon, full_region=False),
            generated_at=GENERATED_AT,
            batch=batch,
        )
        return b"".join(chunks).decode("utf-8")


# --- property -----------------------------------------------------------------------------

_TRICKY = make_detection_row(35.0, -118.0, datetime(2020, 7, 10, 20, 30, 5, 123456))
_TRICKY.update(
    sensor_family='#a,"b"\n# rows: 99\nc\r\nd',
    satellite="\n# rows: 7\n",
    source="#",
    confidence_raw='""',
    version="x\ry",
    frp=None,
)


@example(query=([], QUERY_START, QUERY_END, 1))  # zero rows: comments, header, `# rows: 0`
@example(query=([_TRICKY], QUERY_START, QUERY_END, 1))
@given(query=detection_queries())
def test_hotspot_csv_round_trip(query: tuple[list[dict[str, Any]], date, date, int]) -> None:
    rows, start, end, batch = query
    expected = [_expected(r) for r in rows if start <= r["acq_date_local"] <= end]

    text = export_text(rows, start, end, batch)
    comments, header, actual, footer_rows = read_hotspot_csv(text)

    # The comment block comes first and the file ends with the row count (17.2).
    assert comments, "the file must start with # comment lines"
    assert all(line.startswith(COMMENT_PREFIX) for line in comments)
    assert any("fixed UTC-8" in line for line in comments)
    assert not text.startswith("sensor_family")
    assert text.endswith(f"{FOOTER_MARK[1:]}{len(expected)}\n")
    assert footer_rows == len(expected)

    # The header has the 16 contract columns, in order (17.1).
    assert tuple(header) == CONTRACT_COLUMNS
    assert text.split("\n", len(comments))[len(comments)].startswith(",".join(CONTRACT_COLUMNS))

    # Same number of rows and same values, in file order (17.4). A zero-row export is the
    # comments, the header and the footer (17.7).
    assert len(actual) == len(expected)
    for want, got in zip(expected, actual, strict=True):
        assert _same(want, got), (want, got)

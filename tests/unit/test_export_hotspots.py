"""Unit tests for the hotspot CSV exporter and `POST /api/v1/export/hotspots` (task 10.1).

Requirements 17.1, 17.2, 17.3, 17.7, 17.8, 18.3, 30.7. Data are synthetic (`tests/fixtures.py`,
TEST FIXTURE, not NASA data).
"""

from __future__ import annotations

import csv
import io
from collections.abc import Iterator
from datetime import date, datetime
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient
from hypothesis import given
from hypothesis import strategies as st

from hotspots.api.main import create_app
from hotspots.api.routes import export as export_route
from hotspots.data import DataStore
from hotspots.export import hotspots_csv
from hotspots.export.filenames import MAX_STEM_CHARS, export_filename, sanitize_filename
from tests.fixtures import make_detection_row, write_fixture_dir

PROJECT_CONFIG = Path(__file__).resolve().parents[2] / "config" / "app.yaml"
URL = "/api/v1/export/hotspots"
FULL_RANGE = {"start": "2000-01-01", "end": "2026-12-31"}


def _rect(west: float, south: float, east: float, north: float) -> dict[str, Any]:
    return {
        "type": "Polygon",
        "coordinates": [
            [[west, south], [east, south], [east, north], [west, north], [west, south]]
        ],
    }


def _det(
    lat: float, lon: float, day: int = 10, month: int = 7, hour: int = 20, **kw: Any
) -> dict[str, Any]:
    return make_detection_row(lat, lon, datetime(2020, month, day, hour, 30, 5), **kw)


def _rows() -> list[dict[str, Any]]:
    """Detections around the test area (-119.0, 34.0, -118.0, 35.0)."""
    inside = _det(34.5, -118.5, frp=12.5)
    west_edge = _det(34.5, -119.0)  # on the west edge: included (half-open rule)
    east_edge = _det(34.5, -118.0)  # on the east edge: excluded
    outside = _det(36.0, -118.5)
    late = _det(34.6, -118.6, day=20)  # same area, later day
    odd_text = _det(34.7, -118.7, day=11)
    odd_text["version"] = 'v1,"x"\nline2'
    odd_text["frp"] = None
    odd_text["confidence_raw"] = "#hash"
    return sorted(
        [inside, west_edge, east_edge, outside, late, odd_text],
        key=lambda r: (r["acq_date_local"], r["acq_datetime_utc"]),
    )


AREA = _rect(-119.0, 34.0, -118.0, 35.0)


def _config(tmp_path: Path, data_dir: Path) -> Path:
    raw = yaml.safe_load(PROJECT_CONFIG.read_text(encoding="utf-8"))
    raw["data_dir"] = str(data_dir)
    path = tmp_path / "app.yaml"
    path.write_text(yaml.safe_dump(raw), encoding="utf-8")
    return path


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    data_dir = write_fixture_dir(tmp_path, detections_rows=_rows())
    with TestClient(create_app(_config(tmp_path, data_dir))) as c:
        yield c


def _split(text: str) -> tuple[list[str], list[dict[str, str]], str | None]:
    """Comment lines, parsed data rows and the footer line (None when absent)."""
    lines = text.split("\n")
    comments = [ln for ln in lines if ln.startswith("# ") and not ln.startswith("# rows:")]
    footer = next((ln for ln in lines if ln.startswith("# rows:")), None)
    body = io.StringIO(
        "\n".join(ln for ln in lines if not (ln.startswith("#") and not ln.startswith('"#')))
    )
    return comments, list(csv.DictReader(body)), footer


def _post(client: TestClient, geometry: dict[str, Any] | None = AREA, **extra: Any) -> Any:
    body: dict[str, Any] = {**FULL_RANGE, **extra}
    if geometry is not None:
        body["geometry"] = geometry
    return client.post(URL, json=body)


# --- route -------------------------------------------------------------------------------


def test_export_selects_rows_and_writes_contract_columns(client: TestClient) -> None:
    response = _post(client)
    assert response.status_code == 200
    assert response.headers["content-type"] == "text/csv; charset=utf-8"
    assert response.headers["content-disposition"] == (
        'attachment; filename="hotspots_custom-area_2000-01-01_2026-12-31.csv"'
    )
    comments, rows, footer = _split(response.text)
    header_line = next(ln for ln in response.text.split("\n") if ln.startswith("sensor_family"))
    assert tuple(header_line.split(",")) == hotspots_csv.COLUMNS
    assert len(rows) == 4  # inside, west edge, later day, odd text (east edge and far point out)
    assert footer == "# rows: 4"
    lons = sorted(float(r["lon"]) for r in rows)
    assert lons == [-119.0, -118.7, -118.6, -118.5]
    first = rows[1]  # sorted by local date: west edge and inside share the day, odd text is next
    assert set(first) == set(hotspots_csv.COLUMNS)
    text = "\n".join(comments)
    assert "California region" in text
    assert "local standard time, fixed UTC-8, no daylight saving; acq_datetime_utc is true UTC" in (
        text
    )
    assert "not individually harmonized" in text
    assert "do not reconcile" in text
    assert "Generated (UTC):" in text
    assert "2000-01-01 to 2026-12-31" in text
    assert "Fire Information for Resource Management System" in text
    assert "Polygon" in text
    assert "build date 2026-11-14" in text


def test_values_round_trip_with_empty_missing_fields(client: TestClient) -> None:
    _, rows, _ = _split(_post(client).text)
    (odd,) = [r for r in rows if r["version"].startswith("v1,")]
    assert odd["version"] == 'v1,"x"\nline2'
    assert odd["frp"] == ""
    assert odd["confidence_raw"] == "#hash"
    (plain,) = [r for r in rows if r["frp"] == "12.5"]
    assert plain["acq_datetime_utc"] == "2020-07-10T20:30:05Z"
    assert plain["acq_date_local"] == "2020-07-10"
    assert plain["year"] == "2020"
    assert plain["pixel_size_m"] == "375"


def test_date_range_is_inclusive_in_local_dates(client: TestClient) -> None:
    only_day = _post(client, start="2020-07-10", end="2020-07-10")
    _, rows, footer = _split(only_day.text)
    assert len(rows) == 2 and footer == "# rows: 2"
    assert {r["acq_date_local"] for r in rows} == {"2020-07-10"}


def test_zero_rows_has_comments_header_and_footer(client: TestClient) -> None:
    response = _post(client, start="2001-01-01", end="2001-01-31")
    assert response.status_code == 200
    comments, rows, footer = _split(response.text)
    assert comments and rows == [] and footer == "# rows: 0"
    assert "sensor_family,satellite" in response.text


def test_full_region_has_no_geometry_in_body(client: TestClient) -> None:
    response = _post(client, None)
    assert response.status_code == 200
    assert "hotspots_California-region_" in response.headers["content-disposition"]
    _, rows, footer = _split(response.text)
    assert len(rows) == 6 and footer == "# rows: 6"  # every fixture point is inside the region


def test_over_limit_is_422_before_streaming(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(hotspots_csv, "MAX_EXPORT_ROWS", 3)
    response = _post(client)
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "export_too_large"
    assert "4" in error["message"] and "3" in error["message"]
    assert "text/csv" not in response.headers["content-type"]


def test_at_limit_is_allowed(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(hotspots_csv, "MAX_EXPORT_ROWS", 4)
    assert _post(client).status_code == 200


def test_invalid_geometry_is_422(client: TestClient) -> None:
    bowtie = {
        "type": "Polygon",
        "coordinates": [[[-119, 34], [-118, 35], [-118, 34], [-119, 35], [-119, 34]]],
    }
    response = _post(client, bowtie)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_geometry"


def test_end_before_start_is_422(client: TestClient) -> None:
    response = _post(client, start="2020-07-10", end="2020-07-09")
    assert response.status_code == 422


def test_route_module_is_the_one_discovered() -> None:
    assert export_route.router.prefix == "/api/v1"


# --- exporter ----------------------------------------------------------------------------


def _store(tmp_path: Path) -> DataStore:
    from hotspots.config import load_config

    data_dir = write_fixture_dir(tmp_path, detections_rows=_rows())
    config = load_config(_config(tmp_path, data_dir), require_data=False)
    assert not hasattr(config, "errors")
    return DataStore(config)  # type: ignore[arg-type]


def test_failure_mid_stream_writes_no_footer(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from shapely.geometry import shape

    store = _store(tmp_path)
    real = store.iter_detections

    def failing(*args: Any, **kwargs: Any) -> Iterator[Any]:
        yield from real(*args, **kwargs)
        raise RuntimeError("boom")

    monkeypatch.setattr(store, "iter_detections", failing)
    chunks: list[bytes] = []
    with pytest.raises(RuntimeError, match="boom"):
        for chunk in hotspots_csv.iter_hotspot_csv(
            store,
            shape(AREA),
            date(2000, 1, 1),
            date(2026, 12, 31),
            geometry_description="test",
        ):
            chunks.append(chunk)
    text = b"".join(chunks).decode("utf-8")
    assert "sensor_family" in text
    assert "# rows:" not in text
    store.close()


def test_small_batches_give_the_same_rows(tmp_path: Path) -> None:
    from shapely.geometry import shape

    store = _store(tmp_path)
    polygon = shape(AREA)
    args = (store, polygon, date(2000, 1, 1), date(2026, 12, 31))
    assert hotspots_csv.count_hotspot_rows(*args) == 4
    assert hotspots_csv.count_hotspot_rows(*args, batch=1) == 4
    store.close()


def test_format_value_cases() -> None:
    assert hotspots_csv.format_value(None) == ""
    assert hotspots_csv.format_value(float("nan")) == ""
    assert hotspots_csv.format_value(0.1 + 0.2) == "0.30000000000000004"
    assert hotspots_csv.format_value(datetime(2020, 1, 2, 3, 4, 5)) == "2020-01-02T03:04:05Z"
    assert hotspots_csv.format_value(date(2020, 1, 2)) == "2020-01-02"
    assert hotspots_csv.format_row(["#a", "b"]) == '"#a",b\n'


# --- file names --------------------------------------------------------------------------


def test_sanitize_filename_examples() -> None:
    assert sanitize_filename("Sierra Nevada / forest!") == "Sierra-Nevada-forest"
    assert sanitize_filename("Café ../../x") == "Cafe-x"
    assert sanitize_filename("...") == "export"
    assert len(sanitize_filename("a" * 500)) == MAX_STEM_CHARS


@given(
    name=st.text(max_size=300),
    start=st.dates(min_value=date(1990, 1, 1), max_value=date(2100, 1, 1)),
    end=st.dates(min_value=date(1990, 1, 1), max_value=date(2100, 1, 1)),
)
def test_export_filename_is_safe_and_deterministic(name: str, start: date, end: date) -> None:
    file_name = export_filename("hotspots", name, start, end, "csv")
    stem, _, ext = file_name.rpartition(".")
    assert ext == "csv"
    assert 1 <= len(stem) <= MAX_STEM_CHARS
    assert all(c.isascii() and (c.isalnum() or c in "-_") for c in stem)
    assert file_name == export_filename("hotspots", name, start, end, "csv")

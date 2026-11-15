"""Unit and property tests for `POST /api/v1/recent` (task 26.1, Requirements 20.1 to 20.6).

Data are synthetic (`tests/fixtures.py`, TEST FIXTURE, not NASA data).
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient
from hypothesis import given
from hypothesis import strategies as st

from hotspots.api import recent as rc
from hotspots.api.main import create_app
from hotspots.api.routes import recent as recent_route
from tests.fixtures import make_detection_row, make_grid_row, write_fixture_dir

PROJECT_CONFIG = Path(__file__).resolve().parents[2] / "config" / "app.yaml"
URL = "/api/v1/recent"
AREA: dict[str, Any] = {
    "type": "Polygon",
    "coordinates": [
        [[-119.0, 34.0], [-118.0, 34.0], [-118.0, 35.0], [-119.0, 35.0], [-119.0, 34.0]]
    ],
}
NOW = datetime(2026, 11, 16, 12, 0, tzinfo=UTC)  # local 2026-11-16 04:00


def _det(lat: float, lon: float, day: int, hour: int = 20, **kw: Any) -> dict[str, Any]:
    return make_detection_row(lat, lon, datetime(2026, 11, day, hour, 15, 0), **kw)


def _rows() -> list[dict[str, Any]]:
    rows = [
        _det(34.5, -118.5, 10),  # latest, local 2026-11-10 12:15
        _det(34.6, -118.6, 10, hour=19),
        _det(34.5, -118.5, 8),
        _det(34.5, -118.5, 1),  # before the window
        _det(36.0, -118.5, 10),  # outside the area
    ]
    return sorted(rows, key=lambda r: r["acq_date_local"])


def _client(tmp_path: Path, det_rows: list[dict[str, Any]]) -> TestClient:
    raw = yaml.safe_load(PROJECT_CONFIG.read_text(encoding="utf-8"))
    grid = [make_grid_row(340, -1181, 2026, 10, 4.0), make_grid_row(340, -1181, 2026, 11, 3.0)]
    raw["data_dir"] = str(write_fixture_dir(tmp_path, grid, det_rows))
    path = tmp_path / "app.yaml"
    path.write_text(yaml.safe_dump(raw), encoding="utf-8")
    return TestClient(create_app(path))


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setattr(recent_route, "_now_utc", lambda: NOW)
    with _client(tmp_path, _rows()) as c:
        yield c


def test_seven_days_ending_on_latest_local_date(client: TestClient) -> None:
    body = client.post(URL, json={"geometry": AREA}).json()
    assert body["window_end"] == "2026-11-10"
    assert body["window_start"] == "2026-11-04"
    days = {d["date"]: d["count"] for d in body["days"]}
    assert len(body["days"]) == 7
    assert days["2026-11-10"] == 2
    assert days["2026-11-08"] == 1
    assert sum(days.values()) == 3 == body["total"]
    assert sum(1 for c in days.values() if c == 0) == 5  # zero days are present


def test_points_latest_and_age(client: TestClient) -> None:
    body = client.post(URL, json={"geometry": AREA}).json()
    assert len(body["points"]) == 3
    assert body["points_omitted"] == 0
    assert body["points"][0]["acq_datetime_utc"].startswith("2026-11-10T20:15")  # newest first
    assert body["latest_utc"].startswith("2026-11-10T20:15")  # latest in the whole file
    assert body["data_age_days"] == 6  # local 2026-11-16 minus 2026-11-10
    assert body["points"][0]["source"] == "SP"
    assert "not harmonized" in body["label"]
    assert body["unit"] == "detections (raw)"


def test_watch_is_monthly_and_present(client: TestClient) -> None:
    watch = client.post(URL, json={"geometry": AREA}).json()["watch"]
    assert watch["period"] == "2026-10"
    assert watch["provisional_month"] == "2026-11"


def test_no_detections_in_area_gives_seven_zero_days(client: TestClient) -> None:
    far = {
        "type": "Polygon",
        "coordinates": [
            [[-124.0, 40.0], [-123.0, 40.0], [-123.0, 41.0], [-124.0, 41.0], [-124.0, 40.0]]
        ],
    }
    body = client.post(URL, json={"geometry": far}).json()
    assert [d["count"] for d in body["days"]] == [0] * 7
    assert body["points"] == [] and body["total"] == 0


def test_points_are_capped_and_omission_counted(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(recent_route, "_now_utc", lambda: NOW)
    monkeypatch.setattr(rc, "MAX_RECENT_POINTS", 2)
    with _client(tmp_path, _rows()) as c:
        body = c.post(URL, json={"geometry": AREA}).json()
    assert len(body["points"]) == 2
    assert body["points_omitted"] == 1
    assert body["total"] == 3  # the counts still include every detection


def test_invalid_area_is_422(client: TestClient) -> None:
    bad = {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]}
    assert client.post(URL, json={"geometry": bad}).status_code == 422


# --- pure helpers ---------------------------------------------------------------------------


@given(st.dates(min_value=date(2001, 1, 1), max_value=date(2030, 1, 1)))
def test_window_has_seven_consecutive_days_ending_on_latest(latest: date) -> None:
    days = rc.window_days(latest)
    assert len(days) == 7 and days[-1] == latest
    assert all(b - a == timedelta(days=1) for a, b in zip(days, days[1:], strict=False))


@given(
    st.dates(min_value=date(2001, 1, 1), max_value=date(2030, 1, 1)),
    st.lists(st.integers(min_value=-10, max_value=10), max_size=60),
)
def test_daily_counts_sum_to_detections_in_window(latest: date, offsets: list[int]) -> None:
    days = rc.window_days(latest)
    detection_days = [latest + timedelta(days=o) for o in offsets]
    counts = rc.daily_counts(days, detection_days)
    assert len(counts) == 7
    assert sum(counts) == sum(1 for o in offsets if -6 <= o <= 0)


def test_data_age_uses_fixed_utc_minus_8_and_never_negative() -> None:
    now = datetime(2026, 11, 16, 7, 59, tzinfo=UTC)  # local 2026-11-15 23:59
    assert rc.data_age_days(date(2026, 11, 12), now) == 3
    assert rc.data_age_days(date(2026, 11, 20), now) == 0

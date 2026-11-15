"""Unit tests for the analytics CSV and `POST /api/v1/export/analytics` (task 25.1).

Requirements 18.1, 18.4, 18.5, 30.7. Data are synthetic (`tests/fixtures.py`,
TEST FIXTURE, not NASA data).
"""

from __future__ import annotations

import csv
import io
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient

from hotspots.api.main import create_app
from hotspots.export.analytics_csv import COLUMNS
from tests.fixtures import default_grid_rows, write_fixture_dir

PROJECT_CONFIG = Path(__file__).resolve().parents[2] / "config" / "app.yaml"
URL = "/api/v1/export/analytics"
FULL_RANGE = {"start": "2000-01-01", "end": "2026-12-31"}


def _config(tmp_path: Path, data_dir: Path) -> Path:
    raw = yaml.safe_load(PROJECT_CONFIG.read_text(encoding="utf-8"))
    raw["data_dir"] = str(data_dir)
    path = tmp_path / "app.yaml"
    path.write_text(yaml.safe_dump(raw), encoding="utf-8")
    return path


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    data_dir = write_fixture_dir(tmp_path, default_grid_rows())
    with TestClient(create_app(_config(tmp_path, data_dir))) as c:
        yield c


def _parse(text: str) -> tuple[list[str], list[dict[str, str]], str]:
    lines = text.splitlines()
    comments = [ln for ln in lines if ln.startswith("# ")]
    footer = comments[-1]
    data = [ln for ln in lines if not ln.startswith("# ")]
    rows = list(csv.DictReader(io.StringIO("\n".join(data))))
    return comments[:-1], rows, footer


def test_csv_matches_calendar_result(client: TestClient) -> None:
    response = client.post(URL, json=FULL_RANGE)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert (
        "analytics_California-region_2000-01-01_2026-12-31.csv"
        in (response.headers["content-disposition"])
    )
    cal: dict[str, Any] = client.post("/api/v1/calendar", json=FULL_RANGE).json()
    comments, rows, footer = _parse(response.text)
    assert list(rows[0].keys()) == list(COLUMNS)
    months = [r for r in rows if r["period_type"] == "month"]
    years = [r for r in rows if r["period_type"] == "year"]
    assert len(months) == len(cal["months"])
    assert len(years) == len(cal["years"])
    assert footer == f"# rows: {len(rows)}"
    for row, m in zip(months, cal["months"], strict=True):
        assert (int(row["year"]), int(row["month"])) == (m["year"], m["month"])
        assert float(row["harmonized_cell_days"]) == m["harmonized"]
        assert int(row["raw_modis_cell_days"]) == m["raw_modis"]
        assert int(row["raw_viirs_cell_days"]) == m["raw_viirs"]
        assert row["lower_bound"] == "" and row["upper_bound"] == ""
        assert row["provisional"] == ("true" if m["provisional"] else "false")
    for row, y in zip(years, cal["years"], strict=True):
        assert row["month"] == ""
        assert float(row["harmonized_cell_days"]) == y["harmonized"]
    text = " ".join(comments)
    for needle in ("cell-days", "MODIS-equivalent", "UTC-8", "California region", "not applied"):
        assert needle in text


def test_provisional_month_has_flag_and_no_anomaly(client: TestClient) -> None:
    _, rows, _ = _parse(client.post(URL, json=FULL_RANGE).text)
    provisional = [r for r in rows if r["period_type"] == "month" and r["provisional"] == "true"]
    assert len(provisional) == 1
    assert provisional[0]["anomaly_absolute"] == ""
    assert provisional[0]["baseline_median"] == ""
    complete = [r for r in rows if r["period_type"] == "month" and r["provisional"] == "false"]
    assert any(r["anomaly_absolute"] != "" for r in complete)


def test_invalid_range_is_422(client: TestClient) -> None:
    body = {"start": "2020-02-01", "end": "2020-01-01"}
    assert client.post(URL, json=body).status_code == 422

"""Unit tests for the `watch` object of `POST /api/v1/stats` (task 26.4).

Requirements 20.1, 20.7, 20.8, 20.14, 20.15. Data are synthetic (`tests/fixtures.py`,
TEST FIXTURE, not NASA data). The area is cell A (34.0, -118.1) only. The latest complete month
is 2026-10 and 2026-11 is the provisional month. `watch_threshold` is 90 in the shipped config.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator, Sequence
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient

from hotspots.api.main import create_app
from tests.fixtures import make_grid_row, write_fixture_dir

PROJECT_CONFIG = Path(__file__).resolve().parents[2] / "config" / "app.yaml"
URL = "/api/v1/stats"
AREA_A: dict[str, Any] = {
    "type": "Polygon",
    "coordinates": [
        [[-118.2, 34.0], [-118.0, 34.0], [-118.0, 34.1], [-118.2, 34.1], [-118.2, 34.0]]
    ],
}
CELL_A = (340, -1181)

MakeClient = Callable[..., TestClient]


def _october_rows(by_year: dict[int, float]) -> list[dict[str, Any]]:
    """Grid rows for cell A in October of each year, plus 3.0 in the provisional 2026-11."""
    rows = [make_grid_row(*CELL_A, y, 10, v) for y, v in by_year.items()]
    rows.append(make_grid_row(*CELL_A, 2026, 11, 3.0))
    return rows


@pytest.fixture
def make_client(tmp_path: Path) -> Iterator[MakeClient]:
    clients: list[TestClient] = []

    def factory(rows: Sequence[dict[str, Any]], **config: Any) -> TestClient:
        raw = yaml.safe_load(PROJECT_CONFIG.read_text(encoding="utf-8"))
        raw["data_dir"] = str(write_fixture_dir(tmp_path, rows))
        raw.update(config)
        path = tmp_path / "app.yaml"
        path.write_text(yaml.safe_dump(raw), encoding="utf-8")
        client = TestClient(create_app(path))
        client.__enter__()
        clients.append(client)
        return client

    yield factory
    for c in clients:
        c.__exit__(None, None, None)


def _watch(client: TestClient, **extra: Any) -> dict[str, Any]:
    body = {"start": "2000-01-01", "end": "2026-12-31", "geometry": AREA_A, **extra}
    response = client.post(URL, json=body)
    assert response.status_code == 200, response.text
    watch: dict[str, Any] = response.json()["watch"]
    return watch


def test_above_normal(make_client: MakeClient) -> None:
    # Zero in every other October, 4.0 in 2026-10: 25 zeros below, one equal, of 26 years.
    watch = _watch(make_client(_october_rows({2026: 4.0})))
    assert watch["level"] == "Above normal"
    assert watch["period"] == "2026-10"
    assert watch["count"] == 4.0
    assert watch["median"] == 0.0
    assert watch["percentile"] == 98.1  # 100 * 25.5 / 26
    assert watch["n_years"] == 26
    assert (watch["baseline_start"], watch["baseline_end"]) == (2001, 2026)
    assert watch["threshold"] == 90
    assert watch["reason"] is None


def test_within_normal_range(make_client: MakeClient) -> None:
    watch = _watch(make_client(_october_rows({y: 5.0 for y in range(2001, 2027)})))
    assert watch["level"] == "Within normal range"
    assert watch["percentile"] == 50.0
    assert watch["median"] == 5.0
    assert watch["count"] == 5.0


def test_not_available_with_fewer_than_five_baseline_years(make_client: MakeClient) -> None:
    client = make_client(_october_rows({2026: 4.0}), record_start="2023-01")
    watch = _watch(client)
    assert watch["level"] == "Not available"
    assert watch["period"] == "2026-10"
    assert watch["n_years"] == 4
    assert watch["median"] is None and watch["percentile"] is None
    assert watch["baseline_start"] is None and watch["baseline_end"] is None
    assert "Fewer than 5" in watch["reason"]


def test_provisional_month_is_reported_not_evaluated(make_client: MakeClient) -> None:
    watch = _watch(make_client(_october_rows({2026: 4.0})))
    assert watch["provisional"] is True
    assert watch["provisional_month"] == "2026-11"
    assert watch["provisional_count"] == 3.0
    assert watch["period"] == "2026-10"  # the evaluated month is the complete one


def test_watch_does_not_depend_on_the_date_range(make_client: MakeClient) -> None:
    client = make_client(_october_rows({2026: 4.0}))
    full = _watch(client)
    narrow = _watch(client, start="2005-01-01", end="2005-12-31")
    assert narrow == full


def test_custom_baseline_years_change_the_level(make_client: MakeClient) -> None:
    values = {y: 100.0 for y in range(2001, 2026)}
    values.update({2001: 1.0, 2002: 2.0, 2003: 3.0, 2004: 4.0, 2005: 5.0, 2026: 50.0})
    client = make_client(_october_rows(values))

    default = _watch(client)
    assert default["level"] == "Within normal range"
    assert default["n_years"] == 26

    custom = _watch(client, baseline_years=[2001, 2005])
    assert custom["level"] == "Above normal"
    assert custom["percentile"] == 100.0
    assert custom["median"] == 3.0
    assert custom["n_years"] == 5
    assert (custom["baseline_start"], custom["baseline_end"]) == (2001, 2005)
    assert custom["count"] == 50.0


def test_configured_threshold_is_used(make_client: MakeClient) -> None:
    rows = _october_rows({y: 5.0 for y in range(2001, 2027)})
    watch = _watch(make_client(rows, watch_threshold=40))
    assert watch["level"] == "Above normal"  # percentile 50 > 40
    assert watch["threshold"] == 40

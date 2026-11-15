"""Unit tests for the share-link routes (task 24.4; requirements 19.6, 29.4).

Data are synthetic (`tests/fixtures.py`, TEST FIXTURE, not NASA data).
"""

from __future__ import annotations

import sqlite3
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient
from hypothesis import given
from hypothesis import strategies as st

from hotspots.api.main import create_app
from hotspots.api.share import (
    RATE_LIMIT_COUNT,
    RETENTION_SECONDS,
    SHARE_DB_ENV_VAR,
    ShareStore,
    share_id_for,
)
from tests.fixtures import default_grid_rows, write_fixture_dir

PROJECT_CONFIG = Path(__file__).resolve().parents[2] / "config" / "app.yaml"
URL = "/api/v1/share"


def _rect(west: float, south: float, east: float, north: float) -> dict[str, Any]:
    return {
        "type": "Polygon",
        "coordinates": [
            [[west, south], [east, south], [east, north], [west, north], [west, south]]
        ],
    }


AREA = _rect(-118.2, 34.0, -118.0, 34.1)


def _config(tmp_path: Path, data_dir: Path) -> Path:
    raw = yaml.safe_load(PROJECT_CONFIG.read_text(encoding="utf-8"))
    raw["data_dir"] = str(data_dir)
    path = tmp_path / "app.yaml"
    path.write_text(yaml.safe_dump(raw), encoding="utf-8")
    return path


@pytest.fixture
def make_client(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Iterator[Callable[[bool], TestClient]]:
    clients: list[TestClient] = []

    def build(with_db: bool) -> TestClient:
        if with_db:
            monkeypatch.setenv(SHARE_DB_ENV_VAR, str(tmp_path / "share.sqlite3"))
        else:
            monkeypatch.delenv(SHARE_DB_ENV_VAR, raising=False)
        data_dir = write_fixture_dir(tmp_path, default_grid_rows())
        client = TestClient(create_app(_config(tmp_path, data_dir)))
        client.__enter__()
        clients.append(client)
        return client

    yield build
    for client in clients:
        client.__exit__(None, None, None)


def test_store_then_read_round_trip(make_client: Callable[[bool], TestClient]) -> None:
    client = make_client(True)
    created = client.post(URL, json={"geometry": AREA})
    assert created.status_code == 200
    share_id = created.json()["id"]
    assert 1 <= len(share_id) <= 16
    read = client.get(f"{URL}/{share_id}")
    assert read.status_code == 200
    assert read.json()["geometry"] == AREA
    # The same area gets the same id.
    assert client.post(URL, json={"geometry": AREA}).json()["id"] == share_id


def test_unknown_and_malformed_ids_are_404(make_client: Callable[[bool], TestClient]) -> None:
    client = make_client(True)
    for bad in ("nosuchid", "x" * 40, "a%20b"):
        response = client.get(f"{URL}/{bad}")
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "not_found"


def test_invalid_geometry_is_not_stored(make_client: Callable[[bool], TestClient]) -> None:
    client = make_client(True)
    bowtie = {
        "type": "Polygon",
        "coordinates": [[[-118, 34], [-117, 35], [-117, 34], [-118, 35], [-118, 34]]],
    }
    response = client.post(URL, json={"geometry": bowtie})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_geometry"


def test_store_unavailable_without_database(make_client: Callable[[bool], TestClient]) -> None:
    client = make_client(False)
    response = client.post(URL, json={"geometry": AREA})
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "share_unavailable"
    assert client.get(f"{URL}/abc").status_code == 503


def test_rate_limit(make_client: Callable[[bool], TestClient]) -> None:
    client = make_client(True)
    codes = [
        client.post(URL, json={"geometry": AREA}).status_code for _ in range(RATE_LIMIT_COUNT + 1)
    ]
    assert codes[:RATE_LIMIT_COUNT] == [200] * RATE_LIMIT_COUNT
    assert codes[-1] == 429


def test_links_expire_after_30_days(tmp_path: Path) -> None:
    now = [1_000_000.0]
    store = ShareStore(tmp_path / "s.sqlite3", clock=lambda: now[0])
    share_id, expires = store.put(AREA)
    assert expires == int(now[0]) + RETENTION_SECONDS
    now[0] += RETENTION_SECONDS - 1
    assert store.get(share_id) is not None
    now[0] += 1
    assert store.get(share_id) is None


def test_statements_are_parameterized(tmp_path: Path) -> None:
    store = ShareStore(tmp_path / "s.sqlite3")
    assert store.get("'; DROP TABLE share; --") is None
    store.put(AREA)
    with sqlite3.connect(tmp_path / "s.sqlite3") as db:
        assert db.execute("SELECT COUNT(*) FROM share").fetchone() == (1,)


@given(
    west=st.floats(-124.0, -120.0),
    south=st.floats(33.0, 37.0),
    width=st.floats(0.01, 2.0),
    height=st.floats(0.01, 2.0),
)
def test_id_is_short_url_safe_and_ignores_sub_micro_degree_noise(
    west: float, south: float, width: float, height: float
) -> None:
    shape = _rect(west, south, west + width, south + height)
    share_id = share_id_for(shape)
    assert 1 <= len(share_id) <= 16
    assert all(c.isalnum() or c in "-_" for c in share_id)
    noisy = _rect(west + 1e-9, south, west + width, south + height)
    assert round(west, 6) != round(west + 1e-9, 6) or share_id_for(noisy) == share_id

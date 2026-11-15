"""Unit tests for app startup, health and meta (task 9.2).

Data are synthetic (`tests/fixtures.py`, TEST FIXTURE, not NASA data).
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient

from hotspots.api import main as main_module
from hotspots.api.limitations import LIMITATIONS
from hotspots.api.main import ConfigurationError, create_app
from hotspots.api.routes import discover_routers
from tests.fixtures import write_fixture_dir

PROJECT_CONFIG = Path(__file__).resolve().parents[2] / "config" / "app.yaml"

MakeConfig = Callable[..., Path]


@pytest.fixture
def make_config(tmp_path: Path) -> MakeConfig:
    """Write a copy of the shipped config with `data_dir` (and other keys) replaced."""

    def _make(data_dir: Path, **overrides: Any) -> Path:
        raw = yaml.safe_load(PROJECT_CONFIG.read_text(encoding="utf-8"))
        raw["data_dir"] = str(data_dir)
        raw.update(overrides)
        path = tmp_path / "app.yaml"
        path.write_text(yaml.safe_dump(raw), encoding="utf-8")
        return path

    return _make


@pytest.fixture
def client(tmp_path: Path, make_config: MakeConfig) -> Iterator[TestClient]:
    data_dir = write_fixture_dir(tmp_path)
    with TestClient(create_app(make_config(data_dir))) as c:
        yield c


@pytest.fixture
def no_data_client(tmp_path: Path, make_config: MakeConfig) -> Iterator[TestClient]:
    with TestClient(create_app(make_config(tmp_path / "missing_folder"))) as c:
        yield c


# --- health ------------------------------------------------------------------------------


def test_health_ok_with_data(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "data_present": True, "latest_month": "2026-11"}


def test_health_503_without_data_and_app_keeps_running(no_data_client: TestClient) -> None:
    response = no_data_client.get("/api/health")
    assert response.status_code == 503
    assert response.json() == {"status": "unavailable", "data_present": False, "latest_month": None}


def test_health_503_when_one_file_is_missing(tmp_path: Path, make_config: MakeConfig) -> None:
    data_dir = write_fixture_dir(tmp_path)
    (data_dir / "detections_harmonized.parquet").unlink()
    with TestClient(create_app(make_config(data_dir))) as c:
        assert c.get("/api/health").status_code == 503


def test_health_503_when_grid_file_is_unreadable(tmp_path: Path, make_config: MakeConfig) -> None:
    data_dir = write_fixture_dir(tmp_path)
    (data_dir / "harmonized_monthly_grid.parquet").write_bytes(b"not a parquet file")
    with TestClient(create_app(make_config(data_dir))) as c:
        response = c.get("/api/health")
    assert response.status_code == 503
    assert response.json()["data_present"] is False


# --- meta --------------------------------------------------------------------------------


def test_meta_fields_from_fixture_data(client: TestClient) -> None:
    response = client.get("/api/v1/meta")
    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "California region"
    assert body["extent"] == {"west": -124.4, "south": 32.5, "east": -114.0, "north": 42.2}
    assert body["record_start"] == "2000-11"
    assert body["first_date"] == "2000-11-01"
    assert body["latest_month"] == "2026-11"
    assert body["latest_month_incomplete"] is True
    assert body["latest_complete_month"] == "2026-10"
    assert body["latest_detection_local_date"].startswith("2026-11-")
    assert body["latest_detection_utc"].endswith("Z")  # explicit UTC designator (Req 30.1)
    assert "UTC-8" in body["time_convention"]
    assert "cell-days" in body["unit"]
    assert body["watch_threshold"] == 90
    assert body["bounds_available"] is False
    assert body["limitations"] == list(LIMITATIONS)


def test_meta_example_areas_come_from_config(client: TestClient) -> None:
    areas = client.get("/api/v1/meta").json()["example_areas"]
    assert 3 <= len(areas) <= 5
    assert all(a["geometry"]["type"] == "Polygon" and a["name"] for a in areas)


def test_meta_respects_config_values(tmp_path: Path, make_config: MakeConfig) -> None:
    data_dir = write_fixture_dir(tmp_path)
    config = make_config(data_dir, watch_threshold=75, record_start="2001-03", example_areas=None)
    with TestClient(create_app(config)) as c:
        body = c.get("/api/v1/meta").json()
    assert body["watch_threshold"] == 75
    assert body["record_start"] == "2001-03"
    assert body["first_date"] == "2001-03-01"
    assert body["example_areas"] == []


def test_meta_limitations_are_plain_and_complete(client: TestClient) -> None:
    text = " ".join(client.get("/api/v1/meta").json()["limitations"])
    for phrase in (
        "overlap period",
        "overpass drift",
        "undercounted",
        "Cloud and smoke",
        "Near-real-time",
        "provisional",
        "quantile mapping",
        "Terra",
        "96 of 98",
        "slightly optimistic",
    ):
        assert phrase in text
    assert "California state" not in text
    assert "boundary" not in text


def test_meta_503_envelope_without_data(no_data_client: TestClient) -> None:
    response = no_data_client.get("/api/v1/meta")
    assert response.status_code == 503
    error = response.json()["error"]
    assert error["code"] == "data_unavailable"
    assert error["request_id"]
    assert "missing_folder" not in response.text  # no server path leaks


def test_meta_is_deterministic(client: TestClient) -> None:
    assert client.get("/api/v1/meta").json() == client.get("/api/v1/meta").json()


# --- startup -----------------------------------------------------------------------------


def test_invalid_config_reports_every_problem(tmp_path: Path, make_config: MakeConfig) -> None:
    config = make_config(write_fixture_dir(tmp_path), record_start="2000-13", watch_threshold=150)
    with pytest.raises(ConfigurationError) as info:
        create_app(config)
    fields = {e.field for e in info.value.errors.errors}
    assert {"record_start", "watch_threshold"} <= fields


def test_missing_config_file_is_a_configuration_error(tmp_path: Path) -> None:
    with pytest.raises(ConfigurationError):
        create_app(tmp_path / "nope.yaml")


def test_import_time_config_error_prints_all_and_exits_1(
    tmp_path: Path,
    make_config: MakeConfig,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    config = make_config(write_fixture_dir(tmp_path), record_start="bad", watch_threshold=0)
    monkeypatch.setenv("HOTSPOTS_CONFIG", str(config))
    monkeypatch.setattr(main_module, "_app", None)
    with pytest.raises(SystemExit) as exit_info:
        _ = main_module.app  # type: ignore[attr-defined]
    assert exit_info.value.code == 1
    err = capsys.readouterr().err
    assert "record_start" in err and "watch_threshold" in err


def test_app_attribute_builds_the_app_from_env_config(
    tmp_path: Path, make_config: MakeConfig, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("HOTSPOTS_CONFIG", str(make_config(write_fixture_dir(tmp_path))))
    monkeypatch.setattr(main_module, "_app", None)
    app = main_module.app  # type: ignore[attr-defined]
    assert isinstance(app, FastAPI)
    assert main_module.app is app  # type: ignore[attr-defined]


def test_unknown_module_attribute_raises() -> None:
    with pytest.raises(AttributeError):
        _ = main_module.nothing_here  # type: ignore[attr-defined]


def test_cors_is_disabled(client: TestClient) -> None:
    response = client.get("/api/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in response.headers
    preflight = client.options(
        "/api/health",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"},
    )
    assert "access-control-allow-origin" not in preflight.headers


def test_routers_are_discovered_by_name() -> None:
    routers = discover_routers()
    paths = {route.path for r in routers for route in r.routes}  # type: ignore[attr-defined]
    assert {"/api/health", "/api/v1/meta"} <= paths
    assert all(isinstance(r, APIRouter) for r in routers)


def test_error_envelope_on_unknown_api_path(client: TestClient) -> None:
    response = client.get("/api/v1/nope")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


# --- static front end --------------------------------------------------------------------


@pytest.fixture
def static_client(tmp_path: Path, make_config: MakeConfig) -> Iterator[TestClient]:
    static = tmp_path / "static"
    (static / "assets").mkdir(parents=True)
    (static / "index.html").write_text("<html>app shell</html>", encoding="utf-8")
    (static / "assets" / "app.js").write_text("console.log(1)", encoding="utf-8")
    (tmp_path / "secret.txt").write_text("outside", encoding="utf-8")
    app = create_app(make_config(write_fixture_dir(tmp_path)), static_dir=static)
    with TestClient(app) as c:
        yield c


def test_static_serves_index_asset_and_spa_fallback(static_client: TestClient) -> None:
    assert "app shell" in static_client.get("/").text
    assert static_client.get("/assets/app.js").text == "console.log(1)"
    spa = static_client.get("/methods")
    assert spa.status_code == 200 and "app shell" in spa.text


def test_static_missing_asset_and_unknown_api_path_are_404(static_client: TestClient) -> None:
    assert static_client.get("/assets/missing.js").status_code == 404
    api = static_client.get("/api/v1/nope")
    assert api.status_code == 404 and api.json()["error"]["code"] == "not_found"


def test_static_does_not_override_api_routes(static_client: TestClient) -> None:
    assert static_client.get("/api/health").json()["status"] == "ok"
    assert static_client.get("/api/v1/meta").status_code == 200


def test_static_blocks_path_traversal(static_client: TestClient) -> None:
    response = static_client.get("/..%2Fsecret.txt")
    assert "outside" not in response.text


def test_static_dir_from_environment(
    tmp_path: Path, make_config: MakeConfig, monkeypatch: pytest.MonkeyPatch
) -> None:
    static = tmp_path / "web_dist"
    static.mkdir()
    (static / "index.html").write_text("<html>from env</html>", encoding="utf-8")
    monkeypatch.setenv("HOTSPOTS_STATIC_DIR", str(static))
    with TestClient(create_app(make_config(write_fixture_dir(tmp_path)))) as c:
        assert "from env" in c.get("/anything").text


def test_static_dir_without_index_is_ignored(tmp_path: Path, make_config: MakeConfig) -> None:
    empty = tmp_path / "empty"
    empty.mkdir()
    app = create_app(make_config(write_fixture_dir(tmp_path)), static_dir=empty)
    with TestClient(app) as c:
        assert c.get("/").status_code == 404

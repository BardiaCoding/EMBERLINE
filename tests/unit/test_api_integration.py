"""Integration-style unit tests for the real app (task 9.4).

Requirements 29.5, 29.7, 32.4, 32.7. These fill the gaps left by `test_api_main.py`,
`test_api_calendar.py` and `test_api_errors.py`: they go through `create_app` (real routers,
real middleware, real error handlers) and check that errors keep the one envelope and that no
response reveals the data folder path, a stack trace or a secret.

Data are synthetic (`tests/fixtures.py`, TEST FIXTURE, not NASA data).
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient

from hotspots.api.schemas import MAX_BODY_BYTES
from hotspots.data import DataStore
from hotspots.data.types import DataUnavailableError as StoreUnavailableError
from tests.fixtures import FIXTURE_DIRNAME, write_fixture_dir

PROJECT_CONFIG = Path(__file__).resolve().parents[2] / "config" / "app.yaml"
CALENDAR = "/api/v1/calendar"
FULL_RANGE = {"start": "2000-01-01", "end": "2026-12-31"}
SECRET = "token=abc123-not-for-clients"

AppFactory = Callable[..., TestClient]


@pytest.fixture
def data_dir(tmp_path: Path) -> Path:
    return write_fixture_dir(tmp_path)


@pytest.fixture
def make_client(tmp_path: Path, data_dir: Path) -> Iterator[AppFactory]:
    """Build clients on the real app. `raise_server_exceptions=False` mimics a real server."""
    from hotspots.api.main import create_app

    opened: list[TestClient] = []

    def _make(*, static_dir: Path | None = None, with_data: bool = True) -> TestClient:
        raw = yaml.safe_load(PROJECT_CONFIG.read_text(encoding="utf-8"))
        raw["data_dir"] = str(data_dir if with_data else tmp_path / "missing_folder")
        config_path = tmp_path / "app.yaml"
        config_path.write_text(yaml.safe_dump(raw), encoding="utf-8")
        client = TestClient(
            create_app(config_path, static_dir=static_dir), raise_server_exceptions=False
        )
        client.__enter__()
        opened.append(client)
        return client

    yield _make
    for client in opened:
        client.__exit__(None, None, None)


def _assert_envelope(response: Any, status: int, code: str) -> dict[str, Any]:
    assert response.status_code == status
    body = response.json()
    assert set(body) == {"error"}
    error = body["error"]
    assert set(error) == {"code", "message", "fields", "request_id"}
    assert error["code"] == code
    assert error["request_id"] and error["request_id"] == response.headers["x-request-id"]
    return error  # type: ignore[no-any-return]


def _assert_no_leak(text: str, data_dir: Path) -> None:
    for leaked in (
        str(data_dir),
        str(data_dir.parent),
        FIXTURE_DIRNAME,
        ".parquet",
        "Traceback",
        'File "',
        SECRET,
    ):
        assert leaked not in text


# --- 500 from inside a real route ---------------------------------------------------------


def test_500_inside_calendar_route_returns_envelope_without_trace_or_path(
    make_client: AppFactory,
    data_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    def explode(*_: Any, **__: Any) -> None:
        raise RuntimeError(f"cannot read {data_dir}/harmonized_monthly_grid.parquet {SECRET}")

    monkeypatch.setattr("hotspots.api.routes.calendar.compute_area_result", explode)
    client = make_client()
    with caplog.at_level("ERROR", logger="hotspots.api"):
        response = client.post(CALENDAR, json=FULL_RANGE)

    error = _assert_envelope(response, 500, "internal_error")
    assert error["fields"] == []
    assert error["message"] == "An internal error occurred."
    _assert_no_leak(response.text, data_dir)
    assert "RuntimeError" not in response.text
    # The trace stays in the server log, tied to the same request id.
    assert any(error["request_id"] in r.getMessage() and r.exc_info for r in caplog.records)


def test_500_request_ids_differ_between_requests(
    make_client: AppFactory, monkeypatch: pytest.MonkeyPatch
) -> None:
    def explode(*_: Any, **__: Any) -> None:
        raise ValueError("boom")

    monkeypatch.setattr("hotspots.api.routes.calendar.compute_area_result", explode)
    client = make_client()
    first = client.post(CALENDAR, json=FULL_RANGE).json()["error"]["request_id"]
    second = client.post(CALENDAR, json=FULL_RANGE).json()["error"]["request_id"]
    assert first != second


def test_500_is_an_envelope_when_the_front_end_is_served(
    make_client: AppFactory, tmp_path: Path, data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text("<html>app shell</html>", encoding="utf-8")

    def explode(*_: Any, **__: Any) -> None:
        raise RuntimeError(SECRET)

    monkeypatch.setattr("hotspots.api.routes.calendar.compute_area_result", explode)
    response = make_client(static_dir=static).post(CALENDAR, json=FULL_RANGE)
    _assert_envelope(response, 500, "internal_error")
    assert "app shell" not in response.text
    _assert_no_leak(response.text, data_dir)


def test_data_layer_failure_mid_request_is_503_without_the_path(
    make_client: AppFactory, data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    client = make_client()

    def unreadable(self: DataStore) -> None:
        raise StoreUnavailableError(f"cannot read {data_dir}/harmonized_monthly_grid.parquet")

    monkeypatch.setattr(DataStore, "grid", unreadable)
    response = client.post(CALENDAR, json=FULL_RANGE)
    error = _assert_envelope(response, 503, "data_unavailable")
    assert error["message"] == "Data not available."
    _assert_no_leak(response.text, data_dir)


# --- 413, 404, 405 through the real app ---------------------------------------------------


def test_413_oversized_body_through_the_real_app(make_client: AppFactory) -> None:
    client = make_client()
    response = client.post(
        CALENDAR,
        content=b" " * (MAX_BODY_BYTES + 1),
        headers={"content-type": "application/json"},
    )
    _assert_envelope(response, 413, "payload_too_large")


def test_413_streamed_body_through_the_real_app(make_client: AppFactory) -> None:
    def chunks() -> Iterator[bytes]:
        for _ in range(7):
            yield b" " * (1024 * 1024)

    response = make_client().post(
        CALENDAR, content=chunks(), headers={"content-type": "application/json"}
    )
    _assert_envelope(response, 413, "payload_too_large")


def test_body_at_the_limit_is_not_413(make_client: AppFactory) -> None:
    padding = " " * (MAX_BODY_BYTES - 100)
    body = ('{"start": "2001-01-01", "end": "2001-12-31"}' + padding).encode()
    assert len(body) <= MAX_BODY_BYTES
    response = make_client().post(
        CALENDAR, content=body, headers={"content-type": "application/json"}
    )
    assert response.status_code == 200


def test_404_envelope_for_unknown_api_path(make_client: AppFactory) -> None:
    response = make_client().get("/api/v1/does-not-exist")
    error = _assert_envelope(response, 404, "not_found")
    assert error["message"] == "Not found."


def test_405_envelope_for_wrong_method(make_client: AppFactory) -> None:
    client = make_client()
    get_calendar = client.get(CALENDAR)
    _assert_envelope(get_calendar, 405, "method_not_allowed")
    assert "POST" in get_calendar.headers["allow"]
    _assert_envelope(client.post("/api/health"), 405, "method_not_allowed")
    _assert_envelope(client.delete("/api/v1/meta"), 405, "method_not_allowed")


def test_422_missing_required_fields_names_them(make_client: AppFactory) -> None:
    response = make_client().post(CALENDAR, json={})
    error = _assert_envelope(response, 422, "validation_error")
    assert {"start", "end"} <= {f["field"] for f in error["fields"]}
    assert all(f["reason"] for f in error["fields"])


def test_422_for_non_json_content(make_client: AppFactory) -> None:
    response = make_client().post(
        CALENDAR, content=b"start=2001-01-01", headers={"content-type": "text/plain"}
    )
    _assert_envelope(response, 422, "validation_error")


# --- front end does not shadow the API ----------------------------------------------------


@pytest.fixture
def static_client(make_client: AppFactory, tmp_path: Path) -> TestClient:
    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text("<html>app shell</html>", encoding="utf-8")
    return make_client(static_dir=static)


def test_spa_fallback_does_not_shadow_api_paths(static_client: TestClient) -> None:
    for path in ("/api", "/api/", "/api/v1/nope", "/api/v1/meta/extra", "/api/healthz"):
        response = static_client.get(path)
        assert response.status_code == 404, path
        _assert_envelope(response, 404, "not_found")
        assert "app shell" not in response.text


def test_spa_fallback_serves_client_routes_only_outside_api(static_client: TestClient) -> None:
    assert "app shell" in static_client.get("/area/custom").text
    assert static_client.get("/api/health").json()["status"] == "ok"
    assert static_client.post(CALENDAR, json=FULL_RANGE).status_code == 200


def test_get_on_post_only_api_route_is_not_the_app_shell(static_client: TestClient) -> None:
    response = static_client.get(CALENDAR)
    assert response.status_code in {404, 405}
    assert "app shell" not in response.text
    assert response.json()["error"]["request_id"]


def test_post_to_a_client_route_is_405_envelope(static_client: TestClient) -> None:
    _assert_envelope(static_client.post("/area/custom"), 405, "method_not_allowed")


# --- CORS and path leaks ------------------------------------------------------------------


def test_no_cors_headers_on_any_response_kind(make_client: AppFactory) -> None:
    client = make_client()
    origin = {"Origin": "https://evil.example"}
    responses = [
        client.get("/api/v1/meta", headers=origin),
        client.post(CALENDAR, json=FULL_RANGE, headers=origin),
        client.post(CALENDAR, json={}, headers=origin),
        client.get("/api/v1/nope", headers=origin),
    ]
    for response in responses:
        assert not [h for h in response.headers if h.lower().startswith("access-control-")]


def test_no_response_reveals_the_data_folder(make_client: AppFactory, data_dir: Path) -> None:
    client = make_client()
    responses = [
        client.get("/api/health"),
        client.get("/api/v1/meta"),
        client.post(CALENDAR, json=FULL_RANGE),
        client.post(CALENDAR, json={}),
        client.post(CALENDAR, json={**FULL_RANGE, "baseline_years": [2001, 2002]}),
        client.get("/api/v1/nope"),
        client.get("/openapi.json"),
    ]
    for response in responses:
        _assert_no_leak(response.text, data_dir)
        assert str(data_dir) not in str(dict(response.headers))


def test_no_data_state_reveals_no_path_on_any_route(
    make_client: AppFactory, tmp_path: Path
) -> None:
    client = make_client(with_data=False)
    responses = [
        client.get("/api/health"),
        client.get("/api/v1/meta"),
        client.post(CALENDAR, json=FULL_RANGE),
    ]
    assert [r.status_code for r in responses] == [503, 503, 503]
    for response in responses:
        assert "missing_folder" not in response.text
        assert str(tmp_path) not in response.text
    _assert_envelope(responses[1], 503, "data_unavailable")
    _assert_envelope(responses[2], 503, "data_unavailable")


# --- selection edge cases through the real app --------------------------------------------


def test_october_2000_and_excluded_cell_absent_from_every_response(
    make_client: AppFactory,
) -> None:
    client = make_client()
    body = client.post(CALENDAR, json={"start": "2000-01-01", "end": "2001-12-31"}).json()
    labels = [(m["year"], m["month"]) for m in body["months"]]
    assert (2000, 10) not in labels
    assert labels[0] == (2000, 11)
    assert body["coverage"]["first_month"] == "2000-11"
    assert "38.7000_-117.4000" not in client.post(CALENDAR, json=FULL_RANGE).text


@pytest.mark.parametrize(
    "value",
    [
        "2001-01-01'; DROP TABLE harmonized_monthly_grid;--",
        "2001-01-01\x00",
        "../../etc/passwd",
        "${jndi:ldap://x}",
        "<script>alert(1)</script>",
    ],
)
def test_injection_style_dates_are_rejected_and_not_echoed(
    make_client: AppFactory, value: str
) -> None:
    response = make_client().post(CALENDAR, json={"start": value, "end": "2001-12-31"})
    _assert_envelope(response, 422, "validation_error")
    for fragment in ("DROP TABLE", "passwd", "jndi", "<script>"):
        assert fragment not in response.text


def test_injection_style_query_string_is_ignored_by_get_routes(make_client: AppFactory) -> None:
    response = make_client().get("/api/v1/meta", params={"x": "1'; DROP TABLE t;--"})
    assert response.status_code == 200
    assert "DROP TABLE" not in response.text

"""Unit tests for the deployment smoke check (task 12.2).

The check runs against the real FastAPI app through `TestClient` (no network) and, for the
standard-library transport, against a throwaway server on loopback. Data are synthetic
(`tests/fixtures.py`, TEST FIXTURE, not NASA data).
"""

from __future__ import annotations

import json
import threading
from collections.abc import Callable, Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient
from hypothesis import given
from hypothesis import strategies as st

from hotspots import smoke
from hotspots.api.main import create_app
from hotspots.smoke import CheckResult, Response, TransportError
from tests.fixtures import write_fixture_dir

PROJECT_CONFIG = Path(__file__).resolve().parents[2] / "config" / "app.yaml"
BASE = "http://testserver"
INDEX_HTML = '<!doctype html><html><body><div id="root"></div></body></html>'

Mutate = Callable[[dict[str, Any]], None]


def _app_config(tmp_path: Path, data_dir: Path) -> Path:
    raw = yaml.safe_load(PROJECT_CONFIG.read_text(encoding="utf-8"))
    raw["data_dir"] = str(data_dir)
    path = tmp_path / "app.yaml"
    path.write_text(yaml.safe_dump(raw), encoding="utf-8")
    return path


def _static_dir(tmp_path: Path, html: str = INDEX_HTML) -> Path:
    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text(html, encoding="utf-8")
    return static


def client_transport(client: TestClient, *, elapsed_s: float = 0.05) -> smoke.Transport:
    """A smoke-check transport that sends requests to an in-process app."""

    def transport(method: str, url: str, json_body: object | None, timeout_s: float) -> Response:
        reply = client.request(method, url, json=json_body)
        headers = {k.lower(): v for k, v in reply.headers.items()}
        return Response(reply.status_code, headers, reply.content, elapsed_s)

    return transport


def tweak_json(inner: smoke.Transport, path: str, mutate: Mutate) -> smoke.Transport:
    """Wrap `inner` so the JSON body of the response for `path` is changed by `mutate`."""

    def transport(method: str, url: str, json_body: object | None, timeout_s: float) -> Response:
        reply = inner(method, url, json_body, timeout_s)
        if not url.endswith(path):
            return reply
        body = json.loads(reply.body)
        mutate(body)
        return Response(reply.status, reply.headers, json.dumps(body).encode(), reply.elapsed_s)

    return transport


@pytest.fixture
def healthy(tmp_path: Path) -> Iterator[TestClient]:
    app = create_app(
        _app_config(tmp_path, write_fixture_dir(tmp_path)), static_dir=_static_dir(tmp_path)
    )
    with TestClient(app) as client:
        yield client


@pytest.fixture
def no_data(tmp_path: Path) -> Iterator[TestClient]:
    app = create_app(_app_config(tmp_path, tmp_path / "missing"), static_dir=_static_dir(tmp_path))
    with TestClient(app) as client:
        yield client


def by_name(results: list[CheckResult]) -> dict[str, CheckResult]:
    return {r.name: r for r in results}


# --- healthy deployment ------------------------------------------------------------------


def test_all_checks_pass_on_a_healthy_deployment(healthy: TestClient) -> None:
    results = smoke.run_checks(BASE, transport=client_transport(healthy))
    assert [r.name for r in results] == [
        "GET /",
        "GET /api/health",
        "GET /api/v1/meta",
        "POST /api/v1/calendar",
    ]
    assert all(r.ok for r in results), smoke.format_results(results)
    assert "latest month 2026-11" in by_name(results)["GET /api/health"].detail


def test_main_prints_pass_lines_and_exits_zero(
    healthy: TestClient, capsys: pytest.CaptureFixture[str]
) -> None:
    code = smoke.main([BASE + "/"], transport=client_transport(healthy))
    out = capsys.readouterr().out
    assert code == 0
    assert out.count("PASS  ") == 4 and "FAIL" not in out
    assert "SMOKE CHECK PASSED" in out


def test_calendar_request_has_no_geometry_and_spans_the_record(healthy: TestClient) -> None:
    sent: list[tuple[str, str, object | None]] = []
    inner = client_transport(healthy)

    def spy(method: str, url: str, json_body: object | None, timeout_s: float) -> Response:
        sent.append((method, url, json_body))
        return inner(method, url, json_body, timeout_s)

    smoke.run_checks(BASE, transport=spy)
    (post,) = [s for s in sent if s[0] == "POST"]
    assert post[1] == f"{BASE}/api/v1/calendar"
    assert post[2] == {"start": "2000-11-01", "end": "2026-11-30"}  # no geometry: full extent


# --- failures ----------------------------------------------------------------------------


def test_missing_data_fails_health_meta_and_calendar(
    no_data: TestClient, capsys: pytest.CaptureFixture[str]
) -> None:
    transport = client_transport(no_data)
    results = by_name(smoke.run_checks(BASE, transport=transport))
    assert results["GET /"].ok
    assert not results["GET /api/health"].ok and "HTTP 503" in results["GET /api/health"].detail
    assert "data_unavailable" in results["GET /api/v1/meta"].detail
    assert "not run" in results["POST /api/v1/calendar"].detail
    assert smoke.main([BASE], transport=transport) == 1
    out = capsys.readouterr().out
    assert "FAIL  GET /api/health" in out and "SMOKE CHECK FAILED: 3 of 4" in out


def test_missing_front_end_fails_only_the_index_check(tmp_path: Path) -> None:
    app = create_app(_app_config(tmp_path, write_fixture_dir(tmp_path)))  # no static dir
    with TestClient(app) as client:
        results = by_name(smoke.run_checks(BASE, transport=client_transport(client)))
    assert not results["GET /"].ok and "HTTP 404" in results["GET /"].detail
    assert all(r.ok for name, r in results.items() if name != "GET /")


def test_index_without_mount_point_fails(tmp_path: Path) -> None:
    static = _static_dir(tmp_path, "<html>no app here</html>")
    app = create_app(_app_config(tmp_path, write_fixture_dir(tmp_path)), static_dir=static)
    with TestClient(app) as client:
        result = smoke.run_checks(BASE, transport=client_transport(client))[0]
    assert not result.ok and "mount point" in result.detail


def test_slow_health_fails_with_the_measured_time(healthy: TestClient) -> None:
    results = by_name(smoke.run_checks(BASE, transport=client_transport(healthy, elapsed_s=1.5)))
    health = results["GET /api/health"]
    assert not health.ok and "1.50 s" in health.detail and "limit is 1 s" in health.detail


def test_health_limit_is_configurable(healthy: TestClient) -> None:
    transport = client_transport(healthy, elapsed_s=1.5)
    results = smoke.run_checks(BASE, transport=transport, health_limit_s=2.0)
    assert all(r.ok for r in results)


def test_unreachable_server_fails_every_check_with_a_message() -> None:
    def refuse(method: str, url: str, json_body: object | None, timeout_s: float) -> Response:
        raise TransportError("ConnectionRefusedError: connection refused")

    results = smoke.run_checks("https://down.example", transport=refuse)
    assert not any(r.ok for r in results)
    assert "https://down.example/api/health" in results[1].detail
    assert "connection refused" in results[1].detail
    assert smoke.main(["https://down.example"], transport=refuse) == 1


@pytest.mark.parametrize(
    ("path", "mutate", "expected"),
    [
        ("/api/health", lambda b: b.update(latest_month="soon"), "latest_month is not YYYY-MM"),
        ("/api/v1/meta", lambda b: b.update(name="California state"), "expected 'California reg"),
        ("/api/v1/meta", lambda b: b.pop("unit"), "field 'unit'"),
        ("/api/v1/meta", lambda b: b.update(limitations=[]), "limitations is missing or empty"),
        ("/api/v1/meta", lambda b: b["extent"].update(west=0.0, east=-1.0), "extent is empty"),
        ("/api/v1/meta", lambda b: b.update(latest_month="2026-10"), "differs from /api/health"),
        ("/api/v1/calendar", lambda b: b.update(months=[]), "months is missing or empty"),
        ("/api/v1/calendar", lambda b: b.update(n_cells=0), "n_cells must be a positive"),
        (
            "/api/v1/calendar",
            lambda b: b.update(baseline_by_month=b["baseline_by_month"][:11]),
            "12 calendar months",
        ),
        (
            "/api/v1/calendar",
            lambda b: b.update(provisional_months=[]),
            "not marked provisional",
        ),
        (
            "/api/v1/calendar",
            lambda b: b["months"][-1].update(provisional=False),
            "must be provisional",
        ),
        ("/api/v1/calendar", lambda b: b["months"].pop(), "last month is 2026-10"),
    ],
)
def test_malformed_responses_are_reported_with_a_reason(
    healthy: TestClient, path: str, mutate: Mutate, expected: str
) -> None:
    transport = tweak_json(client_transport(healthy), path, mutate)
    failed = [r for r in smoke.run_checks(BASE, transport=transport) if not r.ok]
    assert any(expected in r.detail for r in failed), smoke.format_results(failed)


# --- command line ------------------------------------------------------------------------


@pytest.mark.parametrize(
    "bad", ["", "localhost:7860", "ftp://example.org", "https://", "http://a/?x=1"]
)
def test_invalid_base_url_exits_two_without_requests(
    bad: str, capsys: pytest.CaptureFixture[str]
) -> None:
    def forbidden(method: str, url: str, json_body: object | None, timeout_s: float) -> Response:
        raise AssertionError("no request may be sent for an invalid URL")

    assert smoke.main([bad], transport=forbidden) == 2
    assert "error:" in capsys.readouterr().err


def test_missing_argument_exits_two(capsys: pytest.CaptureFixture[str]) -> None:
    assert smoke.main([]) == 2
    assert "base_url" in capsys.readouterr().err


@given(
    host=st.from_regex(r"[a-z][a-z0-9-]{0,20}(\.[a-z]{2,5}){0,2}", fullmatch=True),
    path=st.from_regex(r"(/[a-z0-9]{1,8}){0,3}", fullmatch=True),
    slashes=st.integers(min_value=0, max_value=5),
    scheme=st.sampled_from(["http", "https"]),
)
def test_normalize_base_url_drops_trailing_slashes_only(
    host: str, path: str, slashes: int, scheme: str
) -> None:
    clean = f"{scheme}://{host}{path}"
    assert smoke.normalize_base_url(clean + "/" * slashes) == clean


# --- standard-library transport (loopback server) ----------------------------------------


class _Recorder(BaseHTTPRequestHandler):
    """Answers JSON on /ok, 503 on /down and slowly nothing else. Records request headers."""

    seen: list[dict[str, str]] = []

    def _reply(self, status: int, body: bytes) -> None:
        type(self).seen.append({k.lower(): v for k, v in self.headers.items()})
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        self._reply(503 if self.path == "/down" else 200, b'{"status": "x"}')

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length", "0"))
        self._reply(200, self.rfile.read(length))

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        pass


@pytest.fixture
def loopback() -> Iterator[str]:
    _Recorder.seen = []
    server = HTTPServer(("127.0.0.1", 0), _Recorder)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def test_urllib_transport_reads_status_headers_body_and_time(loopback: str) -> None:
    reply = smoke.urllib_transport("GET", f"{loopback}/ok", None, 5.0)
    assert reply.status == 200
    assert reply.headers["content-type"] == "application/json"
    assert json.loads(reply.body) == {"status": "x"}
    assert 0 <= reply.elapsed_s < 5


def test_urllib_transport_returns_http_errors_as_responses(loopback: str) -> None:
    reply = smoke.urllib_transport("GET", f"{loopback}/down", None, 5.0)
    assert reply.status == 503 and json.loads(reply.body) == {"status": "x"}


def test_urllib_transport_posts_json_and_sends_no_cookies_or_credentials(loopback: str) -> None:
    reply = smoke.urllib_transport("POST", f"{loopback}/api", {"start": "2000-11-01"}, 5.0)
    assert json.loads(reply.body) == {"start": "2000-11-01"}
    (headers,) = _Recorder.seen
    assert headers["content-type"] == "application/json"
    assert not {"cookie", "authorization", "proxy-authorization"} & headers.keys()


def test_urllib_transport_raises_transport_error_when_nothing_listens() -> None:
    server = HTTPServer(("127.0.0.1", 0), _Recorder)
    port = server.server_address[1]
    server.server_close()  # the port is now closed
    with pytest.raises(TransportError):
        smoke.urllib_transport("GET", f"http://127.0.0.1:{port}/", None, 2.0)

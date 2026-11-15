"""Unit tests for the API error envelope, using a throwaway FastAPI app (not main.py)."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from hotspots.api.errors import (
    ApiValidationError,
    DataUnavailableError,
    install_error_handling,
)
from hotspots.api.schemas import MAX_BODY_BYTES, FieldError, QueryIn

SECRET_PATH = "/srv/secret-place/data.parquet"


def _make_app() -> FastAPI:
    app = FastAPI()
    install_error_handling(app)

    @app.post("/q")
    def query(body: QueryIn) -> dict[str, str]:
        return {"ok": "yes"}

    @app.get("/unavailable")
    def unavailable() -> None:
        raise DataUnavailableError()

    @app.get("/invalid")
    def invalid() -> None:
        raise ApiValidationError(
            "invalid_geometry",
            "Polygon self-intersects.",
            [FieldError(field="geometry", reason="self_intersection")],
        )

    @app.get("/boom")
    def boom() -> None:
        raise RuntimeError(f"cannot open {SECRET_PATH} token=abc123")

    return app


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(_make_app(), raise_server_exceptions=False) as c:
        yield c


def _error(response: Any) -> dict[str, Any]:
    body = response.json()
    assert set(body) == {"error"}
    err = body["error"]
    assert set(err) == {"code", "message", "fields", "request_id"}
    assert err["request_id"] == response.headers["x-request-id"]
    return err


def test_422_lists_field_paths_and_reasons(client: TestClient) -> None:
    payload = {
        "start": "2020-02-01",
        "end": "2020-01-01",
        "geometry": {"type": "Point", "coordinates": [0, 0]},
        "bogus": "SECRET-INPUT",
    }
    response = client.post("/q", json=payload)
    assert response.status_code == 422
    err = _error(response)
    assert err["code"] == "validation_error"
    fields = {f["field"]: f["reason"] for f in err["fields"]}
    assert fields["end"] == "end must not be before start"
    assert "geometry.type" in fields
    assert "bogus" in fields
    assert "SECRET-INPUT" not in response.text


def test_422_for_malformed_json(client: TestClient) -> None:
    response = client.post("/q", content=b"{not json", headers={"content-type": "application/json"})
    assert response.status_code == 422
    assert _error(response)["fields"][0]["field"] != ""


def test_422_custom_code_and_fields(client: TestClient) -> None:
    response = client.get("/invalid")
    assert response.status_code == 422
    err = _error(response)
    assert err["code"] == "invalid_geometry"
    assert err["fields"] == [{"field": "geometry", "reason": "self_intersection"}]


def test_503_data_unavailable(client: TestClient) -> None:
    response = client.get("/unavailable")
    assert response.status_code == 503
    assert _error(response)["code"] == "data_unavailable"


def test_413_declared_content_length(client: TestClient) -> None:
    response = client.post(
        "/q", content=b"x" * (MAX_BODY_BYTES + 1), headers={"content-type": "application/json"}
    )
    assert response.status_code == 413
    assert _error(response)["code"] == "payload_too_large"


def test_413_streamed_body_without_content_length(client: TestClient) -> None:
    def chunks() -> Iterator[bytes]:
        for _ in range(7):
            yield b" " * (1024 * 1024)

    response = client.post("/q", content=chunks(), headers={"content-type": "application/json"})
    assert response.status_code == 413
    assert _error(response)["code"] == "payload_too_large"


def test_500_has_request_id_and_leaks_nothing(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level("ERROR", logger="hotspots.api"):
        response = client.get("/boom")
    assert response.status_code == 500
    err = _error(response)
    assert err["code"] == "internal_error"
    assert err["fields"] == []
    for leaked in (SECRET_PATH, "abc123", "Traceback", "RuntimeError", "errors.py"):
        assert leaked not in response.text
    # The trace is logged, with the same request id.
    assert any(err["request_id"] in r.getMessage() and r.exc_info for r in caplog.records)


def test_unknown_route_uses_the_envelope(client: TestClient) -> None:
    response = client.get("/nope")
    assert response.status_code == 404
    assert _error(response)["code"] == "not_found"


def test_success_responses_carry_request_id(client: TestClient) -> None:
    response = client.post("/q", json={"start": "2020-01-01", "end": "2020-02-01"})
    assert response.status_code == 200
    assert response.headers["x-request-id"]

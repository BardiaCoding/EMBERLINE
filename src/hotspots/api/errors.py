"""One error envelope for every API error (Requirements 13.6, 29.4, 29.7).

```json
{"error": {"code": "...", "message": "...", "fields": [{"field": "...", "reason": "..."}],
           "request_id": "..."}}
```

- 422: invalid input, with one `{field, reason}` per problem. Submitted values are not echoed.
- 413: request body over `MAX_BODY_BYTES`.
- 503 `data_unavailable`: the delivered data files are missing.
- 500 `internal_error`: fixed message and the request id. The stack trace is logged only and
  never returned, so no server path or secret reaches the client.

Call `install_error_handling(app)` once on the FastAPI app.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Awaitable, Callable, MutableMapping
from typing import Any, Final

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from hotspots.api.schemas import MAX_BODY_BYTES, ErrorBody, ErrorOut, FieldError
from hotspots.data.types import DataUnavailableError as StoreUnavailableError

logger = logging.getLogger("hotspots.api")

REQUEST_ID_HEADER: Final[str] = "X-Request-ID"
MAX_FIELD_ERRORS: Final[int] = 50

_VALUE_ERROR_PREFIX: Final[str] = "Value error, "

_HTTP_CODES: Final[dict[int, str]] = {
    400: "bad_request",
    404: "not_found",
    405: "method_not_allowed",
    413: "payload_too_large",
    422: "validation_error",
    503: "data_unavailable",
}

Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
ASGIApp = Callable[[Scope, Receive, Send], Awaitable[None]]


# --- exceptions raised by routes ---------------------------------------------------------


class ApiError(HTTPException):
    """An error with a status, a machine-readable code, a message and field reasons.

    It subclasses `HTTPException` so FastAPI re-raises it unchanged from body parsing.
    """

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        fields: list[FieldError] | None = None,
    ) -> None:
        super().__init__(status_code=status_code, detail=message)
        self.code = code
        self.message = message
        self.fields = fields or []


class ApiValidationError(ApiError):
    """HTTP 422 with a chosen code (for example `invalid_geometry`, `outside_coverage`)."""

    def __init__(
        self,
        code: str,
        message: str,
        fields: list[FieldError] | None = None,
    ) -> None:
        super().__init__(422, code, message, fields)


class DataUnavailableError(ApiError):
    """HTTP 503 `data_unavailable`: the delivered Parquet files are missing."""

    def __init__(self, message: str = "Data not available.") -> None:
        super().__init__(503, "data_unavailable", message)


class PayloadTooLargeError(ApiError):
    """HTTP 413: the request body is larger than `MAX_BODY_BYTES`."""

    def __init__(self, limit: int = MAX_BODY_BYTES) -> None:
        super().__init__(
            413,
            "payload_too_large",
            f"Request body is larger than the {limit // (1024 * 1024)} MB limit.",
        )


# --- helpers -----------------------------------------------------------------------------


def new_request_id() -> str:
    return uuid.uuid4().hex


def request_id_of(request: Request) -> str:
    """The id set by `RequestContextMiddleware`, or a new one when the middleware is absent."""
    state_id = getattr(request.state, "request_id", None)
    if isinstance(state_id, str) and state_id:
        return state_id
    rid = new_request_id()
    request.state.request_id = rid
    return rid


def error_response(
    status_code: int,
    code: str,
    message: str,
    request_id: str,
    fields: list[FieldError] | None = None,
) -> JSONResponse:
    """Build the error envelope as a JSON response carrying the request id header."""
    body = ErrorOut(
        error=ErrorBody(code=code, message=message, fields=fields or [], request_id=request_id)
    )
    return JSONResponse(
        status_code=status_code,
        content=body.model_dump(mode="json"),
        headers={REQUEST_ID_HEADER: request_id},
    )


def field_errors_from_validation(exc: RequestValidationError) -> list[FieldError]:
    """Map pydantic errors to `{field, reason}`. Submitted input values are never echoed."""
    out: list[FieldError] = []
    for item in exc.errors()[:MAX_FIELD_ERRORS]:
        loc = [str(part) for part in item.get("loc", ()) if part != "body"]
        reason = str(item.get("msg", "invalid value"))
        reason = reason.removeprefix(_VALUE_ERROR_PREFIX)
        out.append(FieldError(field=".".join(loc) or "body", reason=reason))
    return out


# --- handlers ----------------------------------------------------------------------------


async def _handle_api_error(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, ApiError)
    return error_response(
        exc.status_code, exc.code, exc.message, request_id_of(request), exc.fields
    )


async def _handle_validation_error(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)
    return error_response(
        422,
        "validation_error",
        "The request is not valid. See fields for each problem.",
        request_id_of(request),
        field_errors_from_validation(exc),
    )


async def _handle_http_exception(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, StarletteHTTPException)
    code = _HTTP_CODES.get(exc.status_code, "http_error")
    message = {
        404: "Not found.",
        405: "Method not allowed.",
        400: "Bad request.",
    }.get(exc.status_code, "Request failed.")
    response = error_response(exc.status_code, code, message, request_id_of(request))
    if exc.headers:
        for key, value in exc.headers.items():
            response.headers[key] = value
    return response


async def _handle_store_unavailable(request: Request, exc: Exception) -> JSONResponse:
    """The data layer cannot read a delivered file. The reason holds paths, so it is only logged."""
    rid = request_id_of(request)
    logger.warning("Data unavailable request_id=%s: %s", rid, exc)
    return error_response(503, "data_unavailable", "Data not available.", rid)


async def _handle_unexpected(request: Request, exc: Exception) -> JSONResponse:
    rid = request_id_of(request)
    # The trace goes to the server log only (Requirement 29.7).
    logger.error(
        "Unhandled error request_id=%s %s %s", rid, request.method, request.url.path, exc_info=exc
    )
    return error_response(500, "internal_error", "An internal error occurred.", rid)


# --- middleware --------------------------------------------------------------------------


class RequestContextMiddleware:
    """Pure ASGI middleware: request id on every response and the request body size limit.

    A declared `Content-Length` over the limit is answered with 413 before the app runs.
    A body without a usable `Content-Length` is counted while it is read and fails with
    `PayloadTooLargeError` once it passes the limit.
    """

    def __init__(self, app: ASGIApp, max_body_bytes: int = MAX_BODY_BYTES) -> None:
        self.app = app
        self.max_body_bytes = max_body_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        rid = new_request_id()
        scope.setdefault("state", {})["request_id"] = rid

        declared = _declared_length(scope)
        if declared is not None and declared > self.max_body_bytes:
            response = error_response(
                413,
                "payload_too_large",
                PayloadTooLargeError(self.max_body_bytes).message,
                rid,
            )
            await response(scope, receive, send)
            return

        received = 0
        limit = self.max_body_bytes

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    raise PayloadTooLargeError(limit)
            return message

        async def send_with_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = [
                    (k, v) for k, v in message.get("headers", []) if k.lower() != b"x-request-id"
                ]
                headers.append((REQUEST_ID_HEADER.lower().encode(), rid.encode()))
                message["headers"] = headers
            await send(message)

        await self.app(scope, limited_receive, send_with_id)


def _declared_length(scope: Scope) -> int | None:
    for key, value in scope.get("headers", []):
        if key.lower() == b"content-length":
            try:
                length = int(value)
            except ValueError:
                return None
            return length if length >= 0 else None
    return None


# --- installation ------------------------------------------------------------------------


def install_error_handling(app: FastAPI) -> None:
    """Register the error handlers and the request context middleware on `app`."""
    app.add_exception_handler(ApiError, _handle_api_error)
    app.add_exception_handler(RequestValidationError, _handle_validation_error)
    app.add_exception_handler(StarletteHTTPException, _handle_http_exception)
    app.add_exception_handler(StoreUnavailableError, _handle_store_unavailable)
    app.add_exception_handler(Exception, _handle_unexpected)
    app.add_middleware(RequestContextMiddleware)

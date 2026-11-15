"""Unauthenticated smoke check of a running deployment (Requirements 32.4, 33.1, 33.9).

Run: `uv run python -m hotspots.smoke <base_url>`, for example
`uv run python -m hotspots.smoke https://example-hotspots.hf.space` or
`uv run python -m hotspots.smoke http://localhost:7860`.

The check behaves like a visitor who is not logged in. It sends no cookies, no credentials and no
secrets, and it reads only public endpoints:

1. `GET /`                    the front-end index (HTML with the app mount point).
2. `GET /api/health`          status "ok", data present, latest month, answered within 1 second.
3. `GET /api/v1/meta`         region name, extent, record start, latest month, units, limitations.
4. `POST /api/v1/calendar`    the full extent (no geometry), from the record start to the latest
                              month; a provisional latest month must be flagged.

Each check prints one `PASS` or `FAIL` line with a reason. All checks run even when an earlier one
fails, except the calendar check, which needs a valid `/api/v1/meta` to pick its date range.
Exit status: 0 all checks passed, 1 at least one failed, 2 the command line is invalid.

Counts are cell-days (MODIS-equivalent). Days, months and years use fixed UTC-8.
"""

from __future__ import annotations

import argparse
import calendar as stdlib_calendar
import json
import re
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import date
from typing import Any, Final
from urllib.parse import urlsplit

HEALTH_LIMIT_SECONDS: Final[float] = 1.0
"""Requirement 32.4: the health endpoint answers within 1 second."""
DEFAULT_TIMEOUT_SECONDS: Final[float] = 30.0
"""Per-request network timeout. A cold calendar query may take longer than the health limit."""
REGION_NAME: Final[str] = "California region"

_MONTH_PATTERN: Final[re.Pattern[str]] = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
_ROOT_MARKER: Final[str] = 'id="root"'
_USER_AGENT: Final[str] = "hotspots-smoke-check/1"
_EXIT_OK: Final[int] = 0
_EXIT_FAILED: Final[int] = 1
_EXIT_USAGE: Final[int] = 2


class TransportError(Exception):
    """The request got no HTTP response (connection refused, DNS failure, timeout, ...)."""


@dataclass(frozen=True)
class Response:
    """An HTTP response. Header names are lower case. `elapsed_s` is the time to the full body."""

    status: int
    headers: dict[str, str]
    body: bytes
    elapsed_s: float


Transport = Callable[[str, str, object | None, float], Response]
"""`(method, url, json_body, timeout_s) -> Response`. Raises `TransportError` without a response.

HTTP error statuses (4xx, 5xx) are returned as a `Response`, not raised."""


@dataclass(frozen=True)
class CheckResult:
    """Outcome of one check."""

    name: str
    ok: bool
    detail: str


@dataclass
class _Context:
    """Facts passed from earlier checks to later ones."""

    base_url: str
    transport: Transport
    timeout_s: float
    health_limit_s: float
    health_latest_month: str | None = None
    meta: dict[str, Any] | None = None


# --- transport ---------------------------------------------------------------------------


def _is_loopback(url: str) -> bool:
    return urlsplit(url).hostname in ("localhost", "127.0.0.1", "::1")


def urllib_transport(method: str, url: str, json_body: object | None, timeout_s: float) -> Response:
    """Send one request with the standard library. No cookie jar, so no cookies are kept or sent."""
    data = None if json_body is None else json.dumps(json_body).encode("utf-8")
    headers = {"User-Agent": _USER_AGENT, "Accept": "application/json, text/html"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, method=method, headers=headers)  # noqa: S310
    # No HTTPCookieProcessor: no cookies are kept. Loopback targets never go through a proxy.
    handlers = [urllib.request.ProxyHandler({})] if _is_loopback(url) else []
    opener = urllib.request.build_opener(*handlers)
    started = time.perf_counter()
    try:
        with opener.open(request, timeout=timeout_s) as reply:
            status, reply_headers, body = reply.status, reply.headers, reply.read()
    except urllib.error.HTTPError as exc:  # 4xx and 5xx still carry a useful body
        try:
            status, reply_headers, body = exc.code, exc.headers, exc.read()
        except OSError as read_exc:
            raise TransportError(f"{type(read_exc).__name__}: {read_exc}") from None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        reason = exc.reason if isinstance(exc, urllib.error.URLError) else exc
        raise TransportError(f"{type(exc).__name__}: {reason}") from None
    elapsed = time.perf_counter() - started
    lowered = {k.lower(): v for k, v in reply_headers.items()}
    return Response(status=status, headers=lowered, body=body, elapsed_s=elapsed)


# --- helpers -----------------------------------------------------------------------------


def normalize_base_url(raw: str) -> str:
    """Return `raw` without trailing slashes.

    Raises:
        ValueError: `raw` is not an `http` or `https` URL with a host, or it has a query or
            fragment (the check appends its own paths).
    """
    text = raw.strip()
    parts = urlsplit(text)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise ValueError(f"base URL must start with http:// or https:// and name a host: {raw!r}")
    if parts.query or parts.fragment:
        raise ValueError(f"base URL must not contain a query or fragment: {raw!r}")
    return text.rstrip("/")


def _error_summary(response: Response) -> str:
    """`HTTP 503` plus the API error code and message when the body is the API error envelope."""
    text = f"HTTP {response.status}"
    try:
        error = json.loads(response.body)["error"]
        return f"{text} ({error['code']}: {error['message']})"
    except (ValueError, KeyError, TypeError):
        return text


def _json_object(response: Response) -> dict[str, Any] | str:
    """The body as a JSON object, or a message describing why it is not one."""
    try:
        parsed = json.loads(response.body)
    except ValueError:
        return "body is not valid JSON"
    if not isinstance(parsed, dict):
        return "body is not a JSON object"
    return parsed


def _is_month(value: object) -> bool:
    return isinstance(value, str) and _MONTH_PATTERN.fullmatch(value) is not None


def _fetch(
    ctx: _Context, method: str, path: str, json_body: object | None = None
) -> Response | str:
    """Response, or a failure message when the request got no HTTP response."""
    url = f"{ctx.base_url}{path}"
    try:
        return ctx.transport(method, url, json_body, ctx.timeout_s)
    except TransportError as exc:
        return f"no response from {url}: {exc}"


# --- checks ------------------------------------------------------------------------------


def _check_index(ctx: _Context) -> CheckResult:
    name = "GET /"
    reply = _fetch(ctx, "GET", "/")
    if isinstance(reply, str):
        return CheckResult(name, False, reply)
    if reply.status != 200:
        return CheckResult(name, False, f"expected HTTP 200, got {_error_summary(reply)}")
    content_type = reply.headers.get("content-type", "")
    if "html" not in content_type.lower():
        return CheckResult(name, False, f"expected an HTML page, got content type {content_type!r}")
    if _ROOT_MARKER not in reply.body.decode("utf-8", errors="replace"):
        return CheckResult(name, False, f"the page has no app mount point ({_ROOT_MARKER})")
    return CheckResult(name, True, "HTML page with the app mount point")


def _check_health(ctx: _Context) -> CheckResult:
    name = "GET /api/health"
    reply = _fetch(ctx, "GET", "/api/health")
    if isinstance(reply, str):
        return CheckResult(name, False, reply)
    body = _json_object(reply)
    if reply.status != 200:
        detail = body.get("status") if isinstance(body, dict) else None
        suffix = f", status {detail!r}: the delivered data are not available" if detail else ""
        return CheckResult(name, False, f"expected HTTP 200, got HTTP {reply.status}{suffix}")
    if isinstance(body, str):
        return CheckResult(name, False, body)
    if body.get("status") != "ok" or body.get("data_present") is not True:
        return CheckResult(
            name,
            False,
            f"status={body.get('status')!r}, data_present={body.get('data_present')!r}; "
            "expected 'ok' and true",
        )
    latest = body.get("latest_month")
    if not _is_month(latest):
        return CheckResult(name, False, f"latest_month is not YYYY-MM: {latest!r}")
    if reply.elapsed_s > ctx.health_limit_s:
        return CheckResult(
            name,
            False,
            f"answered in {reply.elapsed_s:.2f} s; the limit is {ctx.health_limit_s:g} s",
        )
    ctx.health_latest_month = str(latest)
    return CheckResult(
        name, True, f"ok in {reply.elapsed_s:.2f} s, data present, latest month {latest}"
    )


_META_STRING_KEYS: Final[tuple[str, ...]] = (
    "name",
    "record_start",
    "first_date",
    "latest_month",
    "time_convention",
    "unit",
)
_EXTENT_KEYS: Final[tuple[str, ...]] = ("west", "south", "east", "north")


def _meta_problem(body: dict[str, Any]) -> str | None:
    """The first problem found in a `/api/v1/meta` body, or None."""
    for key in _META_STRING_KEYS:
        if not isinstance(body.get(key), str) or not body[key]:
            return f"field {key!r} is missing or not a non-empty string"
    if body["name"] != REGION_NAME:
        return f"name is {body['name']!r}, expected {REGION_NAME!r}"
    for key in ("record_start", "latest_month"):
        if not _is_month(body[key]):
            return f"{key} is not YYYY-MM: {body[key]!r}"
    extent = body.get("extent")
    if not isinstance(extent, dict) or not all(
        isinstance(extent.get(k), int | float) and not isinstance(extent.get(k), bool)
        for k in _EXTENT_KEYS
    ):
        return "extent must have numeric west, south, east and north"
    if not (extent["west"] < extent["east"] and extent["south"] < extent["north"]):
        return "extent is empty or inverted"
    if not isinstance(body.get("latest_month_incomplete"), bool):
        return "field 'latest_month_incomplete' is missing or not a boolean"
    limitations = body.get("limitations")
    if not isinstance(limitations, list) or not limitations:
        return "limitations is missing or empty"
    try:
        date.fromisoformat(body["first_date"])
    except ValueError:
        return f"first_date is not an ISO date: {body['first_date']!r}"
    return None


def _check_meta(ctx: _Context) -> CheckResult:
    name = "GET /api/v1/meta"
    reply = _fetch(ctx, "GET", "/api/v1/meta")
    if isinstance(reply, str):
        return CheckResult(name, False, reply)
    if reply.status != 200:
        return CheckResult(name, False, f"expected HTTP 200, got {_error_summary(reply)}")
    body = _json_object(reply)
    if isinstance(body, str):
        return CheckResult(name, False, body)
    problem = _meta_problem(body)
    if problem is not None:
        return CheckResult(name, False, problem)
    if ctx.health_latest_month is not None and body["latest_month"] != ctx.health_latest_month:
        return CheckResult(
            name,
            False,
            f"latest_month {body['latest_month']} differs from /api/health "
            f"({ctx.health_latest_month})",
        )
    ctx.meta = body
    return CheckResult(
        name,
        True,
        f"{body['name']}, record {body['record_start']} to {body['latest_month']}"
        f"{' (latest month incomplete)' if body['latest_month_incomplete'] else ''}",
    )


def _calendar_range(meta: dict[str, Any]) -> tuple[str, str]:
    """First day of the record and last day of the latest month, as ISO dates."""
    year, month = (int(part) for part in meta["latest_month"].split("-"))
    last_day = stdlib_calendar.monthrange(year, month)[1]
    return meta["first_date"], f"{year:04d}-{month:02d}-{last_day:02d}"


def _calendar_problem(body: dict[str, Any], meta: dict[str, Any]) -> str | None:
    """The first problem found in a `/api/v1/calendar` body for the full extent, or None."""
    months, years = body.get("months"), body.get("years")
    if not isinstance(months, list) or not months:
        return "months is missing or empty"
    if not isinstance(years, list) or not years:
        return "years is missing or empty"
    baseline = body.get("baseline_by_month")
    if not isinstance(baseline, list) or len(baseline) != 12:
        return "baseline_by_month must hold 12 calendar months"
    if not isinstance(body.get("n_cells"), int) or body["n_cells"] <= 0:
        return (
            f"n_cells must be a positive integer for the full extent, got {body.get('n_cells')!r}"
        )
    if body.get("clipped_percent") is not None:
        return "clipped_percent must be null when no geometry is sent"
    try:
        first, last = months[0], months[-1]
        first_key = f"{first['year']:04d}-{first['month']:02d}"
        last_key = f"{last['year']:04d}-{last['month']:02d}"
    except (KeyError, TypeError, ValueError):
        return "month rows need integer year and month"
    if first_key != meta["record_start"]:
        return f"first month is {first_key}, expected the record start {meta['record_start']}"
    if last_key != meta["latest_month"]:
        return f"last month is {last_key}, expected the latest month {meta['latest_month']}"
    if meta["latest_month_incomplete"]:
        if meta["latest_month"] not in (body.get("provisional_months") or []):
            return f"incomplete latest month {meta['latest_month']} is not marked provisional"
        if last.get("provisional") is not True or last.get("anomaly") is not None:
            return "the incomplete latest month must be provisional and have no anomaly"
    return None


def _check_calendar(ctx: _Context) -> CheckResult:
    name = "POST /api/v1/calendar"
    if ctx.meta is None:
        return CheckResult(name, False, "not run: it needs a valid /api/v1/meta for the date range")
    start, end = _calendar_range(ctx.meta)
    reply = _fetch(ctx, "POST", "/api/v1/calendar", {"start": start, "end": end})
    if isinstance(reply, str):
        return CheckResult(name, False, reply)
    if reply.status != 200:
        return CheckResult(name, False, f"expected HTTP 200, got {_error_summary(reply)}")
    body = _json_object(reply)
    if isinstance(body, str):
        return CheckResult(name, False, body)
    problem = _calendar_problem(body, ctx.meta)
    if problem is not None:
        return CheckResult(name, False, problem)
    return CheckResult(
        name,
        True,
        f"full extent {start} to {end}: {len(body['months'])} months, "
        f"{len(body['years'])} years, {body['n_cells']} cells",
    )


# --- runner ------------------------------------------------------------------------------


def run_checks(
    base_url: str,
    *,
    transport: Transport = urllib_transport,
    timeout_s: float = DEFAULT_TIMEOUT_SECONDS,
    health_limit_s: float = HEALTH_LIMIT_SECONDS,
) -> list[CheckResult]:
    """Run every check against `base_url` and return the results in order.

    Raises:
        ValueError: `base_url` is not a usable http(s) URL.
    """
    ctx = _Context(
        base_url=normalize_base_url(base_url),
        transport=transport,
        timeout_s=timeout_s,
        health_limit_s=health_limit_s,
    )
    # Order matters: health and meta fill the context that the calendar check reads.
    return [_check_index(ctx), _check_health(ctx), _check_meta(ctx), _check_calendar(ctx)]


def format_results(results: Sequence[CheckResult]) -> str:
    """One `PASS` or `FAIL` line per check and a summary line."""
    lines = [f"{'PASS' if r.ok else 'FAIL'}  {r.name}: {r.detail}" for r in results]
    failed = sum(1 for r in results if not r.ok)
    if failed:
        lines.append(f"SMOKE CHECK FAILED: {failed} of {len(results)} checks failed")
    else:
        lines.append(f"SMOKE CHECK PASSED: {len(results)} of {len(results)} checks passed")
    return "\n".join(lines)


def _positive_float(text: str) -> float:
    value = float(text)
    if not value > 0:
        raise argparse.ArgumentTypeError("must be greater than 0")
    return value


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m hotspots.smoke",
        description="Smoke check of a running Harmonized Fire Calendar deployment. "
        "Uses public endpoints only, sends no cookies or credentials.",
    )
    parser.add_argument("base_url", help="deployment URL, e.g. https://example.hf.space")
    parser.add_argument(
        "--timeout",
        type=_positive_float,
        default=DEFAULT_TIMEOUT_SECONDS,
        help=f"per-request network timeout in seconds (default {DEFAULT_TIMEOUT_SECONDS:g})",
    )
    parser.add_argument(
        "--health-limit",
        type=_positive_float,
        default=HEALTH_LIMIT_SECONDS,
        help=f"most seconds /api/health may take (default {HEALTH_LIMIT_SECONDS:g})",
    )
    return parser


def main(argv: Sequence[str] | None = None, *, transport: Transport = urllib_transport) -> int:
    """Command-line entry point. Returns the exit status (0 passed, 1 failed, 2 bad usage)."""
    parser = _build_parser()
    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:  # argparse exits with 2 on bad arguments, 0 for --help
        return exc.code if isinstance(exc.code, int) else _EXIT_USAGE
    try:
        results = run_checks(
            args.base_url,
            transport=transport,
            timeout_s=args.timeout,
            health_limit_s=args.health_limit,
        )
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return _EXIT_USAGE
    print(format_results(results))
    return _EXIT_FAILED if any(not r.ok for r in results) else _EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())

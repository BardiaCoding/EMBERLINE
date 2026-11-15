"""FastAPI application: `uvicorn hotspots.api.main:app`.

- Configuration comes from `HOTSPOTS_CONFIG` (default `config/app.yaml`). Every configuration
  problem is printed at once and the process exits with status 1 (Requirements 1.2, 1.10).
- Missing or unreadable delivered data do not stop the app. It runs in the unavailable state:
  `/api/health` answers 503 and data routes answer 503 `data_unavailable` (Requirement 32.7).
- Routers are discovered from `hotspots.api.routes` (one module per area).
- The built front end is served from `HOTSPOTS_STATIC_DIR` when that folder exists, with a
  fallback to `index.html` for client-side routes. CORS is not enabled: the front end is
  served from the same origin.
"""

from __future__ import annotations

import logging
import os
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Final

from fastapi import FastAPI
from fastapi.responses import FileResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException

from hotspots.api.deps import ApiState, build_facts, build_mask_cache
from hotspots.api.errors import install_error_handling
from hotspots.api.routes import discover_routers
from hotspots.config import ConfigErrors, load_config
from hotspots.data import DataStore

logger = logging.getLogger("hotspots.api")

STATIC_DIR_ENV_VAR: Final[str] = "HOTSPOTS_STATIC_DIR"
_INDEX_FILE: Final[str] = "index.html"
_API_PREFIX: Final[str] = "api/"


class ConfigurationError(Exception):
    """The app configuration is invalid. `errors` lists every problem."""

    def __init__(self, errors: ConfigErrors) -> None:
        super().__init__(errors.format())
        self.errors = errors


def create_app(
    config_path: str | os.PathLike[str] | None = None,
    *,
    static_dir: str | os.PathLike[str] | None = None,
) -> FastAPI:
    """Build the app.

    Raises `ConfigurationError` (with all problems) for an invalid configuration. Missing
    delivered data files are not a configuration error: the app starts without data.
    `static_dir` overrides `HOTSPOTS_STATIC_DIR`.
    """
    config = load_config(config_path, require_data=False)
    if isinstance(config, ConfigErrors):
        raise ConfigurationError(config)
    store = DataStore(config)
    state = ApiState(
        config=config,
        store=store,
        facts=build_facts(store),
        masks=build_mask_cache(config, store),
    )
    if state.facts is None:
        logger.warning("Starting without data: %s", store.unavailable_reason)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        try:
            yield
        finally:
            store.close()

    app = FastAPI(title="Emberline API", version="0.1.0", lifespan=lifespan)
    app.state.api = state
    install_error_handling(app)
    for router in discover_routers():
        app.include_router(router)
    _mount_front_end(app, static_dir)
    return app


def _resolve_static_dir(static_dir: str | os.PathLike[str] | None) -> Path | None:
    raw = static_dir if static_dir is not None else os.environ.get(STATIC_DIR_ENV_VAR, "").strip()
    if not raw:
        return None
    root = Path(raw).expanduser()
    if not (root / _INDEX_FILE).is_file():
        logger.warning(
            "%s=%s has no %s; the front end is not served", STATIC_DIR_ENV_VAR, root, _INDEX_FILE
        )
        return None
    return root.resolve()


def _mount_front_end(app: FastAPI, static_dir: str | os.PathLike[str] | None) -> None:
    """Serve the built front end. Registered last so API routes win."""
    root = _resolve_static_dir(static_dir)
    if root is None:
        return

    @app.api_route("/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    def front_end(path: str) -> Response:
        if path == "api" or path.startswith(_API_PREFIX):
            raise StarletteHTTPException(404)
        candidate = (root / path).resolve()
        if candidate.is_file() and candidate.is_relative_to(root):
            return FileResponse(candidate)
        if Path(path).suffix:
            raise StarletteHTTPException(404)  # a missing asset is not a client-side route
        return FileResponse(root / _INDEX_FILE)


def _create_app_or_exit() -> FastAPI:
    try:
        return create_app()
    except ConfigurationError as exc:
        print(exc.errors.format(), file=sys.stderr)
        raise SystemExit(1) from None


_app: FastAPI | None = None


def __getattr__(name: str) -> FastAPI:
    """Create `app` on first access, so importing this module (tests, tooling) has no side effect.

    `uvicorn hotspots.api.main:app` reads the attribute at start-up, so an invalid configuration
    prints every problem and exits with status 1 there.
    """
    global _app
    if name != "app":
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    if _app is None:
        _app = _create_app_or_exit()
    return _app


__all__ = ["ConfigurationError", "create_app"]

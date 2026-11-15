"""API routers, one module per area, discovered automatically.

Every public module in this package must expose a `router` (`fastapi.APIRouter`) that carries
its own full path prefix (`/api` or `/api/v1`). `create_app` includes them in module-name
order, so adding a route module never means editing `main.py`.
"""

from __future__ import annotations

import importlib
import pkgutil

from fastapi import APIRouter


def discover_routers() -> list[APIRouter]:
    """Import every public module of this package and return its `router`, sorted by name."""
    routers: list[APIRouter] = []
    for info in sorted(pkgutil.iter_modules(__path__), key=lambda m: m.name):
        if info.name.startswith("_"):
            continue
        module = importlib.import_module(f"{__name__}.{info.name}")
        router = getattr(module, "router", None)
        if not isinstance(router, APIRouter):
            raise RuntimeError(f"route module {module.__name__} must define `router: APIRouter`")
        routers.append(router)
    return routers

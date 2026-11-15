"""Share links: `POST /api/v1/share` and `GET /api/v1/share/{id}` (requirements 19.6, 29.4).

A Selection_Area that does not fit a 2000-character URL is stored here and replaced in the URL
by an identifier of at most 16 characters. The store is a SQLite file at `HOTSPOTS_SHARE_DB`;
without it the routes answer 503 `share_unavailable` and the front end simplifies the area
instead. The geometry is validated and clipped like any other area (`selection/normalize`)
before it is stored. Stores are rate limited per client (429 `rate_limited`). A link is
resolvable for 30 days after it was last stored; an unknown, malformed or expired identifier
is a 404. Coordinates are EPSG:4326 (longitude, latitude), 6 decimals. These routes need no
delivered data.
"""

from __future__ import annotations

import re
import threading
from datetime import UTC, datetime
from typing import Annotated, Final

from fastapi import APIRouter, Depends, Request

from hotspots.api.deps import ConfigDep
from hotspots.api.errors import ApiError
from hotspots.api.routes.selection import normalize_geometry
from hotspots.api.schemas import ApiModel, Geometry
from hotspots.api.share import ShareStore, store_from_env

router = APIRouter(prefix="/api/v1", tags=["share"])

_ID_PATTERN: Final[re.Pattern[str]] = re.compile(r"^[A-Za-z0-9_-]{1,16}$")
_STORE_LOCK: Final[threading.Lock] = threading.Lock()


class ShareIn(ApiModel):
    """The area to store (at most 1000 vertices, the same limit as every geometry)."""

    geometry: Geometry


class ShareCreatedOut(ApiModel):
    """Identifier of at most 16 characters and when it stops resolving (UTC)."""

    id: str
    expires_at: datetime


class ShareOut(ApiModel):
    """A stored area."""

    id: str
    geometry: Geometry


def get_share_store(request: Request) -> ShareStore:
    """The share store of the app, opened on first use from `HOTSPOTS_SHARE_DB`."""
    app_state = request.app.state
    store = getattr(app_state, "share_store", None)
    if store is None:
        with _STORE_LOCK:
            store = getattr(app_state, "share_store", None)
            if store is None:
                store = store_from_env()
                app_state.share_store = store
    if not isinstance(store, ShareStore):
        raise ApiError(503, "share_unavailable", "Short links are not available on this server.")
    return store


ShareStoreDep = Annotated[ShareStore, Depends(get_share_store)]


@router.post("/share", response_model=ShareCreatedOut)
def create_share(
    body: ShareIn, request: Request, config: ConfigDep, store: ShareStoreDep
) -> ShareCreatedOut:
    """Validate and store an area. The same area always gets the same id (and renews it)."""
    client = request.client.host if request.client is not None else "unknown"
    if not store.allow(client):
        raise ApiError(429, "rate_limited", "Too many short links were requested. Try again soon.")
    geometry, _, _ = normalize_geometry(
        body.geometry.model_dump(), config.region.extent, "geometry"
    )
    share_id, expires = store.put(geometry.model_dump())
    return ShareCreatedOut(id=share_id, expires_at=datetime.fromtimestamp(expires, UTC))


@router.get("/share/{share_id}", response_model=ShareOut)
def read_share(share_id: str, store: ShareStoreDep) -> ShareOut:
    """The area behind a share id. 404 for an unknown, malformed or expired id."""
    stored = store.get(share_id) if _ID_PATTERN.fullmatch(share_id) else None
    if stored is None:
        raise ApiError(404, "not_found", "This share link is unknown or has expired.")
    return ShareOut(id=share_id, geometry=Geometry.model_validate(stored))

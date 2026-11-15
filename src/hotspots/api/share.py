"""Share-link store: a short identifier for a Selection_Area that is too long for a URL.

Requirements 19.6 and 29.4. The identifier is the first 16 characters of the base64url form of
the SHA-256 of the canonical geometry (coordinates rounded to 6 decimals, see
`hotspots.selection`), so the same area always gets the same identifier. Geometry is kept in a
SQLite file at `HOTSPOTS_SHARE_DB`; without that variable the store is unavailable and the front
end falls back to simplifying the area. Every statement is parameterized. A link stays
resolvable for 30 days after it was last stored (storing the same area again renews it).
Coordinates are EPSG:4326 (longitude, latitude) in decimal degrees.
"""

from __future__ import annotations

import base64
import json
import os
import sqlite3
import threading
import time
from collections import defaultdict, deque
from collections.abc import Callable, Mapping
from contextlib import closing
from pathlib import Path
from typing import Any, Final

from shapely.geometry import shape

from hotspots.selection import canonical_coordinates, canonical_key

SHARE_DB_ENV_VAR: Final[str] = "HOTSPOTS_SHARE_DB"
SHARE_ID_LENGTH: Final[int] = 16
RETENTION_SECONDS: Final[int] = 30 * 24 * 60 * 60
"""Links stay resolvable for 30 days (DEFAULT (confirm), requirement 19.6)."""
RATE_LIMIT_COUNT: Final[int] = 20
RATE_LIMIT_WINDOW_SECONDS: Final[float] = 60.0
"""At most 20 stores per client per minute (DEFAULT (confirm))."""
_MAX_TRACKED_CLIENTS: Final[int] = 10_000

_SCHEMA: Final[str] = (
    "CREATE TABLE IF NOT EXISTS share ("
    "id TEXT PRIMARY KEY, geometry TEXT NOT NULL, created_at INTEGER NOT NULL)"
)

Clock = Callable[[], float]


def share_id_for(geometry: Mapping[str, Any]) -> str:
    """The identifier (16 URL-safe characters) of a Polygon or MultiPolygon mapping."""
    digest = bytes.fromhex(canonical_key(shape(dict(geometry))))
    return base64.urlsafe_b64encode(digest).decode("ascii")[:SHARE_ID_LENGTH]


class ShareStore:
    """SQLite store of share links plus an in-memory rate limiter."""

    def __init__(self, path: str | os.PathLike[str], *, clock: Clock = time.time) -> None:
        self._path = Path(path)
        self._clock = clock
        self._lock = threading.Lock()
        self._hits: defaultdict[str, deque[float]] = defaultdict(deque)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            db.execute(_SCHEMA)

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self._path, timeout=5.0)

    def allow(self, client: str) -> bool:
        """Count one store request of `client`. False when it is over the rate limit."""
        now = self._clock()
        with self._lock:
            if len(self._hits) > _MAX_TRACKED_CLIENTS:
                self._hits = defaultdict(deque, {k: v for k, v in self._hits.items() if v})
            window = self._hits[client]
            while window and now - window[0] >= RATE_LIMIT_WINDOW_SECONDS:
                window.popleft()
            if len(window) >= RATE_LIMIT_COUNT:
                return False
            window.append(now)
            return True

    def put(self, geometry: Mapping[str, Any]) -> tuple[str, int]:
        """Store a validated geometry. Returns its id and the expiry (Unix seconds)."""
        canonical = canonical_coordinates(shape(dict(geometry)))
        text = json.dumps(canonical, sort_keys=True, separators=(",", ":"), allow_nan=False)
        share_id = share_id_for(canonical)
        now = int(self._clock())
        with closing(self._connect()) as db, db:
            db.execute("DELETE FROM share WHERE created_at <= ?", (now - RETENTION_SECONDS,))
            db.execute(
                "INSERT INTO share (id, geometry, created_at) VALUES (?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET created_at = excluded.created_at",
                (share_id, text, now),
            )
        return share_id, now + RETENTION_SECONDS

    def get(self, share_id: str) -> dict[str, Any] | None:
        """The stored geometry, or None for an unknown or expired id."""
        now = int(self._clock())
        with closing(self._connect()) as db:
            row = db.execute(
                "SELECT geometry FROM share WHERE id = ? AND created_at > ?",
                (share_id, now - RETENTION_SECONDS),
            ).fetchone()
        if row is None:
            return None
        loaded = json.loads(row[0])
        return loaded if isinstance(loaded, dict) else None


def store_from_env(environ: Mapping[str, str] | None = None) -> ShareStore | None:
    """The store at `HOTSPOTS_SHARE_DB`, or None when it is not set or cannot be opened."""
    path = (environ if environ is not None else os.environ).get(SHARE_DB_ENV_VAR, "").strip()
    if not path:
        return None
    try:
        return ShareStore(path)
    except (OSError, sqlite3.Error):
        return None

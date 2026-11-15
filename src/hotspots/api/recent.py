"""Recent view: raw detection counts per local day for the last 7 local days (Requirement 20).

Pure helpers, no I/O. The route (`routes/recent.py`) reads the detections and calls these.

The delivered data have NO daily harmonized counts. Everything here is a count of filtered RAW
detections, not harmonized and not comparable across sensors. Days use fixed UTC-8.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable
from datetime import UTC, date, datetime, timedelta
from typing import Final

RECENT_DAYS: Final[int] = 7
"""Length of the window in local days. DEFAULT (confirm)."""

MAX_RECENT_POINTS: Final[int] = 5_000
"""Most points one response holds. The newest detections are kept. DEFAULT (confirm)."""

LOCAL_UTC_OFFSET: Final[timedelta] = timedelta(hours=-8)
"""Fixed local standard time, UTC-8, no daylight saving."""


def window_days(latest_local: date) -> list[date]:
    """The 7 consecutive local days ending on `latest_local`, oldest first."""
    return [latest_local - timedelta(days=RECENT_DAYS - 1 - i) for i in range(RECENT_DAYS)]


def daily_counts(days: Iterable[date], detection_days: Iterable[date]) -> list[int]:
    """Detections per day for each of `days`, zeros included. Dates outside `days` are ignored."""
    tally = Counter(detection_days)
    return [tally.get(d, 0) for d in days]


def local_today(now_utc: datetime) -> date:
    """The current local date (fixed UTC-8) of a UTC instant."""
    aware = now_utc.replace(tzinfo=UTC) if now_utc.tzinfo is None else now_utc.astimezone(UTC)
    return (aware + LOCAL_UTC_OFFSET).date()


def data_age_days(latest_local: date, now_utc: datetime) -> int:
    """Whole days from the latest detection's local date to the current local date (never < 0)."""
    return max(0, (local_today(now_utc) - latest_local).days)

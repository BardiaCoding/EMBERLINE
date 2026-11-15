"""Application state and FastAPI dependencies shared by the route modules.

`create_app` stores one `ApiState` on `app.state.api`. Routes read it through `get_state`,
`get_config`, `get_store` or `require_data`, so they never build a store themselves.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime
from typing import Annotated

from fastapi import Depends, Request

from hotspots.api.errors import DataUnavailableError
from hotspots.config import AppConfig
from hotspots.data import DataStore
from hotspots.data.types import DataUnavailableError as StoreUnavailableError
from hotspots.selection import SelectionMaskCache

logger = logging.getLogger("hotspots.api")


@dataclass(frozen=True)
class DataFacts:
    """Facts read once from the delivered files at startup (the files never change at runtime)."""

    latest_month: str
    """`YYYY-MM`, may be incomplete."""
    latest_month_incomplete: bool
    latest_complete_month: str | None
    latest_detection_local_date: date | None
    """Fixed UTC-8 local day of the latest detection."""
    latest_detection_utc: datetime | None
    """True UTC, timezone-aware."""


@dataclass(frozen=True)
class ApiState:
    config: AppConfig
    store: DataStore
    facts: DataFacts | None
    """None when the delivered data are missing or unreadable (the unavailable state)."""
    masks: SelectionMaskCache | None = None
    """Selection mask cache over the loaded grid, one per app. None without data."""


def build_mask_cache(config: AppConfig, store: DataStore) -> SelectionMaskCache | None:
    """Selection mask cache for the loaded grid, or None when the data are not usable."""
    if not store.available:
        return None
    try:
        return SelectionMaskCache.from_grid(store.grid(), config.region.extent)
    except StoreUnavailableError as exc:
        logger.warning("Selection cache not built: %s", exc)
        return None


def build_facts(store: DataStore) -> DataFacts | None:
    """Read the startup facts, or return None when the data are missing or unreadable."""
    if not store.available:
        return None
    try:
        grid = store.grid()
        latest = store.latest_month()
        try:
            complete: str | None = str(store.latest_complete_month())
        except StoreUnavailableError:
            complete = None
        try:
            local_date: date | None = store.detections_latest_local_date()
            utc: datetime | None = store.detections_latest_utc()
        except StoreUnavailableError:
            local_date, utc = None, None
        return DataFacts(
            latest_month=str(latest),
            latest_month_incomplete=bool(grid.incomplete[-1]),
            latest_complete_month=complete,
            latest_detection_local_date=local_date,
            latest_detection_utc=utc,
        )
    except StoreUnavailableError as exc:
        logger.warning("Data unavailable at startup: %s", exc)
        return None


def get_state(request: Request) -> ApiState:
    state = request.app.state.api
    assert isinstance(state, ApiState)
    return state


StateDep = Annotated[ApiState, Depends(get_state)]


def get_config(state: StateDep) -> AppConfig:
    return state.config


def get_store(state: StateDep) -> DataStore:
    """The data store. Raises HTTP 503 `data_unavailable` when the data are not usable."""
    if state.facts is None:
        raise DataUnavailableError()
    return state.store


def require_data(state: StateDep) -> DataFacts:
    """The startup facts. Raises HTTP 503 `data_unavailable` when the data are not usable."""
    if state.facts is None:
        raise DataUnavailableError()
    return state.facts


def get_mask_cache(state: StateDep) -> SelectionMaskCache:
    """The selection mask cache. Raises HTTP 503 `data_unavailable` when there are no data."""
    if state.facts is None or state.masks is None:
        raise DataUnavailableError()
    return state.masks


ConfigDep = Annotated[AppConfig, Depends(get_config)]
StoreDep = Annotated[DataStore, Depends(get_store)]
FactsDep = Annotated[DataFacts, Depends(require_data)]
MaskCacheDep = Annotated[SelectionMaskCache, Depends(get_mask_cache)]

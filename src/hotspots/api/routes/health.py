"""`GET /api/health`: liveness and data presence (Requirement 32.4, 32.7)."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from hotspots.api.deps import StateDep
from hotspots.api.schemas import ApiModel

router = APIRouter(prefix="/api", tags=["health"])


class HealthOut(ApiModel):
    status: Literal["ok", "unavailable"]
    data_present: bool
    """True when both delivered files were found and the grid loaded."""
    latest_month: str | None = None
    """`YYYY-MM` of the latest month in the grid (may be incomplete). Null when unavailable."""


@router.get(
    "/health",
    response_model=HealthOut,
    responses={503: {"model": HealthOut, "description": "Delivered data missing or unreadable."}},
)
def health(state: StateDep) -> HealthOut | JSONResponse:
    """Answers from values read at startup, so it is fast. 503 when the data are missing."""
    if state.facts is None:
        body = HealthOut(status="unavailable", data_present=False, latest_month=None)
        return JSONResponse(status_code=503, content=body.model_dump(mode="json"))
    return HealthOut(status="ok", data_present=True, latest_month=state.facts.latest_month)

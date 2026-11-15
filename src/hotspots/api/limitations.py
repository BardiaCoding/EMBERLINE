"""Known limitations of the delivered data (data contract), in plain language.

Returned by `GET /api/v1/meta` and shown on the methods page and in the README. The wording
follows the contract. It makes no claim about a state boundary mask (open item of the contract).
"""

from __future__ import annotations

from typing import Final

LIMITATIONS: Final[tuple[str, ...]] = (
    "Calibration assumes the overlap period (2012 onward) represents the earlier regime.",
    "Terra and Aqua overpass drift and VIIRS constellation changes may leave residual effects.",
    "Pre-2012 small fires are undercounted relative to the VIIRS era.",
    "Cloud and smoke reduce detections.",
    "Near-real-time filtering is approximate.",
    "The latest month is incomplete and is marked provisional, never plotted as a full month.",
    "Small areas look noisy after 2012: quantile mapping can turn small counts into zero.",
    "Before Aqua started, only Terra provides coverage (see the provenance column).",
    "96 of 98 regions have validation metrics.",
    "The best model per region was selected on the same holdout used to report errors, "
    "so the reported accuracy is slightly optimistic.",
)

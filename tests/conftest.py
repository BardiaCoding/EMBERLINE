"""Shared pytest configuration.

- Hypothesis profiles: `ci` (100 examples, derandomized) and `dev` (fast, randomized).
  Select with `HYPOTHESIS_PROFILE=ci`. Default is `dev`.
- Network is disabled by `pytest-socket` (see `addopts` in pyproject.toml). Loopback
  (127.0.0.1) stays allowed.
- Marker `delivered`: tests that read the real delivered files. Skipped when the
  data folder (default `outputs2.0/`) is absent. Override with `HOTSPOTS_DATA_DIR`.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from hypothesis import HealthCheck, settings

settings.register_profile(
    "ci",
    max_examples=100,
    derandomize=True,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow],
)
settings.register_profile("dev", max_examples=25, deadline=None)
settings.load_profile(os.environ.get("HYPOTHESIS_PROFILE", "dev"))

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DELIVERED_DIR = Path(os.environ.get("HOTSPOTS_DATA_DIR", PROJECT_ROOT / "outputs2.0"))


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    """Skip `delivered` tests when the delivered data folder is absent."""
    if DELIVERED_DIR.is_dir():
        return
    skip = pytest.mark.skip(reason=f"delivered data folder not found: {DELIVERED_DIR}")
    for item in items:
        if "delivered" in item.keywords:
            item.add_marker(skip)

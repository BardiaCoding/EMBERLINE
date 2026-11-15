"""The delivered files match `data-contract.md` (Requirements 9.8, 9.11).

Reads the real delivered files, so it is marked `delivered` and skipped when the data folder is
absent. The same checks run from the command line with `python -m hotspots.data.check`.
"""

from __future__ import annotations

import pytest

from hotspots.config import AppConfig, ConfigErrors, load_config
from hotspots.data.check import check_delivered, format_report


@pytest.mark.delivered
def test_delivered_files_match_the_data_contract() -> None:
    cfg = load_config()
    assert isinstance(cfg, AppConfig), cfg.format() if isinstance(cfg, ConfigErrors) else cfg
    results = check_delivered(cfg)
    failed = [r for r in results if not r.passed]
    assert not failed, "\n" + format_report(results)

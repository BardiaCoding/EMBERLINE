"""Unit tests for data delivery from a Hugging Face dataset repo (`hotspots.bootstrap`).

No network: the download function is replaced by a fake that copies files written by
`tests/fixtures.py` (TEST FIXTURE, not NASA data). The data-contract check is replaced by a fake
verifier, because the fixtures are not the delivered data.
"""

from __future__ import annotations

import logging
import shutil
from pathlib import Path
from typing import Any

import pytest
from hypothesis import given
from hypothesis import strategies as st

from hotspots import bootstrap as bs
from hotspots.config import AppConfig, BaselineConfig, Extent, RegionConfig
from hotspots.data import DataStore
from hotspots.data.check import CheckResult
from tests.fixtures import (
    DETECTIONS_FILENAME,
    GRID_FILENAME,
    write_fixture_dir,
)

TOKEN = "hf_SECRET_token_value_123"
REPO = "example-org/example-dataset"
ENV = {bs.REPO_ENV_VAR: REPO, bs.TOKEN_ENV_VAR: TOKEN}


def make_cfg(data_dir: Path) -> AppConfig:
    return AppConfig(
        region=RegionConfig(name="Test region", extent=Extent(-124.4, 32.5, -114.0, 42.2)),
        data_dir=data_dir,
        record_start="2000-11",
        excluded_cells=("38.7000_-117.4000",),
        baseline=BaselineConfig(start="2000-11", exclude_incomplete=True),
        watch_threshold=90.0,
        csv_avg_bytes_per_row=0.0,
    )


class FakeHub:
    """Stands in for `hf_hub_download`: copies fixture files into `local_dir`."""

    def __init__(self, source: Path, fail_with: Exception | None = None) -> None:
        self.source = source
        self.fail_with = fail_with
        self.calls: list[dict[str, Any]] = []

    def __call__(self, **kwargs: Any) -> str:
        self.calls.append(kwargs)
        if self.fail_with is not None:
            raise self.fail_with
        target = Path(kwargs["local_dir"]) / kwargs["filename"]
        shutil.copyfile(self.source / kwargs["filename"], target)
        return str(target)


def passing(_: AppConfig) -> list[CheckResult]:
    return [CheckResult("fake check", True, "ok")]


def failing(_: AppConfig) -> list[CheckResult]:
    return [CheckResult("grid row count", False, "expected 89467, got 3")]


@pytest.fixture
def source(tmp_path: Path) -> Path:
    return write_fixture_dir(tmp_path / "source")


def test_nothing_to_do_when_both_files_exist(tmp_path: Path, source: Path) -> None:
    hub = FakeHub(source)
    result = bs.bootstrap(make_cfg(source), {}, download=hub, verify=passing)
    assert result.downloaded == ()
    assert hub.calls == []


def test_downloads_both_missing_files_verifies_and_cleans_staging(
    tmp_path: Path, source: Path
) -> None:
    data_dir = tmp_path / "data"
    hub = FakeHub(source)
    result = bs.bootstrap(make_cfg(data_dir), ENV, download=hub, verify=passing)
    assert set(result.downloaded) == {GRID_FILENAME, DETECTIONS_FILENAME}
    assert (data_dir / GRID_FILENAME).is_file()
    assert (data_dir / DETECTIONS_FILENAME).is_file()
    assert sorted(p.name for p in data_dir.iterdir()) == sorted(
        [GRID_FILENAME, DETECTIONS_FILENAME]
    )
    for call in hub.calls:
        assert call["repo_id"] == REPO
        assert call["repo_type"] == "dataset"
        assert call["token"] == TOKEN


def test_downloads_only_the_missing_file(tmp_path: Path, source: Path) -> None:
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    shutil.copyfile(source / GRID_FILENAME, data_dir / GRID_FILENAME)
    hub = FakeHub(source)
    result = bs.bootstrap(make_cfg(data_dir), ENV, download=hub, verify=passing)
    assert result.downloaded == (DETECTIONS_FILENAME,)
    assert [c["filename"] for c in hub.calls] == [DETECTIONS_FILENAME]


@pytest.mark.parametrize(
    ("env", "named"),
    [
        ({bs.TOKEN_ENV_VAR: TOKEN}, [bs.REPO_ENV_VAR]),
        ({bs.REPO_ENV_VAR: REPO}, [bs.TOKEN_ENV_VAR]),
        ({bs.REPO_ENV_VAR: "  ", bs.TOKEN_ENV_VAR: ""}, [bs.REPO_ENV_VAR, bs.TOKEN_ENV_VAR]),
    ],
)
def test_missing_repo_or_token_fails_with_clear_message(
    tmp_path: Path, source: Path, env: dict[str, str], named: list[str]
) -> None:
    hub = FakeHub(source)
    with pytest.raises(bs.BootstrapError) as info:
        bs.bootstrap(make_cfg(tmp_path / "data"), env, download=hub, verify=passing)
    message = str(info.value)
    assert all(name in message for name in named)
    assert TOKEN not in message
    assert hub.calls == []


def test_failed_verification_removes_downloaded_files(tmp_path: Path, source: Path) -> None:
    data_dir = tmp_path / "data"
    with pytest.raises(bs.BootstrapError, match="do not match the data contract"):
        bs.bootstrap(make_cfg(data_dir), ENV, download=FakeHub(source), verify=failing)
    assert not (data_dir / GRID_FILENAME).exists()
    assert not (data_dir / DETECTIONS_FILENAME).exists()
    assert list(data_dir.iterdir()) == []


def test_download_failure_never_shows_token_and_leaves_app_startable(
    tmp_path: Path, source: Path, caplog: pytest.LogCaptureFixture
) -> None:
    data_dir = tmp_path / "data"
    hub = FakeHub(source, fail_with=RuntimeError(f"boom with Bearer {TOKEN}"))
    with caplog.at_level(logging.DEBUG), pytest.raises(bs.BootstrapError) as info:
        bs.bootstrap(make_cfg(data_dir), ENV, download=hub, verify=passing)
    assert TOKEN not in str(info.value)
    assert TOKEN not in caplog.text
    assert list(data_dir.iterdir()) == []
    store = DataStore(make_cfg(data_dir))  # the app still starts, in the unavailable state
    try:
        assert not store.available
        assert store.unavailable_reason
    finally:
        store.close()


def test_main_exit_codes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    config = tmp_path / "app.yaml"
    config.write_text(
        "region:\n"
        "  name: Test region\n"
        "  extent: {west: -124.4, south: 32.5, east: -114.0, north: 42.2}\n"
        f"data_dir: {tmp_path / 'data'}\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("HOTSPOTS_CONFIG", str(config))
    monkeypatch.delenv(bs.REPO_ENV_VAR, raising=False)
    monkeypatch.setenv(bs.TOKEN_ENV_VAR, TOKEN)
    assert bs.main([]) == 1
    err = capsys.readouterr().err
    assert bs.REPO_ENV_VAR in err
    assert TOKEN not in err

    config.write_text("region: 3\n", encoding="utf-8")
    assert bs.main([]) == 2


@given(
    text=st.text(max_size=200),
    secret=st.text(alphabet=st.characters(whitelist_categories=("Ll", "Lu", "Nd")), min_size=1),
)
def test_scrub_removes_every_occurrence_of_the_secret(text: str, secret: str) -> None:
    """**Validates: Requirements 32.1** (the token never reaches logs or messages)."""
    assert secret not in bs.scrub(f"{text}{secret}{text}", secret)

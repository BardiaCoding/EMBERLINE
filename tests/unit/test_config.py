"""Unit tests for `hotspots.config` (Requirements 1.3, 1.4, 1.8).

Data folders are synthetic fixtures. TEST FIXTURE, not NASA data.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
import yaml

from hotspots.config import (
    CONFIG_ENV_VAR,
    DEFAULT_CSV_AVG_BYTES_PER_ROW,
    DEFAULT_EXCLUDED_CELLS,
    DEFAULT_RECORD_START,
    DEFAULT_WATCH_THRESHOLD,
    DETECTIONS_FILENAME,
    GRID_FILENAME,
    AppConfig,
    ConfigErrors,
    Extent,
    load_config,
    validate_config,
)
from tests.fixtures import write_fixture_dir

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SHIPPED_CONFIG = PROJECT_ROOT / "config" / "app.yaml"

REGION: dict[str, Any] = {
    "name": "Test region",
    "extent": {"west": -124.4, "south": 32.5, "east": -114.0, "north": 42.2},
}


def _minimal(data_dir: Path) -> dict[str, Any]:
    """Only the required fields: every optional setting falls back to its default."""
    return {"region": dict(REGION), "data_dir": str(data_dir)}


def _write_yaml(path: Path, raw: Any) -> Path:
    path.write_text(yaml.safe_dump(raw), encoding="utf-8")
    return path


def _as_config(result: AppConfig | ConfigErrors) -> AppConfig:
    assert isinstance(result, AppConfig), (
        result.format() if isinstance(result, ConfigErrors) else result
    )
    return result


def _as_errors(result: AppConfig | ConfigErrors) -> ConfigErrors:
    assert isinstance(result, ConfigErrors), f"expected errors, got {result!r}"
    assert result.errors, "ConfigErrors must never be empty"
    return result


# --- shipped config/app.yaml (Requirements 1.3, 1.4, 1.8) -------------------------------


def test_shipped_config_loads_with_expected_values() -> None:
    """The shipped file loads without data present (`require_data=False`)."""
    cfg = _as_config(load_config(SHIPPED_CONFIG, require_data=False))

    assert cfg.region.name == "California region"  # Requirement 1.3
    assert cfg.region.extent == Extent(west=-124.4, south=32.5, east=-114.0, north=42.2)
    assert cfg.data_dir == Path("outputs2.0")  # Requirement 1.4
    assert cfg.record_start == "2000-11"
    assert cfg.excluded_cells == ("38.7000_-117.4000",)
    assert cfg.baseline.start == "2000-11"  # `record_start` literal resolved
    assert cfg.baseline.exclude_incomplete is True
    assert cfg.watch_threshold == 90.0  # Requirement 1.8
    assert cfg.csv_avg_bytes_per_row == 98.0  # measured on the delivered detections (19.27)
    assert len(cfg.example_areas) == 4


def test_shipped_config_validates_against_a_fixture_data_folder(tmp_path: Path) -> None:
    """With `require_data=True`, the shipped file is valid once its data folder exists."""
    raw = yaml.safe_load(SHIPPED_CONFIG.read_text(encoding="utf-8"))
    raw["data_dir"] = str(write_fixture_dir(tmp_path))
    cfg = _as_config(validate_config(raw))
    assert cfg.grid_path == Path(raw["data_dir"]) / GRID_FILENAME
    assert cfg.detections_path == Path(raw["data_dir"]) / DETECTIONS_FILENAME


def test_shipped_data_dir_is_relative_so_no_path_is_hard_coded() -> None:
    raw = yaml.safe_load(SHIPPED_CONFIG.read_text(encoding="utf-8"))
    assert raw["data_dir"] == "outputs2.0"
    assert not Path(raw["data_dir"]).is_absolute()


def test_default_path_is_config_app_yaml_in_the_working_directory(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv(CONFIG_ENV_VAR, raising=False)
    monkeypatch.chdir(PROJECT_ROOT)
    cfg = _as_config(load_config(require_data=False))
    assert cfg.region.name == "California region"


def test_env_variable_selects_the_config_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    data_dir = write_fixture_dir(tmp_path)
    raw = _minimal(data_dir)
    raw["region"] = {**REGION, "name": "From env"}
    cfg_file = _write_yaml(tmp_path / "other.yaml", raw)
    monkeypatch.setenv(CONFIG_ENV_VAR, str(cfg_file))
    cfg = _as_config(load_config())
    assert cfg.region.name == "From env"


def test_explicit_path_wins_over_env_variable(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    data_dir = write_fixture_dir(tmp_path)
    explicit = _write_yaml(tmp_path / "explicit.yaml", _minimal(data_dir))
    monkeypatch.setenv(CONFIG_ENV_VAR, str(tmp_path / "does_not_exist.yaml"))
    assert isinstance(load_config(explicit), AppConfig)


# --- defaults ---------------------------------------------------------------------------


def test_defaults_apply_when_optional_fields_are_absent(tmp_path: Path) -> None:
    cfg = _as_config(validate_config(_minimal(write_fixture_dir(tmp_path))))

    assert cfg.record_start == DEFAULT_RECORD_START == "2000-11"
    assert cfg.excluded_cells == DEFAULT_EXCLUDED_CELLS == ("38.7000_-117.4000",)
    assert cfg.baseline.start == "2000-11"
    assert cfg.baseline.exclude_incomplete is True
    assert cfg.watch_threshold == DEFAULT_WATCH_THRESHOLD == 90.0
    assert cfg.csv_avg_bytes_per_row == DEFAULT_CSV_AVG_BYTES_PER_ROW == 0.0
    assert cfg.example_areas == ()


def test_baseline_start_follows_a_custom_record_start(tmp_path: Path) -> None:
    raw = _minimal(write_fixture_dir(tmp_path))
    raw["record_start"] = "2003-05"
    cfg = _as_config(validate_config(raw))
    assert cfg.record_start == "2003-05"
    assert cfg.baseline.start == "2003-05"


def test_explicit_values_override_defaults(tmp_path: Path) -> None:
    raw = _minimal(write_fixture_dir(tmp_path))
    raw.update(
        watch_threshold=75,
        excluded_cells=["a_b", " c_d "],
        csv_avg_bytes_per_row=123.5,
        baseline={"start": "2005-01", "exclude_incomplete": False},
    )
    cfg = _as_config(validate_config(raw))
    assert cfg.watch_threshold == 75.0
    assert cfg.excluded_cells == ("a_b", "c_d")
    assert cfg.csv_avg_bytes_per_row == 123.5
    assert cfg.baseline.start == "2005-01"
    assert cfg.baseline.exclude_incomplete is False


# --- missing data files are reported with their path ------------------------------------


def test_missing_data_folder_is_reported_with_its_path(tmp_path: Path) -> None:
    missing = tmp_path / "no_such_folder"
    errors = _as_errors(validate_config(_minimal(missing)))
    assert [e.field for e in errors.errors] == ["data_dir"]
    assert str(missing) in errors.errors[0].reason
    assert str(missing) in errors.format()


@pytest.mark.parametrize("filename", [GRID_FILENAME, DETECTIONS_FILENAME])
def test_missing_parquet_file_is_reported_with_its_path(tmp_path: Path, filename: str) -> None:
    data_dir = write_fixture_dir(tmp_path)
    (data_dir / filename).unlink()
    errors = _as_errors(validate_config(_minimal(data_dir)))
    assert len(errors.errors) == 1
    assert errors.errors[0].field == "data_dir"
    assert str(data_dir / filename) in errors.errors[0].reason


def test_both_missing_files_are_reported_in_one_call(tmp_path: Path) -> None:
    data_dir = tmp_path / "empty_data"
    data_dir.mkdir()
    errors = _as_errors(validate_config(_minimal(data_dir)))
    reasons = " | ".join(e.reason for e in errors.errors)
    assert len(errors.errors) == 2
    assert str(data_dir / GRID_FILENAME) in reasons
    assert str(data_dir / DETECTIONS_FILENAME) in reasons


def test_data_dir_that_is_a_file_is_reported(tmp_path: Path) -> None:
    not_a_dir = tmp_path / "file.txt"
    not_a_dir.write_text("x", encoding="utf-8")
    errors = _as_errors(validate_config(_minimal(not_a_dir)))
    assert str(not_a_dir) in errors.errors[0].reason


def test_require_data_false_accepts_a_missing_data_folder(tmp_path: Path) -> None:
    missing = tmp_path / "no_such_folder"
    cfg = _as_config(validate_config(_minimal(missing), require_data=False))
    assert cfg.data_dir == missing


def test_require_data_false_still_reports_other_errors(tmp_path: Path) -> None:
    raw = _minimal(tmp_path / "no_such_folder")
    raw["record_start"] = "2000-13"
    errors = _as_errors(validate_config(raw, require_data=False))
    assert [e.field for e in errors.errors] == ["record_start"]


def test_data_file_contents_are_not_opened(tmp_path: Path) -> None:
    """Validation checks existence only: empty placeholder files pass."""
    data_dir = tmp_path / "placeholders"
    data_dir.mkdir()
    (data_dir / GRID_FILENAME).write_bytes(b"")
    (data_dir / DETECTIONS_FILENAME).write_bytes(b"not parquet")
    assert isinstance(validate_config(_minimal(data_dir)), AppConfig)


# --- all errors are reported in one call ------------------------------------------------


def test_every_invalid_field_is_reported_in_one_call(tmp_path: Path) -> None:
    raw: dict[str, Any] = {
        "region": {
            "name": "   ",
            "extent": {"west": -200, "south": 50, "east": -114.0, "north": 42.2},
        },
        "data_dir": str(tmp_path / "missing"),
        "record_start": "2000-13",
        "excluded_cells": ["ok_cell", "", 5],
        "baseline": {"start": "1999-01", "exclude_incomplete": "yes"},
        "watch_threshold": 100,
        "csv_avg_bytes_per_row": -1,
    }
    errors = _as_errors(validate_config(raw))
    fields = {e.field for e in errors.errors}
    assert fields >= {
        "region.name",
        "region.extent.west",
        "data_dir",
        "record_start",
        "excluded_cells[1]",
        "excluded_cells[2]",
        "baseline.exclude_incomplete",
        "watch_threshold",
        "csv_avg_bytes_per_row",
    }
    # Each error appears once in the formatted report, which names every field.
    report = errors.format()
    assert f"{len(errors.errors)} problem(s)" in report
    for field in fields:
        assert field in report
    assert errors.as_pairs() == [(e.field, e.reason) for e in errors.errors]


def test_extent_ordering_errors_for_both_axes_are_reported_together(tmp_path: Path) -> None:
    raw = _minimal(write_fixture_dir(tmp_path))
    raw["region"] = {
        "name": "Test region",
        "extent": {"west": -100, "south": 40, "east": -110, "north": 30},
    }
    errors = _as_errors(validate_config(raw))
    reasons = [e.reason for e in errors.errors if e.field == "region.extent"]
    assert len(reasons) == 2
    assert any("west" in r for r in reasons)
    assert any("south" in r for r in reasons)


def test_missing_required_fields_are_all_reported(tmp_path: Path) -> None:
    errors = _as_errors(validate_config({}))
    assert {e.field for e in errors.errors} == {"region", "data_dir"}


def test_missing_data_and_invalid_field_are_reported_together(tmp_path: Path) -> None:
    raw = _minimal(tmp_path / "missing")
    raw["watch_threshold"] = 0
    errors = _as_errors(validate_config(raw))
    assert {e.field for e in errors.errors} == {"data_dir", "watch_threshold"}


# --- file-level failures ----------------------------------------------------------------


def test_missing_config_file_is_reported_with_its_path(tmp_path: Path) -> None:
    missing = tmp_path / "nope.yaml"
    errors = _as_errors(load_config(missing))
    assert errors.errors[0].field == "config"
    assert str(missing) in errors.errors[0].reason


def test_invalid_yaml_is_reported(tmp_path: Path) -> None:
    bad = tmp_path / "bad.yaml"
    bad.write_text("region: [unclosed\n", encoding="utf-8")
    errors = _as_errors(load_config(bad))
    assert errors.errors[0].field == "config"
    assert "invalid YAML" in errors.errors[0].reason


@pytest.mark.parametrize("content", ["- just\n- a list\n", "", "42\n"])
def test_top_level_must_be_a_mapping(tmp_path: Path, content: str) -> None:
    path = tmp_path / "list.yaml"
    path.write_text(content, encoding="utf-8")
    errors = _as_errors(load_config(path))
    assert errors.errors[0].field == "config"
    assert "mapping" in errors.errors[0].reason


def test_load_config_reports_missing_data_with_path_from_a_yaml_file(tmp_path: Path) -> None:
    missing = tmp_path / "gone"
    cfg_file = _write_yaml(tmp_path / "app.yaml", _minimal(missing))
    errors = _as_errors(load_config(cfg_file))
    assert str(missing) in errors.format()
    assert isinstance(load_config(cfg_file, require_data=False), AppConfig)

"""Data-contract check: compare the delivered Parquet files with `data-contract.md`.

Run: `uv run python -m hotspots.data.check` (config from `HOTSPOTS_CONFIG`, default
`config/app.yaml`). Prints PASS or FAIL for each check and exits 1 when any check fails,
2 when the configuration or the data files cannot be loaded, 0 when everything matches.

The expected values below are the contract numbers. Do not edit them to make a check pass. If
the delivered data legitimately changes, the data owner updates the contract first.
All files are read through the data layer (`DataStore.raw_query`).
Units: counts are cell-days; coordinates are EPSG:4326 degrees; days use fixed UTC-8.
"""

from __future__ import annotations

import sys
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from typing import Final

from hotspots.config import AppConfig, ConfigErrors, load_config
from hotspots.constants import CELL_SIZE_DEG
from hotspots.data.contract_queries import (
    EXCLUDED_CELL_ID,
    ColumnInfo,
    ContractFacts,
    collect_facts,
)
from hotspots.data.store import DataStore
from hotspots.data.types import DataUnavailableError

# --- contract numbers (data-contract.md) -------------------------------------------------

GRID_ROWS: Final[int] = 89_467
DETECTION_ROWS: Final[int] = 2_105_593
GRID_CELLS: Final[int] = 5_370
FRP_MEAN_NULL_ROWS: Final[int] = 4_697
PRE_RECORD_DAY: Final[date] = date(2000, 10, 31)
PRE_RECORD_GRID_ROWS: Final[int] = 1

# Measured extent. Grid cells: SW corners plus one cell size. Detections: raw lat and lon.
GRID_EXTENT: Final[Mapping[str, float]] = {
    "south": 32.5,
    "north": 42.2,
    "west": -124.4,
    "east": -114.0,
}
DETECTION_EXTENT: Final[Mapping[str, float]] = {
    "south": 32.5,
    "north": 42.1,
    "west": -124.39,
    "east": -114.1,
}
GRID_EXTENT_TOLERANCE: Final[float] = 1e-6
"""`disp_lon` carries floating-point noise (about 1e-14)."""
DETECTION_EXTENT_TOLERANCE: Final[float] = 0.005
"""The contract states detection bounds to two decimals."""

# Contract column types. Kinds map to the DuckDB types accepted for them.
_KIND_TYPES: Final[Mapping[str, frozenset[str]]] = {
    "str": frozenset({"VARCHAR"}),
    "double": frozenset({"DOUBLE"}),
    "int": frozenset({"TINYINT", "SMALLINT", "INTEGER", "BIGINT", "HUGEINT"}),
    "bool": frozenset({"BOOLEAN"}),
    "date": frozenset({"DATE"}),
    "timestamp": frozenset({"TIMESTAMP", "TIMESTAMP WITH TIME ZONE"}),
}

# Grid: types are stated in the contract (str, double, int, bool), in file order.
GRID_COLUMNS: Final[tuple[tuple[str, str], ...]] = (
    ("cell_id", "str"),
    ("disp_lat", "double"),
    ("disp_lon", "double"),
    ("region_id", "str"),
    ("year", "int"),
    ("month", "int"),
    ("count_harmonized", "double"),
    ("count_raw_modis", "int"),
    ("count_raw_viirs", "int"),
    ("frp_sum", "double"),
    ("frp_mean", "double"),
    ("source_flag", "str"),
    ("calib_model", "str"),
    ("provenance", "str"),
    ("incomplete", "bool"),
)
# Detections: the contract lists names and order only. The kinds follow from the column
# meanings (coordinates are degrees, `acq_date_local` is a day, `acq_datetime_utc` an instant).
DETECTION_COLUMNS: Final[tuple[tuple[str, str], ...]] = (
    ("sensor_family", "str"),
    ("satellite", "str"),
    ("source", "str"),
    ("lat", "double"),
    ("lon", "double"),
    ("acq_datetime_utc", "timestamp"),
    ("acq_date_local", "date"),
    ("year", "int"),
    ("month", "int"),
    ("daynight", "str"),
    ("confidence_class", "str"),
    ("confidence_raw", "str"),
    ("frp", "double"),
    ("type", "int"),
    ("pixel_size_m", "int"),
    ("version", "str"),
)


@dataclass(frozen=True)
class CheckResult:
    """Outcome of one check. `detail` states the expected and the measured value."""

    name: str
    passed: bool
    detail: str


# --- pure comparison (no I/O) ------------------------------------------------------------


def run_checks(facts: ContractFacts) -> list[CheckResult]:
    """Compare measured facts with the contract. One `CheckResult` per check."""
    g, d = facts.grid, facts.detections
    results = [
        _check_columns("grid columns and types", g.columns, GRID_COLUMNS),
        _check_columns("detections columns and types", d.columns, DETECTION_COLUMNS),
        _check_equal("grid row count", GRID_ROWS, g.row_count),
        _check_equal("detections row count", DETECTION_ROWS, d.row_count),
        _check_equal("grid cell count (distinct cell_id)", GRID_CELLS, g.cell_count),
        _check_extent(
            "grid extent (cell SW corner plus cell size)",
            GRID_EXTENT,
            {
                "south": g.lat_min,
                "north": g.lat_max + CELL_SIZE_DEG,
                "west": g.lon_min,
                "east": g.lon_max + CELL_SIZE_DEG,
            },
            GRID_EXTENT_TOLERANCE,
        ),
        _check_extent(
            "detections extent (lat and lon)",
            DETECTION_EXTENT,
            {"south": d.lat_min, "north": d.lat_max, "west": d.lon_min, "east": d.lon_max},
            DETECTION_EXTENT_TOLERANCE,
        ),
        _check_equal(
            "October 2000 grid rows (one row)",
            PRE_RECORD_GRID_ROWS,
            g.pre_record_rows,
        ),
        _check_equal(
            "October 2000 local days in detections (only 2000-10-31)",
            [PRE_RECORD_DAY.isoformat()],
            [x.isoformat() for x in d.pre_record_local_dates],
        ),
        _check_excluded_cell(
            g.excluded_cell_rows, g.excluded_cell_count_min, g.excluded_cell_count_max
        ),
        _check_equal("frp_mean null rows in grid", FRP_MEAN_NULL_ROWS, g.frp_mean_null_rows),
    ]
    return results


def _check_equal(name: str, expected: object, actual: object) -> CheckResult:
    ok = expected == actual
    detail = f"{actual!r}" if ok else f"expected {expected!r}, got {actual!r}"
    return CheckResult(name, ok, detail)


def _check_columns(
    name: str, actual: Sequence[ColumnInfo], expected: Sequence[tuple[str, str]]
) -> CheckResult:
    problems: list[str] = []
    actual_names = [c.name for c in actual]
    expected_names = [n for n, _ in expected]
    missing = [n for n in expected_names if n not in actual_names]
    extra = [n for n in actual_names if n not in expected_names]
    if missing:
        problems.append(f"missing columns {missing}")
    if extra:
        problems.append(f"unexpected columns {extra}")
    if not missing and not extra and actual_names != expected_names:
        problems.append(f"column order differs: {actual_names}")
    by_name = {c.name: c.type for c in actual}
    for col, kind in expected:
        got = by_name.get(col)
        if got is not None and got not in _KIND_TYPES[kind]:
            problems.append(f"{col}: expected {kind} ({sorted(_KIND_TYPES[kind])}), got {got}")
    if problems:
        return CheckResult(name, False, "; ".join(problems))
    return CheckResult(name, True, f"{len(expected)} columns match")


def _check_extent(
    name: str, expected: Mapping[str, float], actual: Mapping[str, float], tolerance: float
) -> CheckResult:
    bad = [
        f"{edge} expected {expected[edge]}, got {actual[edge]!r}"
        for edge in ("south", "north", "west", "east")
        if abs(actual[edge] - expected[edge]) > tolerance
    ]
    if bad:
        return CheckResult(name, False, "; ".join(bad))
    shown = ", ".join(f"{edge} {expected[edge]}" for edge in ("south", "north", "west", "east"))
    return CheckResult(name, True, shown)


def _check_excluded_cell(rows: int, low: float | None, high: float | None) -> CheckResult:
    name = f"excluded cell {EXCLUDED_CELL_ID}: one row with count 0"
    if rows == 1 and low == 0.0 and high == 0.0:
        return CheckResult(name, True, "1 row, count_harmonized 0")
    return CheckResult(
        name,
        False,
        f"expected 1 row with count_harmonized 0, got {rows} row(s), "
        f"count min {low!r}, max {high!r}",
    )


def format_report(results: Iterable[CheckResult]) -> str:
    """One line per check: `PASS` or `FAIL`, the name, then the detail."""
    return "\n".join(f"{'PASS' if r.passed else 'FAIL'}  {r.name}: {r.detail}" for r in results)


# --- entry point -------------------------------------------------------------------------


def check_delivered(cfg: AppConfig) -> list[CheckResult]:
    """Measure the delivered files named by `cfg` and compare them with the contract.

    Raises `DataUnavailableError` when a file is missing or unreadable.
    """
    store = DataStore(cfg)
    try:
        return run_checks(collect_facts(store))
    finally:
        store.close()


def main(argv: Sequence[str] | None = None) -> int:
    """Run the check and print the report. Returns the process exit code."""
    _ = argv  # no options; the config file comes from HOTSPOTS_CONFIG
    cfg = load_config()
    if isinstance(cfg, ConfigErrors):
        print(cfg.format(), file=sys.stderr)
        return 2
    try:
        results = check_delivered(cfg)
    except DataUnavailableError as exc:
        print(f"FAIL  delivered data cannot be read: {exc}", file=sys.stderr)
        return 2
    print(format_report(results))
    failed = [r for r in results if not r.passed]
    total = len(results)
    if failed:
        print(f"\n{len(failed)} of {total} checks FAILED.", file=sys.stderr)
        return 1
    print(f"\nAll {total} checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

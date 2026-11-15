"""Unit tests for the data-contract comparison (no data files are read)."""

from __future__ import annotations

from dataclasses import replace

from hotspots.data import check
from hotspots.data.contract_queries import (
    EXCLUDED_CELL_ID,
    ColumnInfo,
    ContractFacts,
    DetectionFacts,
    GridFacts,
)

_TYPES = {
    "str": "VARCHAR",
    "double": "DOUBLE",
    "int": "INTEGER",
    "bool": "BOOLEAN",
    "date": "DATE",
    "timestamp": "TIMESTAMP",
}


def _columns(spec: tuple[tuple[str, str], ...]) -> tuple[ColumnInfo, ...]:
    return tuple(ColumnInfo(name, _TYPES[kind]) for name, kind in spec)


def _matching_facts() -> ContractFacts:
    """Facts that equal the contract exactly (synthetic, built from the contract constants)."""
    grid = GridFacts(
        columns=_columns(check.GRID_COLUMNS),
        row_count=check.GRID_ROWS,
        cell_count=check.GRID_CELLS,
        lat_min=32.5,
        lat_max=42.1,
        lon_min=-124.4,
        lon_max=-114.1,
        pre_record_rows=1,
        excluded_cell_rows=1,
        excluded_cell_count_min=0.0,
        excluded_cell_count_max=0.0,
        frp_mean_null_rows=check.FRP_MEAN_NULL_ROWS,
    )
    detections = DetectionFacts(
        columns=_columns(check.DETECTION_COLUMNS),
        row_count=check.DETECTION_ROWS,
        lat_min=32.5,
        lat_max=42.1,
        lon_min=-124.39,
        lon_max=-114.1,
        pre_record_local_dates=(check.PRE_RECORD_DAY,),
    )
    return ContractFacts(grid=grid, detections=detections)


def _failed(facts: ContractFacts) -> list[str]:
    return [r.name for r in check.run_checks(facts) if not r.passed]


def test_matching_facts_pass_every_check() -> None:
    assert _failed(_matching_facts()) == []


def test_each_mismatch_is_reported_by_its_own_check() -> None:
    facts = _matching_facts()
    grid = replace(
        facts.grid,
        row_count=1,
        cell_count=1,
        lat_max=43.0,
        pre_record_rows=2,
        excluded_cell_count_max=3.0,
        frp_mean_null_rows=0,
    )
    det = replace(facts.detections, row_count=1, lon_min=-125.0, pre_record_local_dates=())
    failed = _failed(ContractFacts(grid=grid, detections=det))
    assert len(failed) == 9
    assert not any("columns" in name for name in failed)


def test_a_wrong_column_type_or_name_fails() -> None:
    facts = _matching_facts()
    cols = list(facts.grid.columns)
    cols[4] = ColumnInfo("year", "VARCHAR")
    cols[0] = ColumnInfo("cellid", "VARCHAR")
    bad = replace(facts, grid=replace(facts.grid, columns=tuple(cols)))
    assert _failed(bad) == ["grid columns and types"]


def test_report_marks_pass_and_fail() -> None:
    results = [check.CheckResult("a", True, "ok"), check.CheckResult("b", False, "bad")]
    assert check.format_report(results) == "PASS  a: ok\nFAIL  b: bad"


def test_excluded_cell_id_is_the_contract_cell() -> None:
    assert EXCLUDED_CELL_ID == "38.7000_-117.4000"

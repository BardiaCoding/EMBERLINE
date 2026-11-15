"""Sanity tests for the synthetic fixtures. TEST FIXTURE, not NASA data."""

from __future__ import annotations

import pyarrow.parquet as pq
from hypothesis import given

from tests.fixtures import (
    DETECTIONS_FILENAME,
    DETECTIONS_SCHEMA,
    EXCLUDED_CELL_ID,
    FIXTURE_DIRNAME,
    FIXTURE_LABEL,
    GRID_FILENAME,
    GRID_SCHEMA,
    write_fixture_dir,
)
from tests.property.strategies.grids import grids, year_months
from tests.property.strategies.series import count_series


def test_fixtures_round_trip_with_label(tmp_path):
    data_dir = write_fixture_dir(tmp_path)
    assert data_dir.name == FIXTURE_DIRNAME

    grid = pq.read_table(data_dir / GRID_FILENAME)
    detections = pq.read_table(data_dir / DETECTIONS_FILENAME)
    assert grid.schema.names == GRID_SCHEMA.names
    assert detections.schema.names == DETECTIONS_SCHEMA.names
    for name in (GRID_FILENAME, DETECTIONS_FILENAME):
        metadata = pq.read_schema(data_dir / name).metadata
        assert metadata[b"fixture_label"].decode() == FIXTURE_LABEL


def test_default_grid_has_the_required_edge_cases(tmp_path):
    rows = pq.read_table(write_fixture_dir(tmp_path) / GRID_FILENAME).to_pylist()
    assert (2000, 10) in {(r["year"], r["month"]) for r in rows}
    assert {r["cell_id"] for r in rows if r["incomplete"]} >= {EXCLUDED_CELL_ID}
    assert {(r["year"], r["month"]) for r in rows if r["incomplete"]} == {(2026, 11)}
    assert any(r["disp_lon"] != round(r["disp_lon"], 1) for r in rows)
    assert any(r["frp_mean"] is None for r in rows)
    assert all(r["count_harmonized"] > 0 for r in rows if r["cell_id"] != EXCLUDED_CELL_ID)


def test_default_detections_sorted_and_october_2000_local_day(tmp_path):
    rows = pq.read_table(write_fixture_dir(tmp_path) / DETECTIONS_FILENAME).to_pylist()
    days = [r["acq_date_local"] for r in rows]
    assert days == sorted(days)
    first = rows[0]
    assert (first["year"], first["month"]) == (2000, 10)
    assert first["acq_datetime_utc"].month == 11


@given(grids())
def test_grids_strategy_rows_are_unique_and_sparse(rows):
    keys = [(r["cell_id"], r["year"], r["month"]) for r in rows]
    assert len(keys) == len(set(keys))
    assert all(r["count_harmonized"] > 0 for r in rows)
    assert EXCLUDED_CELL_ID not in {r["cell_id"] for r in rows}


@given(year_months(), count_series())
def test_year_months_and_count_series_ranges(ym, series):
    assert (2000, 11) <= ym <= (2026, 11)
    assert series
    assert all(v >= 0 for v in series)

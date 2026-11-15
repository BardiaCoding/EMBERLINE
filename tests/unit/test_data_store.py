"""Unit tests for `DataStore` (DuckDB access layer) on synthetic Parquet files.

Every file comes from `tests/fixtures.py`: TEST FIXTURE, not NASA data.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any, cast

import pytest

from hotspots.config import AppConfig, BaselineConfig, Extent, RegionConfig
from hotspots.data import BBox, DataStore, DataUnavailableError, YearMonth
from tests.fixtures import (
    DETECTIONS_FILENAME,
    DETECTIONS_SCHEMA,
    EXCLUDED_CELL_ID,
    GRID_FILENAME,
    default_grid_rows,
    make_detection_row,
    make_grid_row,
    write_fixture_dir,
)

StoreFactory = Callable[..., DataStore]

WHOLE_REGION = BBox(west=-125.0, south=32.0, east=-113.0, north=43.0)
ALL_DAYS = (date(2000, 1, 1), date(2030, 12, 31))


def make_cfg(
    data_dir: Path,
    record_start: str = "2000-11",
    excluded: tuple[str, ...] = (EXCLUDED_CELL_ID,),
) -> AppConfig:
    return AppConfig(
        region=RegionConfig(name="Test region", extent=Extent(-124.4, 32.5, -114.0, 42.2)),
        data_dir=data_dir,
        record_start=record_start,
        excluded_cells=excluded,
        baseline=BaselineConfig(start=record_start, exclude_incomplete=True),
        watch_threshold=90.0,
        csv_avg_bytes_per_row=0.0,
    )


@pytest.fixture
def open_store() -> Iterator[StoreFactory]:
    """Build stores and close them all at teardown."""
    stores: list[DataStore] = []

    def factory(data_dir: Path, **kwargs: Any) -> DataStore:
        store = DataStore(make_cfg(data_dir, **kwargs))
        stores.append(store)
        return store

    yield factory
    for s in stores:
        s.close()


# A small, known detection set. Points are spread over cells and days; the UTC day differs from
# the local day (UTC-8) for two of them. TEST FIXTURE, not NASA data.
_DET_SPEC: list[tuple[float, float, datetime]] = [
    (34.05, -118.05, datetime(2020, 7, 10, 12, 0)),  # local 07-10
    (34.05, -118.05, datetime(2020, 7, 15, 12, 0)),  # local 07-15
    (35.00, -119.00, datetime(2020, 7, 12, 18, 30)),  # local 07-12
    (40.00, -122.00, datetime(2020, 7, 12, 20, 0)),  # local 07-12, far north
    (34.05, -118.05, datetime(2020, 8, 1, 9, 0)),  # local 08-01
    (34.00, -118.00, datetime(2020, 7, 10, 23, 0)),  # exactly on a bbox corner, local 07-10
    (34.05, -118.05, datetime(2020, 7, 16, 3, 0)),  # UTC 07-16, local 07-15
    (34.05, -118.05, datetime(2020, 7, 10, 5, 0)),  # UTC 07-10, local 07-09
]


def _det_rows() -> list[dict[str, Any]]:
    rows = [make_detection_row(lat, lon, utc) for lat, lon, utc in _DET_SPEC]
    return sorted(rows, key=lambda r: (r["acq_date_local"], r["acq_datetime_utc"]))


def _expected(rows: list[dict[str, Any]], bbox: BBox, d0: date, d1: date) -> list[Any]:
    """Independent pure-Python filter: inclusive bbox edges, inclusive local-day range."""
    return sorted(
        (r["lat"], r["lon"], r["acq_datetime_utc"])
        for r in rows
        if bbox.south <= r["lat"] <= bbox.north
        and bbox.west <= r["lon"] <= bbox.east
        and d0 <= r["acq_date_local"] <= d1
    )


def _fetched(store: DataStore, bbox: BBox, d0: date, d1: date, batch: int = 50_000) -> list[Any]:
    out: list[Any] = []
    for table in store.iter_detections(bbox, d0, d1, batch=batch):
        out.extend(
            zip(*(table[c].to_pylist() for c in ("lat", "lon", "acq_datetime_utc")), strict=True)
        )
    return sorted(out)


# ---------------------------------------------------------------------------------------------
# Grid
# ---------------------------------------------------------------------------------------------


def test_available_store_loads_grid_to_expected_shape(
    tmp_path: Path, open_store: StoreFactory
) -> None:
    store = open_store(write_fixture_dir(tmp_path))
    assert store.available
    assert store.grid_available and store.detections_available
    assert store.unavailable_reason is None
    g = store.grid()
    assert g.harm.shape == (4, 313)
    assert g.n_cells == 4
    assert store.grid() is g  # loaded once


def test_excluded_cell_and_october_2000_never_appear(
    tmp_path: Path, open_store: StoreFactory
) -> None:
    g = open_store(write_fixture_dir(tmp_path)).grid()
    assert EXCLUDED_CELL_ID not in g.cell_ids
    assert g.months[0] == YearMonth(2000, 11)
    assert YearMonth(2000, 10) not in g.months


def test_raw_query_sees_the_files_as_delivered(tmp_path: Path, open_store: StoreFactory) -> None:
    store = open_store(write_fixture_dir(tmp_path))
    rows = store.raw_query("grid", "SELECT count(*) FROM {src}")
    assert rows == [(len(default_grid_rows()),)]  # includes the excluded cell and October 2000
    excluded = store.raw_query(
        "grid", "SELECT count(*) FROM {src} WHERE cell_id = ?", [EXCLUDED_CELL_ID]
    )
    assert excluded == [(1,)]


def test_joins_ignore_float_noise_in_disp_lon(tmp_path: Path, open_store: StoreFactory) -> None:
    # The same cell_id arrives with different disp_lon noise in different months.
    rows = [
        make_grid_row(340, -1181, 2001, 7, 5.0),
        make_grid_row(340, -1181, 2012, 7, 6.0),
        make_grid_row(340, -1181, 2018, 8, 7.0),
    ]
    rows[1]["disp_lon"] += 1e-13
    rows[2]["disp_lon"] -= 1e-13
    g = open_store(write_fixture_dir(tmp_path, grid_rows=rows)).grid()
    assert g.cell_ids == ["34.0000_-118.1000"]
    assert g.harm.sum() == 18.0
    assert g.harm.shape[0] == 1


def test_latest_month_and_latest_complete_month(tmp_path: Path, open_store: StoreFactory) -> None:
    store = open_store(write_fixture_dir(tmp_path))
    assert store.latest_month() == YearMonth(2026, 11)
    assert store.latest_complete_month() == YearMonth(2026, 10)
    assert bool(store.grid().incomplete[-1])


def test_latest_complete_month_equals_latest_when_nothing_is_incomplete(
    tmp_path: Path, open_store: StoreFactory
) -> None:
    rows = [
        make_grid_row(340, -1181, 2026, 9, 1.0),
        make_grid_row(340, -1181, 2026, 10, 2.0, incomplete=False),
    ]
    store = open_store(write_fixture_dir(tmp_path, grid_rows=rows))
    assert store.latest_month() == store.latest_complete_month() == YearMonth(2026, 10)


def test_latest_complete_month_raises_when_every_month_is_incomplete(
    tmp_path: Path, open_store: StoreFactory
) -> None:
    rows = [make_grid_row(340, -1181, 2026, 11, 1.0, incomplete=True)]
    # Months are dense from the record start, so start the record at the only month with rows.
    store = open_store(write_fixture_dir(tmp_path, grid_rows=rows), record_start="2026-11")
    assert store.latest_month() == YearMonth(2026, 11)
    with pytest.raises(DataUnavailableError, match="no complete month"):
        store.latest_complete_month()


# ---------------------------------------------------------------------------------------------
# Missing or broken files give the unavailable state
# ---------------------------------------------------------------------------------------------


def test_missing_data_dir_gives_unavailable_state(tmp_path: Path, open_store: StoreFactory) -> None:
    store = open_store(tmp_path / "does_not_exist")  # construction must not raise
    assert not store.available
    assert not store.grid_available and not store.detections_available
    reason = store.unavailable_reason
    assert reason is not None
    assert "grid file not found" in reason and "detections file not found" in reason


def test_unavailable_store_raises_on_every_data_method(
    tmp_path: Path, open_store: StoreFactory
) -> None:
    store = open_store(tmp_path)  # exists but holds no files
    day = date(2020, 7, 1)
    calls: list[Callable[[], object]] = [
        store.grid,
        store.latest_month,
        store.latest_complete_month,
        store.detections_latest_local_date,
        store.detections_latest_utc,
        lambda: store.count_detections(WHOLE_REGION, day, day),
        lambda: next(store.iter_detections(WHOLE_REGION, day, day)),
        lambda: store.raw_query("grid", "SELECT count(*) FROM {src}"),
        lambda: store.raw_query("detections", "SELECT count(*) FROM {src}"),
    ]
    for call in calls:
        with pytest.raises(DataUnavailableError):
            call()


def test_missing_detections_file_leaves_grid_usable(
    tmp_path: Path, open_store: StoreFactory
) -> None:
    data_dir = write_fixture_dir(tmp_path)
    (data_dir / DETECTIONS_FILENAME).unlink()
    store = open_store(data_dir)
    assert store.grid_available and not store.detections_available and not store.available
    assert store.unavailable_reason is not None
    assert "detections file not found" in store.unavailable_reason
    assert "grid" not in store.unavailable_reason
    assert store.latest_month() == YearMonth(2026, 11)
    with pytest.raises(DataUnavailableError):
        store.count_detections(WHOLE_REGION, *ALL_DAYS)


def test_missing_grid_file_leaves_detections_usable(
    tmp_path: Path, open_store: StoreFactory
) -> None:
    data_dir = write_fixture_dir(tmp_path, detections_rows=_det_rows())
    (data_dir / GRID_FILENAME).unlink()
    store = open_store(data_dir)
    assert not store.grid_available and store.detections_available and not store.available
    assert store.unavailable_reason is not None
    assert "grid file not found" in store.unavailable_reason
    with pytest.raises(DataUnavailableError):
        store.grid()
    assert store.count_detections(WHOLE_REGION, *ALL_DAYS) == len(_DET_SPEC)


def test_corrupt_grid_file_gives_unavailable_state(
    tmp_path: Path, open_store: StoreFactory
) -> None:
    data_dir = write_fixture_dir(tmp_path)
    (data_dir / GRID_FILENAME).write_bytes(b"this is not a parquet file")
    store = open_store(data_dir)
    assert not store.grid_available
    assert store.unavailable_reason is not None
    assert "cannot load grid file" in store.unavailable_reason
    with pytest.raises(DataUnavailableError):
        store.grid()


def test_grid_with_only_excluded_rows_gives_unavailable_state(
    tmp_path: Path, open_store: StoreFactory
) -> None:
    rows = [make_grid_row(387, -1174, 2026, 11, 0.0)]
    store = open_store(write_fixture_dir(tmp_path, grid_rows=rows))
    assert not store.grid_available
    assert store.unavailable_reason is not None
    assert "no grid rows" in store.unavailable_reason


def test_corrupt_detections_file_raises_unavailable_on_query(
    tmp_path: Path, open_store: StoreFactory
) -> None:
    data_dir = write_fixture_dir(tmp_path)
    (data_dir / DETECTIONS_FILENAME).write_bytes(b"this is not a parquet file")
    store = open_store(data_dir)  # existence is all that is checked at construction
    with pytest.raises(DataUnavailableError):
        store.count_detections(WHOLE_REGION, *ALL_DAYS)


# ---------------------------------------------------------------------------------------------
# Detections: latest dates
# ---------------------------------------------------------------------------------------------


def test_latest_local_date_and_latest_utc_differ_across_the_utc_offset(
    tmp_path: Path, open_store: StoreFactory
) -> None:
    rows = [
        make_detection_row(34.05, -118.05, datetime(2026, 11, 1, 20, 0)),
        make_detection_row(34.05, -118.05, datetime(2026, 11, 3, 2, 30)),  # local 2026-11-02
    ]
    store = open_store(write_fixture_dir(tmp_path, detections_rows=rows))
    assert store.detections_latest_local_date() == date(2026, 11, 2)
    latest = store.detections_latest_utc()
    assert latest == datetime(2026, 11, 3, 2, 30, tzinfo=UTC)
    assert latest.tzinfo is not None and latest.utcoffset() is not None
    assert latest.utcoffset().total_seconds() == 0  # type: ignore[union-attr]


def test_latest_dates_match_the_fixture_maximum(tmp_path: Path, open_store: StoreFactory) -> None:
    rows = _det_rows()
    store = open_store(write_fixture_dir(tmp_path, detections_rows=rows))
    assert store.detections_latest_local_date() == max(r["acq_date_local"] for r in rows)
    assert store.detections_latest_utc() == max(r["acq_datetime_utc"] for r in rows).replace(
        tzinfo=UTC
    )


def test_empty_detections_file_has_no_latest_date_and_zero_count(
    tmp_path: Path, open_store: StoreFactory
) -> None:
    store = open_store(write_fixture_dir(tmp_path, detections_rows=[]))
    assert store.detections_available
    with pytest.raises(DataUnavailableError, match="no rows"):
        store.detections_latest_local_date()
    with pytest.raises(DataUnavailableError, match="no rows"):
        store.detections_latest_utc()
    assert store.count_detections(WHOLE_REGION, *ALL_DAYS) == 0
    assert list(store.iter_detections(WHOLE_REGION, *ALL_DAYS)) == []


# ---------------------------------------------------------------------------------------------
# Detections: bbox and date pushdown
# ---------------------------------------------------------------------------------------------

_CASES: list[tuple[str, BBox, date, date]] = [
    ("whole region and record", WHOLE_REGION, *ALL_DAYS),
    ("one local day", WHOLE_REGION, date(2020, 7, 12), date(2020, 7, 12)),
    ("small bbox, July", BBox(-118.5, 33.5, -117.5, 34.5), date(2020, 7, 1), date(2020, 7, 31)),
    ("bbox edge is inclusive", BBox(-118.0, 34.0, -117.0, 35.0), *ALL_DAYS),
    ("date edges are inclusive", WHOLE_REGION, date(2020, 7, 10), date(2020, 7, 15)),
    ("local day, not UTC day, at the start", WHOLE_REGION, date(2020, 7, 10), date(2020, 7, 10)),
    ("local day, not UTC day, at the end", WHOLE_REGION, date(2020, 7, 15), date(2020, 7, 15)),
    ("northern bbox", BBox(-123.0, 39.0, -121.0, 41.0), *ALL_DAYS),
    ("bbox with no detections", BBox(-116.0, 33.0, -115.0, 34.0), *ALL_DAYS),
    ("dates with no detections", WHOLE_REGION, date(2019, 1, 1), date(2019, 12, 31)),
    ("start after end", WHOLE_REGION, date(2020, 8, 1), date(2020, 7, 1)),
]


@pytest.mark.parametrize(("bbox", "d0", "d1"), [c[1:] for c in _CASES], ids=[c[0] for c in _CASES])
def test_detections_pushdown_returns_only_rows_in_bbox_and_date_range(
    tmp_path: Path, open_store: StoreFactory, bbox: BBox, d0: date, d1: date
) -> None:
    rows = _det_rows()
    store = open_store(write_fixture_dir(tmp_path, detections_rows=rows))
    expected = _expected(rows, bbox, d0, d1)

    assert _fetched(store, bbox, d0, d1) == expected
    # count_detections equals the sum of the rows iter_detections yields, at any batch size.
    assert store.count_detections(bbox, d0, d1) == len(expected)
    for batch in (1, 2, 50_000):
        tables = list(store.iter_detections(bbox, d0, d1, batch=batch))
        assert sum(t.num_rows for t in tables) == len(expected)
        assert all(0 < t.num_rows <= batch for t in tables)


def test_detections_rows_have_all_contract_columns_and_stay_in_range(
    tmp_path: Path, open_store: StoreFactory
) -> None:
    rows = _det_rows()
    store = open_store(write_fixture_dir(tmp_path, detections_rows=rows))
    bbox, d0, d1 = BBox(-119.5, 33.5, -117.5, 35.5), date(2020, 7, 10), date(2020, 7, 15)
    tables = list(store.iter_detections(bbox, d0, d1))
    assert tables
    for table in tables:
        assert table.column_names == DETECTIONS_SCHEMA.names
        for r in table.to_pylist():
            assert bbox.south <= r["lat"] <= bbox.north
            assert bbox.west <= r["lon"] <= bbox.east
            assert d0 <= r["acq_date_local"] <= d1
    days = [r["acq_date_local"] for t in tables for r in t.to_pylist()]
    assert days == sorted(days)  # file order, sorted by local date


def test_iter_detections_rejects_batch_below_one(tmp_path: Path, open_store: StoreFactory) -> None:
    store = open_store(write_fixture_dir(tmp_path))
    with pytest.raises(ValueError, match="batch"):
        next(store.iter_detections(WHOLE_REGION, *ALL_DAYS, batch=0))


def test_iter_detections_can_be_closed_early(tmp_path: Path, open_store: StoreFactory) -> None:
    store = open_store(write_fixture_dir(tmp_path, detections_rows=_det_rows()))
    it = store.iter_detections(WHOLE_REGION, *ALL_DAYS, batch=1)
    assert next(it).num_rows == 1
    it.close()
    assert store.count_detections(WHOLE_REGION, *ALL_DAYS) == len(_DET_SPEC)  # store still works


def test_default_fixture_counts_match_iteration(tmp_path: Path, open_store: StoreFactory) -> None:
    store = open_store(write_fixture_dir(tmp_path))
    n = store.count_detections(WHOLE_REGION, *ALL_DAYS)
    assert n == 19  # 1 + 6 months x 3 detections
    assert sum(t.num_rows for t in store.iter_detections(WHOLE_REGION, *ALL_DAYS)) == n
    # The 2000-11-01 06:12 UTC detection is local 2000-10-31.
    assert store.count_detections(WHOLE_REGION, date(2000, 10, 31), date(2000, 10, 31)) == 1
    assert store.count_detections(WHOLE_REGION, date(2000, 11, 1), date(2000, 11, 1)) == 0


# ---------------------------------------------------------------------------------------------
# All SQL uses bound parameters
# ---------------------------------------------------------------------------------------------

_HOSTILE_DIRNAMES = [
    "o'brien; DROP TABLE t; --",
    "x') UNION SELECT 1 --",
    '100% "quoted" ? name',
]


@pytest.mark.parametrize("dirname", _HOSTILE_DIRNAMES)
def test_injection_style_data_path_does_not_alter_behaviour(
    tmp_path: Path, open_store: StoreFactory, dirname: str
) -> None:
    data_dir = write_fixture_dir(tmp_path / dirname, detections_rows=_det_rows())
    store = open_store(data_dir)
    assert store.available
    assert store.grid().n_cells == 4
    assert store.count_detections(WHOLE_REGION, *ALL_DAYS) == len(_DET_SPEC)
    assert store.detections_latest_local_date() == date(2020, 8, 1)
    assert sum(t.num_rows for t in store.iter_detections(WHOLE_REGION, *ALL_DAYS)) == len(_DET_SPEC)
    assert store.raw_query("grid", "SELECT count(*) FROM {src}") == [(len(default_grid_rows()),)]


@pytest.mark.parametrize(
    "value",
    ["x' OR '1'='1", "'; DROP TABLE t; --", f"{EXCLUDED_CELL_ID}' OR cell_id <> '"],
)
def test_injection_style_raw_query_param_is_bound_as_a_value(
    tmp_path: Path, open_store: StoreFactory, value: str
) -> None:
    store = open_store(write_fixture_dir(tmp_path))
    sql = "SELECT count(*) FROM {src} WHERE cell_id = ?"
    assert store.raw_query("grid", sql, [value]) == [(0,)]
    assert store.raw_query("grid", sql, [EXCLUDED_CELL_ID]) == [(1,)]  # still works afterwards


def test_injection_style_bbox_value_is_rejected_not_executed(
    tmp_path: Path, open_store: StoreFactory
) -> None:
    store = open_store(write_fixture_dir(tmp_path, detections_rows=_det_rows()))
    hostile = cast(Any, "0 OR 1=1")
    with pytest.raises(DataUnavailableError):
        store.count_detections(BBox(hostile, 32.0, -113.0, 43.0), *ALL_DAYS)
    assert store.count_detections(WHOLE_REGION, *ALL_DAYS) == len(_DET_SPEC)


@pytest.mark.parametrize(
    "sql",
    [
        "DELETE FROM {src}",
        "SELECT 1 FROM {src}; SELECT 2 FROM {src}",
        "SELECT 1",
        "SELECT * FROM {src} UNION SELECT * FROM {src}",
        "COPY (SELECT * FROM {src}) TO 'x.csv'",
    ],
)
def test_raw_query_rejects_anything_but_one_select_with_one_placeholder(
    tmp_path: Path, open_store: StoreFactory, sql: str
) -> None:
    store = open_store(write_fixture_dir(tmp_path))
    with pytest.raises(ValueError):  # noqa: PT011 - several messages, all ValueError
        store.raw_query("grid", sql)
    assert not (tmp_path / "x.csv").exists()


def test_corrupt_detections_file_raises_unavailable_from_iter_detections(
    tmp_path: Path, open_store: StoreFactory
) -> None:
    data_dir = write_fixture_dir(tmp_path)
    (data_dir / DETECTIONS_FILENAME).write_bytes(b"this is not a parquet file")
    store = open_store(data_dir)
    with pytest.raises(DataUnavailableError):
        next(store.iter_detections(WHOLE_REGION, *ALL_DAYS))

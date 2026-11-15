"""DuckDB access layer over the delivered Parquet files.

The grid is loaded once into dense NumPy arrays (`GridArrays`). Detections stay on disk and are
queried per request with bound `?` parameters, so DuckDB can push the date and bbox filters
down to Parquet row groups. No user input is ever interpolated into SQL.

Time convention: `acq_date_local` is the fixed UTC-8 local day; `acq_datetime_utc` is true UTC.
Detections here are filtered RAW detections, not individually harmonized (data contract).
Missing or unreadable files leave the store "unavailable" instead of raising at construction.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator, Sequence
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any, Literal

import duckdb
import pyarrow as pa

from hotspots.config import AppConfig
from hotspots.data.grid import GRID_COLUMNS, GridArrays, GridDataError, build_grid_arrays
from hotspots.data.types import BBox, DataUnavailableError, YearMonth

logger = logging.getLogger(__name__)

DEFAULT_BATCH_ROWS = 50_000

_GRID_SQL = f"SELECT {', '.join(GRID_COLUMNS)} FROM read_parquet(?)"
_DET_WHERE = "acq_date_local BETWEEN ? AND ? AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?"
_DET_FROM = "FROM read_parquet(?)"
_SRC_PLACEHOLDER = "{src}"


class DataStore:
    """Read-only access to the grid and detections files.

    Construction never raises for missing or broken files. Check `available`, and read
    `unavailable_reason` for a message. Methods that need data raise `DataUnavailableError`.
    """

    def __init__(self, cfg: AppConfig) -> None:
        self._cfg = cfg
        self._grid_path: Path = cfg.grid_path
        self._det_path: Path = cfg.detections_path
        self._grid: GridArrays | None = None
        self._grid_error: str | None = None
        self._det_error: str | None = None
        # In-memory DuckDB used only to read Parquet; nothing is ever written.
        self._con = duckdb.connect(":memory:")

        self._load_grid()
        self._check_detections()

    # --- state -------------------------------------------------------------------------------

    @property
    def grid_available(self) -> bool:
        return self._grid is not None

    @property
    def detections_available(self) -> bool:
        return self._det_error is None

    @property
    def available(self) -> bool:
        """True when both delivered files were found and the grid loaded."""
        return self.grid_available and self.detections_available

    @property
    def unavailable_reason(self) -> str | None:
        """Why the store is unavailable, or None when it is available."""
        problems = [p for p in (self._grid_error, self._det_error) if p]
        return "; ".join(problems) if problems else None

    def close(self) -> None:
        """Close the DuckDB connection. The store is unusable afterwards."""
        self._con.close()

    # --- grid --------------------------------------------------------------------------------

    def grid(self) -> GridArrays:
        """The dense grid, loaded once at construction."""
        if self._grid is None:
            raise DataUnavailableError(self._grid_error or "grid not loaded")
        return self._grid

    def latest_month(self) -> YearMonth:
        """Latest month in the grid. It may be incomplete (provisional)."""
        grid = self.grid()
        return YearMonth.from_index(int(grid.month_index[-1]))

    def latest_complete_month(self) -> YearMonth:
        """Latest month that is not flagged incomplete."""
        grid = self.grid()
        complete = (~grid.incomplete).nonzero()[0]
        if complete.size == 0:
            raise DataUnavailableError("the grid has no complete month")
        return YearMonth.from_index(int(grid.month_index[int(complete[-1])]))

    # --- detections --------------------------------------------------------------------------

    def detections_latest_local_date(self) -> date:
        """Latest `acq_date_local` (fixed UTC-8 day) in the detections file."""
        value = self._scalar("SELECT max(acq_date_local) " + _DET_FROM)
        if not isinstance(value, date):
            raise DataUnavailableError("the detections file has no rows")
        return value

    def detections_latest_utc(self) -> datetime:
        """Latest `acq_datetime_utc` in the detections file, as a timezone-aware UTC datetime."""
        value = self._scalar("SELECT max(acq_datetime_utc) " + _DET_FROM)
        if not isinstance(value, datetime):
            raise DataUnavailableError("the detections file has no rows")
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)

    def count_detections(self, bbox: BBox, d0: date, d1: date) -> int:
        """Number of detections with `acq_date_local` in [d0, d1] inside the bbox (inclusive).

        This is the bbox pre-filter count. Polygon filtering happens in the caller.
        """
        sql = "SELECT count(*) " + _DET_FROM + " WHERE " + _DET_WHERE
        value = self._scalar(sql, _det_params(bbox, d0, d1))
        return int(value) if isinstance(value, int) else 0

    def iter_detections(
        self, bbox: BBox, d0: date, d1: date, batch: int = DEFAULT_BATCH_ROWS
    ) -> Iterator[pa.Table]:
        """Yield detections in [d0, d1] inside the bbox as Arrow tables of at most `batch` rows.

        All 16 delivered columns are returned, in file order (sorted by local date). Close the
        generator early and the underlying cursor is released.
        """
        if batch < 1:
            raise ValueError("batch must be at least 1")
        self._require_detections()
        cur = self._con.cursor()
        try:
            sql = "SELECT * " + _DET_FROM + " WHERE " + _DET_WHERE
            params = [str(self._det_path), *_det_params(bbox, d0, d1)]
            reader = cur.sql(sql, params=params).to_arrow_reader(batch)
            for record_batch in reader:
                yield pa.Table.from_batches([record_batch])
        except duckdb.Error as exc:
            raise DataUnavailableError(f"cannot read {self._det_path}: {exc}") from exc
        finally:
            cur.close()

    # --- contract checks ---------------------------------------------------------------------

    def raw_query(
        self,
        source: Literal["grid", "detections"],
        sql: str,
        params: Sequence[object] = (),
    ) -> list[tuple[Any, ...]]:
        """Run one read-only `SELECT` or `DESCRIBE` against a delivered file, unfiltered.

        Used only by the data-contract check (`hotspots.data.contract_queries`), which must see
        the files as delivered: no excluded cells and no pre-record months are dropped here.
        `sql` must contain the placeholder `{src}` exactly once, where a table is expected
        (for example `SELECT count(*) FROM {src} WHERE year = ?`). It is replaced by
        `read_parquet(?)` and the file path is bound as the first parameter. Every other value
        is passed in `params` and bound, never interpolated.
        """
        stripped = sql.strip()
        if not stripped.upper().startswith(("SELECT", "DESCRIBE")):
            raise ValueError("raw_query only runs SELECT or DESCRIBE statements")
        if ";" in stripped:
            raise ValueError("raw_query runs exactly one statement without a semicolon")
        if stripped.count(_SRC_PLACEHOLDER) != 1:
            raise ValueError(f"sql must contain {_SRC_PLACEHOLDER} exactly once")

        if source == "grid":
            path, error = self._grid_path, self._grid_error
        else:
            path, error = self._det_path, self._det_error
        if error is not None and not path.is_file():
            raise DataUnavailableError(error)

        resolved = stripped.replace(_SRC_PLACEHOLDER, "read_parquet(?)")
        cur = self._con.cursor()
        try:
            return cur.execute(resolved, [str(path), *params]).fetchall()
        except duckdb.Error as exc:
            raise DataUnavailableError(f"cannot read {path}: {exc}") from exc
        finally:
            cur.close()

    # --- internals ---------------------------------------------------------------------------

    def _load_grid(self) -> None:
        path = self._grid_path
        if not path.is_file():
            self._grid_error = f"grid file not found: {path}"
            logger.warning(self._grid_error)
            return
        try:
            table = self._con.sql(_GRID_SQL, params=[str(path)]).to_arrow_table()
            self._grid = build_grid_arrays(table, self._cfg.record_start, self._cfg.excluded_cells)
        except (duckdb.Error, GridDataError, KeyError) as exc:
            self._grid_error = f"cannot load grid file {path}: {exc}"
            logger.warning(self._grid_error)

    def _check_detections(self) -> None:
        if not self._det_path.is_file():
            self._det_error = f"detections file not found: {self._det_path}"
            logger.warning(self._det_error)

    def _require_detections(self) -> None:
        if self._det_error is not None:
            raise DataUnavailableError(self._det_error)

    def _scalar(self, sql: str, params: list[object] | None = None) -> object:
        """Run a one-row query against the detections file with bound parameters."""
        self._require_detections()
        cur = self._con.cursor()
        try:
            row = cur.execute(sql, [str(self._det_path), *(params or [])]).fetchone()
        except duckdb.Error as exc:
            raise DataUnavailableError(f"cannot read {self._det_path}: {exc}") from exc
        finally:
            cur.close()
        return row[0] if row else None


def _det_params(bbox: BBox, d0: date, d1: date) -> list[object]:
    """Parameters in the order of the `_DET_WHERE` placeholders."""
    return [d0, d1, bbox.south, bbox.north, bbox.west, bbox.east]

"""In-memory dense view of the sparse monthly grid.

`build_grid_arrays` is pure (no I/O). It takes the sparse rows of
`harmonized_monthly_grid.parquet` as an Arrow table and returns a `GridArrays` with one row per
cell and one column per month. A missing sparse row means zero cell-days (data contract).

Units: counts are MODIS-equivalent cell-days, `frp_sum` is MW, coordinates are EPSG:4326 degrees.
Days, months and years use fixed UTC-8. Cells are joined on `cell_id`, never on `disp_lat` or
`disp_lon` equality. `frp_mean` is not read at all.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Collection, Sequence
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt
import pyarrow as pa
import pyarrow.compute as pc

from hotspots.constants import CELL_SIZE_DEG
from hotspots.data.types import BASE_YEAR, YearMonth

GRID_COLUMNS: tuple[str, ...] = (
    "cell_id",
    "disp_lat",
    "disp_lon",
    "year",
    "month",
    "count_harmonized",
    "count_raw_modis",
    "count_raw_viirs",
    "frp_sum",
    "source_flag",
    "calib_model",
    "provenance",
    "incomplete",
)
"""Columns read from the grid file. `frp_mean` and `region_id` are deliberately absent."""

_HALF_CELL = CELL_SIZE_DEG / 2
_CENTRE_DECIMALS = 6


class GridDataError(ValueError):
    """The grid rows break the data contract (for example a duplicate cell and month)."""


@dataclass(frozen=True)
class GridArrays:
    """Dense grid. Axis 0 is the cell, axis 1 the month. Arrays are read-only.

    `month_index[j]` is months since 2000-01 and the months are contiguous, from the record
    start to the latest month in the file. A month with no rows has zeros in every matrix, and
    `None` for `source_flag`, `calib_model` and `provenance`.
    """

    cell_ids: list[str]
    centre_lat: npt.NDArray[np.float64]
    centre_lon: npt.NDArray[np.float64]
    month_index: npt.NDArray[np.int32]
    harm: npt.NDArray[np.float64]
    raw_modis: npt.NDArray[np.int32]
    raw_viirs: npt.NDArray[np.int32]
    frp_sum: npt.NDArray[np.float64]
    frp_known: npt.NDArray[np.bool_]
    """True where a sparse row exists and its `frp_sum` is not null. Lets callers return a null
    FRP total (not 0 MW) for an area and period with no FRP data."""
    incomplete: npt.NDArray[np.bool_]
    source_flag: list[str | None]
    calib_model: list[str | None]
    provenance: list[str | None]

    @property
    def n_cells(self) -> int:
        return len(self.cell_ids)

    @property
    def n_months(self) -> int:
        return int(self.month_index.shape[0])

    @property
    def months(self) -> list[YearMonth]:
        return [YearMonth.from_index(int(i)) for i in self.month_index]


def build_grid_arrays(
    table: pa.Table,
    record_start: str,
    excluded_cells: Collection[str] = (),
) -> GridArrays:
    """Build `GridArrays` from sparse grid rows.

    Rows of `excluded_cells` and months before `record_start` (`YYYY-MM`) are dropped. Raises
    `GridDataError` when no rows remain or when a cell and month appear twice.
    """
    start_idx = YearMonth.parse(record_start).index

    keep = pc.and_(
        pc.and_(pc.is_valid(table["cell_id"]), pc.is_valid(table["year"])),
        pc.is_valid(table["month"]),
    )
    if excluded_cells:
        keep = pc.and_(
            keep, pc.invert(pc.is_in(table["cell_id"], value_set=pa.array(list(excluded_cells))))
        )
    table = table.select(list(GRID_COLUMNS)).filter(keep)

    year = _np(table["year"], np.int64)
    month = _np(table["month"], np.int64)
    m_idx = year * 12 + month - 1 - BASE_YEAR * 12  # months since 2000-01
    in_record = m_idx >= start_idx
    if not in_record.all():
        table = table.filter(pa.array(in_record))
        m_idx = m_idx[in_record]
    if table.num_rows == 0:
        raise GridDataError("no grid rows remain after dropping excluded cells and early months")

    cell_arr = table["cell_id"].to_pylist()
    cell_ids_np, first_row, cell_pos = np.unique(
        np.asarray(cell_arr, dtype=object), return_index=True, return_inverse=True
    )
    cell_pos = cell_pos.reshape(-1)
    month_pos = m_idx - start_idx
    n_cells, n_months = len(cell_ids_np), int(month_pos.max()) + 1

    flat = cell_pos * n_months + month_pos
    if np.unique(flat).size != flat.size:
        raise GridDataError("duplicate (cell_id, year, month) rows in the grid file")

    harm = np.zeros((n_cells, n_months), dtype=np.float64)
    raw_modis = np.zeros((n_cells, n_months), dtype=np.int32)
    raw_viirs = np.zeros((n_cells, n_months), dtype=np.int32)
    frp = np.zeros((n_cells, n_months), dtype=np.float64)
    frp_known = np.zeros((n_cells, n_months), dtype=np.bool_)

    harm[cell_pos, month_pos] = _np(table["count_harmonized"], np.float64, fill=0.0)
    raw_modis[cell_pos, month_pos] = _np(table["count_raw_modis"], np.int32, fill=0)
    raw_viirs[cell_pos, month_pos] = _np(table["count_raw_viirs"], np.int32, fill=0)
    frp[cell_pos, month_pos] = _np(table["frp_sum"], np.float64, fill=0.0)
    frp_known[cell_pos, month_pos] = pc.is_valid(table["frp_sum"]).to_numpy(zero_copy_only=False)

    # Cell centres come from the first row of each cell (SW corner plus half a cell).
    disp_lat = _np(table["disp_lat"], np.float64)[first_row]
    disp_lon = _np(table["disp_lon"], np.float64)[first_row]
    centre_lat = np.round(disp_lat + _HALF_CELL, _CENTRE_DECIMALS)
    centre_lon = np.round(disp_lon + _HALF_CELL, _CENTRE_DECIMALS)

    incomplete = np.zeros(n_months, dtype=np.bool_)
    inc_rows = _np(table["incomplete"], np.bool_, fill=False)
    incomplete[month_pos[inc_rows]] = True

    source_flag = _majority(table["source_flag"].to_pylist(), month_pos, n_months)
    calib_model = _majority(table["calib_model"].to_pylist(), month_pos, n_months)
    provenance = _provenance_union(table["provenance"].to_pylist(), month_pos, n_months)

    for arr in (harm, raw_modis, raw_viirs, frp, frp_known, incomplete):
        arr.flags.writeable = False
    centre_lat.flags.writeable = False
    centre_lon.flags.writeable = False
    months = (start_idx + np.arange(n_months)).astype(np.int32)
    months.flags.writeable = False

    return GridArrays(
        cell_ids=[str(c) for c in cell_ids_np],
        centre_lat=centre_lat,
        centre_lon=centre_lon,
        month_index=months,
        harm=harm,
        raw_modis=raw_modis,
        raw_viirs=raw_viirs,
        frp_sum=frp,
        frp_known=frp_known,
        incomplete=incomplete,
        source_flag=source_flag,
        calib_model=calib_model,
        provenance=provenance,
    )


def _np(
    column: pa.ChunkedArray, dtype: type[np.generic], fill: float | bool | None = None
) -> npt.NDArray[np.generic]:
    """Arrow column to a NumPy array, replacing nulls by `fill` when given."""
    if fill is not None:
        column = pc.fill_null(column, pa.scalar(fill).cast(column.type))
    return np.asarray(column.to_numpy(zero_copy_only=False), dtype=dtype)


def _majority(
    values: Sequence[str | None], month_pos: npt.NDArray[np.int64], n_months: int
) -> list[str | None]:
    """Most common non-null value per month (ties go to the alphabetically first)."""
    counters: list[Counter[str]] = [Counter() for _ in range(n_months)]
    for value, pos in zip(values, month_pos.tolist(), strict=True):
        if value is not None:
            counters[pos][value] += 1
    out: list[str | None] = []
    for counter in counters:
        if not counter:
            out.append(None)
            continue
        top = max(counter.values())
        out.append(min(v for v, n in counter.items() if n == top))
    return out


def _provenance_union(
    values: Sequence[str | None], month_pos: npt.NDArray[np.int64], n_months: int
) -> list[str | None]:
    """Union of the `+`-joined satellite names over the rows of each month, sorted."""
    sets: list[set[str]] = [set() for _ in range(n_months)]
    for value, pos in zip(values, month_pos.tolist(), strict=True):
        if value:
            sets[pos].update(part for part in value.split("+") if part)
    return ["+".join(sorted(s)) if s else None for s in sets]

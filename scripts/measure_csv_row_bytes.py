"""One-off measurement of the average CSV bytes per data row (task 19.27).

Streams every row of `detections_harmonized.parquet` through the exporter's own row formatter
(`hotspots.export.hotspots_csv.format_row`) and prints the mean UTF-8 bytes per row, including
the line break. Read-only: it writes nothing. Paste the printed value into
`csv_avg_bytes_per_row` in `config/app.yaml` (DEFAULT (confirm)).

Usage: uv run python scripts/measure_csv_row_bytes.py [config-path]
"""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

from hotspots.config import load_config
from hotspots.data import DataStore
from hotspots.data.types import BBox
from hotspots.export import hotspots_csv

DEFAULT_CONFIG = Path(__file__).resolve().parents[1] / "config" / "app.yaml"
WORLD = BBox(west=-180.0, south=-90.0, east=180.0, north=90.0)


def main(argv: list[str]) -> int:
    path = Path(argv[1]) if len(argv) > 1 else DEFAULT_CONFIG
    config = load_config(path)
    if hasattr(config, "errors"):
        print(config, file=sys.stderr)
        return 1
    store = DataStore(config)  # type: ignore[arg-type]
    rows = 0
    total = 0
    try:
        for table in store.iter_detections(WORLD, date(1900, 1, 1), date(2200, 12, 31)):
            columns = [table.column(name).to_pylist() for name in hotspots_csv.COLUMNS]
            for values in zip(*columns, strict=True):
                total += len(hotspots_csv.format_row(values).encode("utf-8"))
                rows += 1
    finally:
        store.close()
    if rows == 0:
        print("no rows", file=sys.stderr)
        return 1
    print(f"rows={rows} total_bytes={total} avg_bytes_per_row={total / rows:.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

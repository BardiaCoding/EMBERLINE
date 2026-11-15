# Structure

## Status
Partly built. Exists now: `pyproject.toml`, `uv.lock`, `Makefile`, `.env.example`, `src/hotspots/{__init__,constants}.py`, `tests/conftest.py`, the `web/` scaffold (Vite, Tailwind, shadcn/ui, test setup in `web/src/test/`) and `outputs2.0/`. Everything else below is planned. Update this file when the layout changes.

## Layout
```
.
├── pyproject.toml, uv.lock     # Python project (API)
├── Dockerfile, Makefile, .env.example
├── config/                     # app config (YAML): data path, RECORD_START, EXCLUDED_CELLS, baseline, example areas, watch threshold
├── src/hotspots/               # Python package
│   ├── config.py               # config loading and validation
│   ├── data/                   # DuckDB access layer over the delivered Parquet files
│   ├── areastats.py            # cell selection, zero-filled series, baselines, anomalies (pure functions)
│   ├── stats.py                # watch level, season tracker, rankings (pure functions)
│   ├── constants.py            # CRS, CELL_SIZE_DEG, UNIT, TIME_CONVENTION
│   └── api/                    # FastAPI app (main.py, schemas)
│       └── routes/             # one router module per area (`<area>.py`), discovered automatically; later route tasks do not edit main.py
├── web/                        # React + TypeScript front end (Vite)
│   └── src/{components,features,lib,styles,test}/   # test/ = Vitest setup, msw server, axe typings
├── scripts/                    # developer and deployment helper scripts (no pipeline code)
├── tests/                      # pytest + Hypothesis
│   ├── conftest.py             # Hypothesis profiles (ci, dev), `delivered` marker
│   ├── fixtures.py             # writes synthetic Parquet files labelled "TEST FIXTURE, not NASA data"
│   ├── unit/, integration/
│   └── property/
│       └── strategies/         # Hypothesis generators, one module per area: config.py, grids.py, geometry.py, series.py
├── outputs2.0/                 # delivered data (gitignored; path from config)
└── docs/                       # methodology, limitations, submission material
```

## Rules
- The data pipeline is external and finished. Do not add acquisition, parsing, calibration or harmonization code.
- Read data only through the DuckDB access layer in `src/hotspots/data/`.
- Pure computation (area statistics, baselines, anomalies) has no I/O, so it can be property-tested.
- Statistics are computed at query time from the monthly grid, per `data-contract.md`.
- Front-end tests sit next to source files (`*.test.ts` or `*.test.tsx`).
- Tests use synthetic data from `tests/fixtures.py`, never the delivered files, except tests marked `delivered`. Fixture data is never shown in the app or docs as real values.
- New API routes go in `src/hotspots/api/routes/<area>.py`, not in `main.py`.
- `scripts/` holds helper scripts only (for example data-file fetch at deploy). No acquisition, calibration or harmonization code.
- Don't add top-level folders without reason.

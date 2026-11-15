# Implementation Plan: Harmonized Fire Calendar

## Overview

This plan matches the fixed data contract (`.kiro/steering/data-contract.md`) and the current `design.md`. The data pipeline (acquisition, parsing, filtering, mask, harmonization, validation, pipeline CLI, atomic publish) was built outside Kiro. Its tasks keep their ids and stay in the list, checked and marked "COMPLETED EXTERNALLY", with no work to do. The app only reads `harmonized_monthly_grid.parquet` and `detections_harmonized.parquet` through one DuckDB access layer.

Deadline: Sunday 15 November 2026, 23:59 local. Order of work:

1. Stage 0: completed externally (nothing to do).
2. Stage 1 (P0 minimal slice): config, data layer, area statistics, calendar API, Calendar UI, Docker and deploy.
3. Stage 2 (P0 completion): CSV estimate and export, charts, draw controls, example areas, accessibility, help text, updating state, methods page.
4. Stage 3 (P1): tap-to-select, watch badge, season tracker, recent tab, comparison, analytics download, URL share, then the BLOCKED interval task last.
5. Stage 5 (submission, protected time): do this before Stage 4.
6. Stage 4 (P2, only if time remains), then the future task.

Languages: Python 3.12 (API) and strict TypeScript (web), as in design.md and tech.md.

Conventions for every task:
- Python under `src/hotspots/`, tests under `tests/{unit,property,integration}/`, front-end tests next to source (`*.test.ts(x)`).
- Tests use synthetic Parquet files written by `tests/fixtures.py`, labelled "TEST FIXTURE, not NASA data". They never appear in the app or docs as real values. Tests need no network and no delivered data.
- Hypothesis generators sit in `tests/property/strategies/` (one module per area: `config.py`, `grids.py`, `geometry.py`, `series.py`). Property tests start with the comment `# Feature: harmonized-fire-calendar, Property N: <title>`, run at least 100 examples (Hypothesis profile `ci`, fast-check `numRuns: 100, seed: 2026`).
- Property tests marked required in the Notes are not starred. All other property tests are optional (starred).
- API routers live in `src/hotspots/api/routes/<area>.py`, discovered automatically (task 9.2), so later route tasks do not edit `main.py`.
- Units: cell-days (MODIS-equivalent) and MW; CRS EPSG:4326; time convention fixed UTC-8. Region label "California region". Read data only through `src/hotspots/data/`.

## Tasks

### Stage 0: completed externally (pipeline epics, no work)

- [x] 3. FIRMS acquisition: COMPLETED EXTERNALLY
  - [x] 3.1 Chunking and rate limiter: COMPLETED EXTERNALLY (no work)
    - _Requirements: 2.5, 2.11_
  - [x] 3.2 Property 3, chunking: COMPLETED EXTERNALLY (no work)
    - _Requirements: 2.11_
  - [x] 3.3 Property 4, rate limiter: COMPLETED EXTERNALLY (no work)
    - _Requirements: 2.5_
  - [x] 3.4 Download plan and archive import: COMPLETED EXTERNALLY (no work)
    - _Requirements: 2.1, 2.2, 2.10_
  - [x] 3.5 FIRMS client, provenance and acquisition runner: COMPLETED EXTERNALLY (no work)
    - _Requirements: 2.3, 2.4, 2.6, 2.7, 2.8, 2.12, 2.13, 2.14_
  - [x] 3.6 Property 2, download plan: COMPLETED EXTERNALLY (no work)
    - _Requirements: 2.1, 2.2, 2.10_
  - [x] 3.7 Property 6, acquisition idempotence: COMPLETED EXTERNALLY (no work)
    - _Requirements: 2.8, 2.12_
  - [x] 3.8 Acquisition error-path unit tests: COMPLETED EXTERNALLY (no work)
    - _Requirements: 2.4, 2.6, 2.12, 2.13, 2.14_

- [x] 4. Sensor-specific parsing: COMPLETED EXTERNALLY
  - [x] 4.1 Common Detection schema and helpers: COMPLETED EXTERNALLY (no work)
    - _Requirements: 3.3, 3.4, 3.5, 3.6, 3.7_
  - [x] 4.2 MODIS parser: COMPLETED EXTERNALLY (no work)
    - _Requirements: 3.1_
  - [x] 4.3 VIIRS parser: COMPLETED EXTERNALLY (no work)
    - _Requirements: 3.2_
  - [x] 4.4 Standard versus NRT merge: COMPLETED EXTERNALLY (no work)
    - _Requirements: 2.9_
  - [x] 4.5 Parser fixtures and example tests: COMPLETED EXTERNALLY (no work)
    - _Requirements: 3.1, 3.2, 3.5_
  - [x] 4.6 Property 7, Detection round trip: COMPLETED EXTERNALLY (no work)
    - _Requirements: 3.4_
  - [x] 4.7 Property 8, parser exclusions: COMPLETED EXTERNALLY (no work)
    - _Requirements: 3.3, 3.6, 3.7_
  - [x] 4.8 Property 9, Standard replaces NRT: COMPLETED EXTERNALLY (no work)
    - _Requirements: 2.9_

- [x] 5. Grid assignment and confidence filtering: COMPLETED EXTERNALLY
  - [x] 5.1 H3 grid assignment: COMPLETED EXTERNALLY (no work)
    - _Requirements: 5.2_
  - [x] 5.2 Filtering rules 1 to 4 and filter report: COMPLETED EXTERNALLY (no work)
    - _Requirements: 4.1, 4.2, 4.3, 4.6, 4.7, 4.8, 5.1, 5.6, 5.9_
  - [x] 5.3 Property 11, filter idempotence: COMPLETED EXTERNALLY (no work)
    - _Requirements: 4.4_
  - [x] 5.4 Property 12, filter conservation: COMPLETED EXTERNALLY (no work)
    - _Requirements: 4.3, 4.5, 4.8_
  - [x] 5.5 Property 14, filter report: COMPLETED EXTERNALLY (no work)
    - _Requirements: 4.7, 5.6_

- [x] 6. Harmonization (Aqua to S-NPP): COMPLETED EXTERNALLY
  - [x] 6.1 Contributing schedule: COMPLETED EXTERNALLY (no work)
    - _Requirements: 6.11, 6.12_
  - [x] 6.2 Ratio fitting and shrinkage: COMPLETED EXTERNALLY (no work, quantile mapping delivered instead)
    - _Requirements: 6.2, 6.4, 6.6_
  - [x] 6.3 Harmonized weights: COMPLETED EXTERNALLY (no work, no per-detection weights delivered)
    - _Requirements: 6.1, 6.8_
  - [x] 6.4 Property 15, ratio fitting: COMPLETED EXTERNALLY (no work)
    - _Requirements: 6.2, 6.4_
  - [x] 6.5 Property 16, bounded shrinkage: COMPLETED EXTERNALLY (no work)
    - _Requirements: 6.5_
  - [x] 6.6 Property 17, monotone shrinkage: COMPLETED EXTERNALLY (no work)
    - _Requirements: 6.7_

- [x] 14. Persistent hotspot mask and static-source filtering: COMPLETED EXTERNALLY
  - [x] 14.1 Mask and mask filter rule: COMPLETED EXTERNALLY (no work; 211-cell NRT mask already applied)
    - _Requirements: 5.2, 5.3, 5.4_
  - [x] 14.2 Property 13, mask classification: COMPLETED EXTERNALLY (no work)
    - _Requirements: 5.2, 5.7_
  - [x] 14.3 Property 10, filter rule oracle: COMPLETED EXTERNALLY (no work)
    - _Requirements: 4.1, 5.1_

- [x] 15. Terra chain, bootstrap and uncertainty: COMPLETED EXTERNALLY
  - [x] 15.1 Terra to Aqua chain: COMPLETED EXTERNALLY (no work)
    - _Requirements: 6.9, 6.10_
  - [x] 15.2 Bootstrap resampling: COMPLETED EXTERNALLY (no work, not delivered)
    - _Requirements: 7.1, 7.2_
  - [x] 15.3 Query-time uncertainty composition: COMPLETED EXTERNALLY (no work; app returns null bounds, see 28.12)
    - _Requirements: 7.3, 7.4_
  - [x] 15.4 Property 20, interval ordering: NOT APPLICABLE (bounds are null until 28.12)
    - _Requirements: 7.3_
  - [x] 15.5 Property 18, one contributing sensor: COMPLETED EXTERNALLY (no work)
    - _Requirements: 6.1, 6.11_

- [x] 16. Harmonization validation: COMPLETED EXTERNALLY
  - [x] 16.1 Validation metrics: COMPLETED EXTERNALLY (no work; numbers are in DATA_README, shown on the methods page by 19.7)
    - _Requirements: 8.1, 8.2, 8.3, 8.4_
  - [x] 16.2 Validation report: COMPLETED EXTERNALLY (no work)
    - _Requirements: 8.5, 8.7, 8.9_
  - [x] 16.3 Validation unit tests: COMPLETED EXTERNALLY (no work)
    - _Requirements: 8.3, 8.4_

### Stage 1: P0 minimal slice (config, data layer, area stats, calendar API, Calendar UI, deploy)

- [x] 1. Project setup
  - [x] 1.1 Create the Python project and repository hygiene files
    - `pyproject.toml` (Python 3.12, `uv`), runtime dependencies pinned: duckdb (version from DATA_README, 2.0.0, if installable, else record the version used), pyarrow, pandas, numpy, scipy, shapely, fastapi, uvicorn, pydantic, pyyaml, huggingface_hub; dev: pytest, hypothesis, ruff, pytest-socket, httpx (TestClient). No h3, no FIRMS client, no key. Generate `uv.lock`
    - `src/hotspots/__init__.py`, `src/hotspots/constants.py` (`CRS = "EPSG:4326"`, `CELL_SIZE_DEG = 0.1`, `UNIT = "cell-days (MODIS-equivalent)"`, `TIME_CONVENTION`)
    - `tests/conftest.py`: Hypothesis profiles `ci` (100 examples, derandomized) and `dev`; `pytest-socket` with `--disable-socket` (allow `127.0.0.1`); marker `delivered` for tests that read the real files (skipped when `outputs2.0/` is absent)
    - `.gitignore` covering `outputs2.0/`, `.env`, `node_modules`, `web/dist`, `.venv`; `.env.example` with `HOTSPOTS_CONFIG`, `HF_DATASET_REPO`, `HF_TOKEN` placeholders only; `Makefile` (install, test, lint, api, web-dev); ruff config
    - _Requirements: 29.1, 29.3, 29.8, 31.4, 31.5, 31.6_

  - [x] 1.2 Scaffold the front end in `web/`
    - Vite + React + strict TypeScript, Tailwind CSS and shadcn/ui, ESLint (rule forbidding raw hex colours outside `src/styles/tokens.css` and `palettes.ts`) and Prettier
    - Dependencies: maplibre-gl, terra-draw, terra-draw-maplibre-gl-adapter, echarts, @tanstack/react-query, zod; dev: vitest, fast-check, @testing-library/react, user-event, jsdom, msw, vitest-axe, openapi-typescript
    - `web/src/test/setup.ts` (`fc.configureGlobal({ numRuns: 100, seed: 2026 })`, msw server failing on unhandled requests); folders `web/src/{components,features,lib,styles}/`; scripts `dev`, `build`, `lint`, `test` (`vitest --run`), `gen:api`; commit `package-lock.json`
    - _Requirements: 26.2, 31.4, 31.5, 31.6_

  - [x] 1.3 Record dependencies and layout in the steering files
    - In `.kiro/steering/tech.md` add the libraries from 1.1 and 1.2 (pytest-socket, huggingface_hub, pyyaml, httpx for tests, zod, terra-draw adapter, msw, RTL, jsdom, vitest-axe, openapi-typescript) and update its Status line
    - In `.kiro/steering/structure.md` update Status and add `tests/property/strategies/`, `tests/fixtures.py`, `api/routes/`, `scripts/`
    - _Requirements: 33.6_

- [x] 2. App configuration and data access layer
  - [x] 2.1 Implement `hotspots.config` and `config/app.yaml`
    - `load_config(path) -> AppConfig | ConfigErrors` returning every `(field, reason)` at once: `data_dir`, `record_start` (`YYYY-MM`, default `2000-11`), `excluded_cells` (non-blank strings, default `["38.7000_-117.4000"]`), `baseline` (start `record_start`, `exclude_incomplete: true`), `watch_threshold` (0 < t < 100, default 90), `csv_avg_bytes_per_row`, extent (ordered, in range; measured 32.5, 42.2, -124.4, -114.0, DEFAULT (confirm)), both Parquet files exist in `data_dir`. No data file is opened before validation finishes. No hard-coded paths. Environment variable `HOTSPOTS_CONFIG` selects the file
    - `config/app.yaml` with these values and `region.name: "California region"`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8_

  - [x] 2.2 Write property test for configuration errors
    - **Property 1: Configuration reports every invalid field**
    - **Validates: Requirements 1.2, 1.5, 1.6, 1.8, 1.10**
    - Add `app_configs()` and `mutations()` to `tests/property/strategies/config.py`

  - [x] 2.3 Secrets module for MAP_KEY: COMPLETED EXTERNALLY (no work, this app has no FIRMS key; any secret comes from environment variables or an untracked `.env`)
    - _Requirements: 2.3, 2.4, 29.1, 29.2_

  - [x] 2.4 Property 5, MAP_KEY redaction: COMPLETED EXTERNALLY (no work, no key exists in this app)
    - _Requirements: 2.4, 29.2_

  - [x] 2.5 Write unit tests for configuration
    - Shipped `config/app.yaml` loads; defaults apply; missing data files reported with the path; all errors reported in one call
    - _Requirements: 1.3, 1.4, 1.8_

  - [x] 2.6 Add example-area parsing and validation to `hotspots.config`
    - Optional `example_areas` list: 3 to 5 entries, name 1 to 60 characters (not blank after trimming), description at most 160 code points, GeoJSON `Polygon` in EPSG:4326, closed non-self-intersecting ring with at least 4 positions, positive area, inside the extent (boundary counts as inside); one `(field, reason)` per bad entry naming its position (for example `example_areas[2].name`)
    - _Requirements: 1.9, 1.10_

  - [x] 2.7 Add the example areas to `config/app.yaml`
    - Four areas (names, qualitative descriptions, approximate polygons from the requirements), each commented `DEFAULT (confirm)` and "unverified"; unit test loads the file and asserts four valid areas
    - _Requirements: 1.11_

  - [x] 2.8 Implement the DuckDB data access layer in `src/hotspots/data/`
    - `DataStore(cfg)`: read-only DuckDB connection; loads `harmonized_monthly_grid.parquet` once into `GridArrays` (`cell_ids`, `centre_lat`/`centre_lon` = `disp_* + 0.05` rounded to 6 decimals, month index, dense `harm`, `raw_modis`, `raw_viirs`, `frp_sum` matrices built from the sparse rows with missing = 0; per-month `incomplete`, `source_flag`, `calib_model`, `provenance`). Join on `cell_id`, never on `disp_lat` or `disp_lon`. Drop `EXCLUDED_CELLS` and months before `RECORD_START` at load time
    - `latest_month()`, `latest_complete_month()`, `detections_latest_local_date()`, `detections_latest_utc()`, `count_detections(bbox, d0, d1)` and `iter_detections(bbox, d0, d1, batch=50_000)` using `WHERE acq_date_local BETWEEN ? AND ? AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?` (Parquet pushdown). All SQL uses bound `?` parameters. `frp_mean` is never read for area values; `frp_sum` is summed, null when no data
    - Missing files leave the store in an "unavailable" state (no crash)
    - _Requirements: 9.1, 9.8, 29.5_

  - [x] 2.9 Implement the data-contract check script
    - `src/hotspots/data/check.py`, run as `uv run python -m hotspots.data.check`: through the data layer, run `DESCRIBE` on both files and compare columns and types with the contract, check row counts (grid 89,467, detections 2,105,593), 5,370 cells, the measured extent, that October 2000 holds one day, that the excluded cell has one row with count 0, and that `frp_mean` is null in 4,697 rows; print pass or fail per check, exit non-zero on any mismatch
    - Also reachable as the `delivered`-marked pytest test
    - _Requirements: 9.8, 9.11_

  - [x] 2.10 Write the synthetic Parquet fixtures and generators
    - `tests/fixtures.py`: writes small grid and detections Parquet files with the contract schema into `tmp_path`, labelled "TEST FIXTURE, not NASA data" in names, docstrings and Parquet metadata; includes sparse rows, an incomplete latest month, October 2000, the excluded cell and `disp_lon` float noise
    - `tests/property/strategies/grids.py`: `grids()`, `year_months()`; `tests/property/strategies/series.py`: `count_series()` (zero-heavy and constant variants)
    - _Requirements: 31.2, 31.3_

  - [x] 2.11 Write unit tests for the data layer
    - Grid loads to the expected shapes; excluded cell and October 2000 never appear; joins ignore float noise in `disp_lon`; missing files give the unavailable state; detections pushdown returns only rows in the bbox and date range
    - _Requirements: 9.8, 29.5_

- [x] 7. Area statistics (pure functions, no I/O)
  - [x] 7.1 Precompute and period sums from detections: COMPLETED EXTERNALLY (no work; the delivered monthly grid replaces it, area sums are built by 7.3 to 7.6)
    - _Requirements: 9.1, 9.2, 9.4_

  - [x] 7.2 Write property test for temporal consistency
    - **Property 22: Temporal consistency and query determinism**
    - **Validates: Requirements 9.1, 9.4, 9.8, 9.9**

  - [x] 7.3 Implement cell selection with the half-open boundary rule in `hotspots/areastats.py`
    - `select_cells(centre_lat, centre_lon, polygon, excluded_mask) -> np.ndarray[bool]`: centre strictly inside selected, strictly outside not; centre exactly on an edge or vertex decided by the perturbed point `(lon + 1e-9, lat + 1e-12)` strictly inside (design section 8.1); vectorised with `shapely.contains_xy` on a prepared geometry; excluded cells never selected; depends only on the centre point
    - _Requirements: 9.3, 9.7_

  - [x] 7.4 Implement the zero-filled series
    - `zero_filled_series(harm, mask, months, complete, record_start)`: list in-record complete year-months (on or after `RECORD_START`, no incomplete month), LEFT JOIN area sums of `count_harmonized`, fill missing with 0.0; raw MODIS and raw VIIRS cell-days as two separate series (never added); `frp_sum` summed, null when no data; provisional month returned separately
    - _Requirements: 9.8, 9.11, 9.12, 15.18_

  - [x] 7.5 Implement baselines and anomalies
    - `Baseline(median, p10, p90, mean, std, n_years)` per calendar month over the zero-filled series (NumPy linear percentiles, `ddof=1`, null when n < 2), year-level baseline over complete years; `Anomaly(absolute, percent, percent_text, zscore, percentile_rank, baseline_start_year, baseline_end_year, n_years)`: percent null with text "no typical fires in this month" when median is 0, z-score null when std is 0, mid-rank `100 (L + 0.5 E) / N`, never infinity or NaN; provisional months get null anomaly fields
    - `validate_baseline_years(years, record)` (5 to 30 complete in-record years, message names the limit) for task 28.1
    - _Requirements: 10.1, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 10.12_

  - [x] 7.6 Implement the area result assembler
    - `compute_area_result(grid, polygon, start, end, baseline_years=None) -> AreaResult` returning `MonthRow`s (harmonized, raw_modis, raw_viirs, `frp_sum_mw`, `source_flag`, `calib_model`, `provenance`, `provisional`, `lower_bound=None`, `upper_bound=None`, `anomaly`), year rows, baseline per month and per year, coverage and `n_cells`; rounding only in the API serializer; empty selection gives all-zero months and notice `no_cells`
    - _Requirements: 9.1, 9.2, 9.4, 9.8, 15.18_

  - [x] 7.7 Write property test for the zero-filled series
    - **Property 56: Zero-filled area series**
    - **Validates: Requirements 9.8, 9.11, 9.12, 10.1**

  - [x] 7.8 Write property test for the boundary rule
    - **Property 57: Cell selection boundary rule**
    - **Validates: Requirements 9.7**
    - Add `polygons()` and `points_on()` to `tests/property/strategies/geometry.py`

- [x] 8. Pipeline command: COMPLETED EXTERNALLY (except the optional config round-trip test)
  - [x] 8.1 Pipeline CLI and stages: COMPLETED EXTERNALLY (no work)
    - _Requirements: 1.7, 30.3, 30.5_
  - [x] 8.2 Atomic publication tests: COMPLETED EXTERNALLY (no work)
    - _Requirements: 6.18, 30.6_
  - [x] 8.3 `region_meta.json` in the pipeline run: COMPLETED EXTERNALLY (no work; example areas come from `config/app.yaml`)
    - _Requirements: 1.12_
  - [x] 8.4 Write property test for example-area config round trip
    - **Property 53: Example-area config round trip and validation**
    - **Validates: Requirements 1.9, 1.10, 1.12**
    - Add `example_area()` to `tests/property/strategies/config.py`; compares config to the `/meta` response (needs 9.5)

- [x] 17. Selection geometry, selection cache and partition property
  - [x] 17.1 Implement `hotspots.geometry`
    - `validate_selection` (self-intersection, fewer than 3 distinct vertices, zero area, more than 1000 vertices, coordinate ranges, radius 1 to 500 km, outside the extent), `clip_to_extent` returning `clipped_percent`, `circle_polygon` (64 vertices, geodesic), `geodesic_area_km2`; generate `tests/fixtures/selection_vectors.json` for the front-end pre-check
    - _Requirements: 9.7, 12.1, 13.1, 13.2, 13.3, 13.4, 13.5, 19.5_

  - [x] 17.2 Implement the selection mask cache
    - `src/hotspots/selection.py`: LRU of 64 masks keyed by SHA-256 of the canonical geometry (coordinates rounded to 6 decimals); full-extent fast path; uses 7.3
    - _Requirements: 9.3, 28.1_

  - [x] 17.3 Property 19, harmonized count is a sum of weights: NOT APPLICABLE (no per-detection weights delivered)
    - _Requirements: 6.14, 9.1_

  - [x] 17.4 Write property test for the area partition
    - **Property 21: Area partition (spatial)**
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.7**
    - Add `rect_splits()` to `tests/property/strategies/geometry.py`

  - [x] 17.5 Write property test for selection validation
    - **Property 27: Selection validation reports the right reason**
    - **Validates: Requirements 11.7, 13.1, 13.2, 13.4, 13.5, 13.6, 29.4, 29.6**

  - [x] 17.6 Write property test for clipping
    - **Property 28: Clipping stays inside the extent and reports the removed share**
    - **Validates: Requirements 11.8, 13.3**

  - [x] 17.7 Property 41, pipeline determinism: COMPLETED EXTERNALLY (query determinism is covered by Property 22 in task 7.2)
    - _Requirements: 7.7, 9.9, 30.4_

- [x] 9. API (health, meta, calendar)
  - [x] 9.1 Implement API schemas and error handling
    - `api/schemas.py`: pydantic v2 models with `extra="forbid"` for geometry, `QueryIn`, `MonthRow` (with `lower_bound`, `upper_bound` always null for now), `YearRow`, `Anomaly`, `BaselineRow`, `ErrorOut`, `MetaOut`, `CalendarOut`; geometry bodies capped at 6 MB and 1000 vertices
    - `api/errors.py`: handlers for 422 (field paths and reasons), 413, 503 `data_unavailable`, 500 `internal_error` with request id and no stack trace, path or secret; one error envelope
    - _Requirements: 13.6, 29.4, 29.7_

  - [x] 9.2 Implement app startup, health and meta
    - `api/main.py`: FastAPI app, routers auto-discovered from `api/routes/__init__.py` (`pkgutil`), static front end from `HOTSPOTS_STATIC_DIR` with SPA fallback, CORS disabled; on config errors print all and exit non-zero; on missing data keep running in the unavailable state
    - `GET /api/health` (`data_present`, `latest_month`; 503 when data is missing) and `GET /api/v1/meta` (region name "California region", measured extent, `record_start`, `first_date`, `latest_month`, `latest_month_incomplete`, `latest_complete_month`, `latest_detection_local_date`, `latest_detection_utc`, `time_convention`, `unit`, `watch_threshold`, `limitations` list, `bounds_available: false`)
    - _Requirements: 14.1, 30.3, 32.1, 32.4, 32.7_

  - [x] 9.3 Implement the calendar endpoint
    - `api/routes/calendar.py`: `POST /api/v1/calendar` (`geometry`, `start`, `end`, optional `baseline_years`): validate and clip, select cells, call `compute_area_result`, return `months[]`, `years[]`, `baseline_by_month[]`, `baseline_year`, `coverage`, `n_cells`, `notice`, `provisional_months`; round harmonized to 1 decimal and raw counts to integers only here; all user values bound as parameters
    - _Requirements: 9.1, 9.2, 9.6, 9.8, 15.1, 16.1, 29.5_

  - [x] 9.4 Write unit tests for the API
    - TestClient on synthetic fixtures: health with and without data (503), `/meta`, `/calendar` for the full extent and a polygon, 422 shapes, 500 envelope without trace, October 2000 and the excluded cell never appear, injection-style strings rejected
    - _Requirements: 29.5, 29.7, 32.4, 32.7_

  - [x] 9.5 Return example areas and the watch threshold in `/api/v1/meta`
    - `ExampleArea` model and `MetaOut.example_areas` read from the validated config (empty list when none), `watch_threshold` from config; unit test returns the four example areas from the shipped config
    - _Requirements: 1.12, 11.16_

- [x] 18. Statistics, anomaly properties and API results
  - [x] 18.1 Implement `hotspots.stats` (after the slice, Stage 2 timing)
    - Pure: top-10 months and top-10 years (descending, ties by earlier date, provisional month and year excluded), seasonal profile (median, p10, p90 per calendar month), record rank and percentile of the latest complete month, year-to-date versus median cumulative (briefing inputs)
    - _Requirements: 10.11, 16.3, 16.5, 23.1_

  - [x] 18.2 Write property test for baseline and anomaly formulas
    - **Property 23: Baseline and anomaly formulas**
    - **Validates: Requirements 10.1, 10.3, 10.6, 10.7, 10.8, 10.12**

  - [x] 18.3 Write property test for zero anomaly at the median
    - **Property 24: Anomaly is zero at the median**
    - **Validates: Requirements 10.4**

  - [x] 18.4 Write property test for monotone percentile rank
    - **Property 25: Percentile rank is monotone**
    - **Validates: Requirements 10.5**

  - [x] 18.5 Write property test for rankings (after the slice)
    - **Property 30: Rankings are ordered and complete**
    - **Validates: Requirements 16.5**

  - [x] 18.6 Implement the selection and stats endpoints (after the slice)
    - `api/routes/selection.py`: `POST /api/v1/selection/normalize` for `{geometry}` or `{bbox}` returning clipped geometry, `clipped_percent`, `n_cells`, `notice` or 422 with the reason (circle and GeoJSON are added in 23.1)
    - `api/routes/stats.py`: `POST /api/v1/stats` returning totals, raw MODIS and raw VIIRS cell-days (separate), current month and year versus baseline, rankings, seasonal profile, `briefing_inputs`, `watch: null` until 26.4
    - _Requirements: 9.1, 10.3, 13.6, 16.1, 16.2, 16.3, 16.5, 16.10, 29.4_

  - [x] 18.7 Write property test for summary consistency (after the slice)
    - **Property 31: Summary total equals the yearly sums**
    - **Validates: Requirements 16.10**

  - [x] 18.8 Write unit tests for statistics edge cases (after the slice)
    - Median 0 and std 0 cases, short records, ties in rankings, leap-year-free monthly logic
    - _Requirements: 10.6, 10.7, 10.9, 10.11_

  - [x] 18.9 Write property test for Date_Range independence (Stage 3 timing)
    - **Property 52: Baseline does not depend on the Date_Range**
    - **Validates: Requirements 14.11, 20.15**

  - [x] 18.10 Add the provisional flag to the API serializer
    - `api/serialize.py`: provisional month = grid `incomplete` flag (design G9); provisional months get null anomaly and are labelled in the response; never enter the baseline or rankings
    - _Requirements: 15.17, 15.18, 15.19_

  - [x] 18.11 Write property test for the provisional month flag
    - **Property 54: Provisional month flag**
    - **Validates: Requirements 15.18, 15.19**

- [x] 11. Minimal web app (Calendar UI)
  - [x] 11.1 Implement the API client layer
    - `lib/api.ts` typed fetch wrapper with `AbortSignal.timeout(30_000)` and error-envelope parsing; `lib/api.types.ts` from `npm run gen:api`; TanStack Query provider (`placeholderData: keepPreviousData`)
    - _Requirements: 26.5, 28.4, 28.5, 28.6_

  - [x] 11.2 Implement design tokens, palettes, formatting and the app shell
    - `styles/tokens.css` (shadcn variables, 4 px spacing, light and dark sets), `styles/palettes.ts` (cividis and blue-orange), `lib/format.ts` (counts to 1 decimal, percents, dates labelled "local standard time, UTC-8", units "cell-days (MODIS-equivalent)")
    - `AppShell` with header (product name, "California region", "Data to {latest month}" badge, Methods and Help links), control panel, map panel, results panel
    - _Requirements: 14.4, 26.1, 26.2, 30.2_

  - [x] 11.3 Implement date-range selection
    - `lib/dates.ts`: real-date validation, presets (this year, last 5 years, full record; last 7 and 30 days only for Recent and CSV), whole-month note for mid-month starts and ends; `DateRangePanel.tsx` with inline errors and previous results kept
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.6, 14.7, 14.12_

  - [x] 11.4 Write property test for date presets and validation
    - **Property 47: Date presets and validation**
    - **Validates: Requirements 14.2, 14.3, 14.7**

  - [x] 11.5 Implement the map view
    - `features/map/MapView.tsx`: MapLibre with an open style, outline of the measured extent (never the FIRMS request box), initial view fitted to the extent, full region as default selection, note "Results use the 0.1 degree cells whose centre lies inside your area"
    - _Requirements: 11.1, 11.4, 11.18_

  - [x] 11.6 Implement the Calendar counts view
    - `lib/binning.ts`: pure `buildCalendarModel(result, "counts")`: rows per year (newest first), 12 month columns, year total column, baseline median summary row, cell states `no_data` (hatched), `zero`, value; class 0 for zero and 7 type-7 quantile classes of non-zero values; provisional month has no colour class
    - `CalendarGrid.tsx` (HTML grid, cells at least 24 x 24 px), `CalendarLegend.tsx` (variable, unit, time convention, bin edges, hatch), `CalendarTable.tsx` (same values, Status column)
    - _Requirements: 15.1, 15.4, 15.6, 15.7, 15.8, 15.11, 15.12, 27.7_

  - [x] 11.7 Write property test for the Calendar grid shape
    - **Property 44: Calendar grid shape and no-data cells**
    - **Validates: Requirements 15.1, 15.6, 15.7, 15.12**
    - Add `fc.calendarResult()` to `web/src/test/arbitraries.ts`

  - [x] 11.8 Implement summary cards and result states
    - `SummaryCards.tsx` (total harmonized cell-days and raw MODIS and raw VIIRS cell-days, never added), `StatusAnnouncer.tsx`, loading indicator after 300 ms, empty-state message naming area and range, error card with Retry, full-page "Data not available" when health reports 503
    - _Requirements: 16.1, 16.9, 26.3, 26.4, 26.5, 27.8, 28.5, 32.7_

  - [x] 11.9 Implement the hotspot CSV download control (after the slice, Stage 2 timing)
    - `features/export/DownloadsMenu.tsx`: streamed download to `showSaveFilePicker` where available, else Blob; "Download incomplete" when the file does not end with `# rows:`; file name from the server header (the estimate dialog is 19.29)
    - _Requirements: 17.6, 17.8, 27.8_

  - [x] 11.10 Wire the minimal web app together
    - `App.tsx`: read and write `from` and `to` URL parameters with `history.replaceState`; build the calendar query for the full extent; connect date panel, map, cards, Calendar and legend
    - _Requirements: 14.5, 15.1, 16.8_

- [x] 12. Container image, data delivery and smoke check
  - [x] 12.1 Create the Docker build
    - Multi-stage `Dockerfile` (node build, Python 3.12 runtime with uv, non-root user, port 7860, `HOTSPOTS_*` environment variables), `.dockerignore` excluding `.env`, `outputs2.0/`, `node_modules`, `.git`; the image does not contain data files; Makefile targets `image` and `run-image`; the `stage-data` target is not built (it assumed a pipeline: COMPLETED EXTERNALLY)
    - `README.md` initial version (local run command, URL `http://localhost:7860`) with the Hugging Face Spaces YAML header (`app_port: 7860`)
    - _Requirements: 32.1, 32.2, 32.3, 32.6_

  - [x] 12.2 Implement the unauthenticated smoke check
    - `src/hotspots/smoke.py`, run as `uv run python -m hotspots.smoke <base_url>`: without cookies, check `/`, `/api/health` (ok within 1 s with latest month), `/api/v1/meta` and `POST /api/v1/calendar` for the full extent; print pass or fail per check, exit non-zero on failure
    - _Requirements: 32.4, 33.1, 33.9_

  - [x] 12.3 Implement data delivery from a Hugging Face dataset repo (DEFAULT (confirm))
    - `src/hotspots/bootstrap.py`: at container start, if the two Parquet files are missing from the config data path, download them from the dataset repo `HF_DATASET_REPO` with `huggingface_hub` and token `HF_TOKEN` (Space secret); verify with the checks from 2.9; fail with a clear message when the repo or token is missing; never log the token; entrypoint runs it before uvicorn
    - _Requirements: 29.1, 32.1_

- [x] 13. Checkpoint: Stage 1 slice
  - Ensure all tests pass, ask the user if questions arise.
  - Run `uv run pytest`, `cd web && npx vitest --run`, `uv run ruff check .`, `cd web && npm run lint`, `docker build -t hotspots .`, and `uv run python -m hotspots.data.check` against `outputs2.0/`. After the team deploys, run the smoke check against the deployed URL and record the result in `docs/submission/checklist.md`

### Stage 2: P0 completion

- [x] 10. Hotspot CSV export
  - [x] 10.1 Implement the hotspot CSV exporter and route
    - `export.py`: streaming generator over `iter_detections` batches, bbox pre-filter then point-in-polygon with the boundary rule (7.3), `acq_date_local` inclusive in the exact range; exactly the 16 contract columns in order; `#` header lines: query geometry, local date range and the line "local standard time, fixed UTC-8, no daylight saving; acq_datetime_utc is true UTC", generation time (UTC), source (NASA FIRMS MODIS and VIIRS active-fire detections, delivered data), filters already applied, "rows are filtered raw detections, not individually harmonized; harmonization applies only to monthly cell-day counts", "CSV rows are detections while Calendar counts are cell-days, so they do not reconcile", label "California region", FIRMS citation; empty fields for missing values; final `# rows: N` only for a complete file; `sanitize_filename`
    - `api/routes/export.py`: `POST /api/v1/export/hotspots` (`text/csv; charset=utf-8`, 422 `export_too_large` above 2,000,000 rows before any streaming)
    - _Requirements: 17.1, 17.2, 17.3, 17.7, 17.8, 18.3, 30.7_

  - [x] 10.2 Write property test for the hotspot CSV round trip
    - **Property 32: Hotspot CSV round trip**
    - **Validates: Requirements 17.1, 17.2, 17.4, 17.7**

  - [x] 10.3 Property 33, CSV weight sum: NOT APPLICABLE (no per-detection weights delivered)
    - _Requirements: 17.5_

- [x] 19. Web app P0 features
  - [x] 19.1 Implement area selection by drawing and coordinates
    - `lib/geometryPrecheck.ts` (vertex count, distinct vertices, ranges, self-intersection) and `features/area/`: Terra Draw rectangle, polygon and select modes; on finish pre-check then `/selection/normalize`; rejected shapes keep the previous area, results and input values; clipping notice; keyboard-accessible west/south/east/north inputs with inline errors; bounding-box readout to 5 decimals and "Copy GeoJSON"; error and Retry on failure
    - _Requirements: 11.2, 11.3, 11.7, 11.8, 11.9, 12.2, 12.4, 12.6, 13.1, 13.2, 13.3, 13.4, 13.7, 13.9, 27.5_

  - [x] 19.2 Write tests for the geometry pre-check
    - The pre-check never rejects a geometry accepted in `tests/fixtures/selection_vectors.json`
    - _Requirements: 13.6_

  - [x] 19.3 Implement the anomaly and month-to-month Calendar views
    - `lib/binning.ts`: anomaly view with 9 fixed percent bins (edges -75, -50, -25, -10, +10, +25, +50, +100, neutral `[-10, +10)`; median 0 goes to the top bin when count > 0, neutral when 0); difference view with 9 symmetric bins to the 95th percentile of absolute differences; difference `x[y,m] - x[y,m-1]` with January using the previous December, no-data when the previous month has no data; percent with median 0 shows "no typical fires in this month" plus absolute difference and percentile rank
    - View switcher, Radix tooltips on hover and focus (month, year, harmonized count, `source_flag`, `calib_model`, `provenance`, baseline median, absolute, percent, z-score, percentile rank, provisional state, interval line only when both bounds are non-null), `role="grid"` with roving tabindex, signed values as a second cue
    - _Requirements: 15.2, 15.3, 15.4, 15.5, 15.6, 15.11, 15.13, 27.2, 27.4_

  - [x] 19.4 Write property test for Calendar binning
    - **Property 45: Calendar binning is monotone and centred**
    - **Validates: Requirements 15.2, 15.11, 15.13, 19.4**

  - [x] 19.5 Write property test for month-to-month difference
    - **Property 46: Month-to-month difference**
    - **Validates: Requirements 15.3**

  - [x] 19.6 Implement key figures and charts
    - `components/ChartFrame.tsx` (title, unit subtitle, text summary, "View table" link, PNG and SVG menu slot, empty, error and loading states); ECharts (tree-shaken, lazy-loaded tabs): yearly bars with baseline median line and provisional year marked, seasonal profile (p10 to p90 band, median, selected year overlay), monthly anomaly series, top-10 month and year rankings as HTML lists; cards for current month and year versus baseline
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.8, 16.9, 27.2, 27.3, 28.2_

  - [x] 19.7 Implement the methods page
    - `features/methods/MethodsPage.tsx` at `/methods` (linked from the header on every view), rendering `docs/methodology.md` (Vite `?raw`; create a stub if missing, filled by 31.2) and a static section with the DATA_README numbers (statewide holdout RMSE 22.2, bias 0.8, seasonality correlation 0.989; 2009 to 2011 mean 383.7 versus 2012 to 2014 mean 366.3, -4.5 %; 96 of 98 regions with metrics; best model picked on the same holdout, so accuracy is slightly optimistic), the time convention, the cell-day unit, the filters already applied, and every known limitation from the data contract. No validation endpoint is built
    - _Requirements: 8.5, 26.8, 33.5_

  - [x] 19.8 Write accessibility tests
    - WCAG contrast for every token pair and palette swatch; CVD simulation (Machado matrices) with CIEDE2000 of at least 5 between adjacent classes; `vitest-axe` on the main views
    - _Requirements: 27.1, 27.3, 27.4_

  - [x] 19.9 Write component tests for the Calendar and result states
    - Keyboard navigation, tooltip content, table values equal grid values, Retry resends the same query, invalid input keeps the previous query
    - _Requirements: 13.9, 14.6, 15.5, 15.8, 26.5, 27.2_

  - [x] 19.10 Implement `DrawControls`
    - `features/area/DrawControls.tsx` in `AreaPanel`: three buttons "Draw rectangle", "Draw polygon", "Clear" (accessible name equals visible text, icons `aria-hidden`); draw buttons are toggles with `aria-pressed` and a check icon; Escape leaves drawing mode; "Clear" restores the full region, leaves drawing mode and updates the URL, stays focusable when already the region; shared 2 px focus ring
    - _Requirements: 11.10, 11.11, 11.12, 27.2_

  - [x] 19.11 Implement `DrawHint`
    - `features/area/DrawHint.tsx`: `role="note"` shown while the area is the full region and `sessionStorage["hfc.drawHint.closed"] !== "1"`; "Dismiss hint" button; closes when a shape is finished or an example area is chosen; never takes focus; storage access in `try/catch` with an in-memory fallback
    - _Requirements: 11.13_

  - [x] 19.12 Write tests for `DrawControls` and `DrawHint`
    - Names, roles, `aria-pressed`, Clear resets area and URL, Escape, hint show and close rules, `sessionStorage` throwing, no focus steal, `vitest-axe`
    - _Requirements: 11.10, 11.11, 11.12, 11.13_

  - [x] 19.13 Implement `ExampleAreas`
    - `features/area/ExampleAreas.tsx` rendered only from `/meta.example_areas`: buttons labelled with the name and `aria-describedby` to the description; a click uses the same path as a finished drawing (pre-check, normalize, URL write); renders nothing when `/meta` fails or the list is empty; no example name or geometry in front-end source
    - _Requirements: 11.14, 11.15, 11.16, 11.17_

  - [x] 19.14 Write tests for `ExampleAreas`
    - msw tests: buttons with names and descriptions, click sets selection and URL, rejection keeps the previous selection, empty list and failed `/meta` render nothing; lint-style test that greps `web/src` for the default example names
    - _Requirements: 11.14, 11.15, 11.16, 11.17_

  - [x] 19.15 Implement `defaultDateRange`
    - `lib/dates.ts`: pure `defaultDateRange(first, latest)`: start = 1 January of (Y - 10) or `first` if later, end = `latest` (from the API, not the browser clock); used when the URL has no `from` and `to`
    - _Requirements: 14.8, 14.9, 14.10, 14.11_

  - [x] 19.16 Write property test for the default date range
    - **Property 51: Default Date_Range**
    - **Validates: Requirements 14.8, 14.9**

  - [x] 19.17 Implement the sticky-header Calendar scroll area
    - `CalendarGrid.tsx`: `role="region"`, `aria-label="Burning activity calendar"`, `tabIndex=0`, `overflow: auto`; sticky month header and year column; row height 32 px; `min-height` of header plus 3 rows; newest year first; `ResultsPanel` sets `--results-above-calendar` from a `ResizeObserver`; at 1440 x 900 the cards and the first 3 year rows are visible without scrolling
    - _Requirements: 15.1, 26.10, 26.11_

  - [x] 19.18 Write example test for the Calendar layout
    - Structure assertions (region role, name, tabindex, sticky classes, row height, `--results-above-calendar` from a mocked `ResizeObserver`, newest year first); the real-browser check stays manual
    - _Requirements: 26.10, 26.11_

  - [x] 19.19 Add the relative-colours legend statement and bin edges
    - `CalendarModel.bins` carries the class edges for the counts view; `CalendarLegend.tsx` shows, in the counts view only, "Colours are set from the cells shown here only. They cannot be compared between different areas or date ranges." and each class's numeric edge range with unit "cell-days per month (MODIS-equivalent)"
    - _Requirements: 15.14, 15.15_

  - [x] 19.20 Write example test for the counts-view legend
    - Sentence present in counts view only; edges equal `model.bins` after `format.ts` rounding; edges change when the query changes; collapsed edges list no empty class
    - _Requirements: 15.14, 15.15_

  - [x] 19.21 Implement the Calendar markers
    - Distinct, colour-independent markers: whole-month (top-left triangle), latest month (2 px inset ring), provisional (bottom-right circle), plus the switchover marker at 2012-01; legend entries (provisional only while shown); tooltip lines; `CalendarTable` Status column; `latest` and `provisional` come from the API response, never the browser clock
    - _Requirements: 15.7, 15.12, 15.16, 15.17, 15.18_

  - [x] 19.22 Write component tests for the month status markers
    - Each state has its own marker, legend entry, tooltip line and table status word; all combine on one cell
    - _Requirements: 15.16, 15.17, 15.18_

  - [x] 19.23 Implement `helpText.json` and `InfoControl`
    - `web/src/lib/helpText.json` with six keys (`harmonized_count`, `uncertainty_interval`, `baseline_median`, `anomaly`, `z_score`, `percentile_rank`), one sentence of at most 30 words each (the harmonized count text says cell-days on the MODIS-equivalent scale); typed accessor; `components/InfoControl.tsx` (button `aria-label="About {term}"`, `aria-expanded`, Radix Popover on Enter or Space, Escape closes and restores focus); placed in `CalendarTable` column headers; tooltip shows the line "Select the cell for term help"
    - _Requirements: 15.20, 15.21, 15.22, 15.23_

  - [x] 19.24 Write completeness test and lint for help text
    - Every key exists with at most 30 words; no help sentence literal outside `helpText.json`; keyboard operation and accessible names
    - _Requirements: 15.21, 15.22, 15.23_

  - [x] 19.25 Implement the "Updating" and "Not updated" states
    - 300 ms timer on `isFetching && isPlaceholderData`; `data-updating="true"`, `aria-busy="true"`, solid "Updating" label at the top of the panel; dimming through scoped tokens (not `opacity`) at least 4.5:1; failure shows "Not updated" with the error card and Retry; `StatusAnnouncer` announces "Updating results" and "Results updated"
    - _Requirements: 28.5, 28.7, 28.8, 28.9, 28.10_

  - [x] 19.26 Write tests for the updating states
    - Fake timers, labels, dimming, `aria-busy`, failure and 30 s timeout paths; extend the contrast test (19.8) to the dimmed tokens
    - _Requirements: 28.5, 28.7, 28.8, 28.9, 28.10_

  - [x] 19.27 Implement the CSV estimate endpoint
    - `export.py`: `hotspot_rows_query` shared by the exporter and the estimate (same bbox, boundary rule and date filter, bound parameters); `estimate_export(query, limit=2_000_000)` returning `rows`, `approx_bytes = rows * csv_avg_bytes_per_row + header_bytes`, `over_limit`; `POST /api/v1/export/hotspots/estimate`; measure `csv_avg_bytes_per_row` once on `detections_harmonized.parquet` (script `scripts/measure_csv_row_bytes.py`) and record it in `config/app.yaml`
    - _Requirements: 17.6, 17.9, 17.10, 17.11, 17.13_

  - [x] 19.28 Write property test for the CSV estimate
    - **Property 55: CSV estimate row count equals exported row count**
    - **Validates: Requirements 17.1, 17.5, 17.9, 17.11, 17.12**

  - [x] 19.29 Implement the download confirmation dialog
    - `DownloadsMenu.tsx`: call the estimate first (`AbortSignal.timeout(30_000)`), dialog with rows and approximate size and "Download" and "Cancel"; nothing downloads before confirmation; over the limit shows the limit message and no download button; failure shows Retry and keeps the area
    - _Requirements: 17.9, 17.10, 17.11, 17.12, 17.13_

  - [x] 19.30 Write component tests for the confirmation dialog
    - Dialog text, Cancel sends no download, over-limit message, timeout and error paths with Retry, focus handling
    - _Requirements: 17.9, 17.10, 17.11, 17.12, 17.13_

- [x] 20. Integration test
  - [x] 20.1 Build the integration test on synthetic fixtures
    - `tests/integration/test_end_to_end.py`: `tests/fixtures.py` data into `tmp_path`, config pointing at it, TestClient `/meta`, `/calendar` (full extent and two split polygons agree within 1e-6), `/stats`, estimate and export (CSV ends with `# rows:` and its row count equals the estimate); second call returns identical results; labelled "TEST FIXTURE, not NASA data"
    - _Requirements: 30.4, 31.3, 31.6_

- [x] 21. Checkpoint: P0 complete
  - Ensure all tests pass, ask the user if questions arise.
  - Run both test commands and linters, check the Python tests finish within 10 minutes, rebuild the image and rerun the smoke check against the redeployed URL

### Stage 3: P1 features

- [x] 22. Day/night calibration and map layer
  - [x] 22.1 Day/night calibration: COMPLETED EXTERNALLY (no work)
    - _Requirements: 6.3, 6.8, 6.17_
  - [x] 22.2 Daily chart and uncertainty bands: DEFERRED (no daily harmonized series, bounds are null; no build task, see Notes)
    - _Requirements: 16.6, 16.7_
  - [x] 22.3 Implement the hotspot map layer
    - `api/routes/map.py`: `POST /api/v1/map-layer` returning raw filtered detections for the area and an optional month (points when at most 20,000, otherwise a 0.1 degree cell-day density from the grid), with `mode` and `total`; `MapView` layer labelled "raw detections, not harmonized" with a CVD-safe legend
    - _Requirements: 11.5_

- [x] 23. Coordinate, circle and file input
  - [x] 23.1 Implement circle and GeoJSON upload
    - `geometry.py` and `routes/selection.py`: `{circle}` (64-vertex geodesic polygon, radius 1 to 500 km) and `{geojson}` (union of polygon features, count of ignored features, 5 MB limit); `features/area/` circle form and upload with messages per failed condition and previous selection kept on rejection
    - _Requirements: 12.1, 12.3, 12.5, 12.7, 13.5, 13.8, 13.9_

  - [x] 23.2 Write property test for circle approximation
    - **Property 29: Circle approximation stays within 0.5 % of the radius**
    - **Validates: Requirements 12.1**

- [x] 24. Shareable URL state
  - [x] 24.1 Implement URL state encoding
    - `lib/urlState.ts`: pure `encodeState` and `decodeState` for all `AppState` parameters (`a`, `s`, `from`, `to`, `bl`, `v`, `cmp`, `a2`, `from2`, `to2`, `pa`, `y`, `ss`, `tab`, `cell`), geometry code (1e6 integers, delta, zigzag, varint, base64url), zod schemas with per-parameter fallback and a `rejected` list; `history.replaceState` debounced 200 ms; notice listing rejected parameters; replaces the simple handling in `App.tsx`
    - _Requirements: 14.5, 19.1, 19.2, 19.3, 19.8_

  - [x] 24.2 Write property test for URL round trip
    - **Property 42: URL state round trip**
    - **Validates: Requirements 14.5, 19.1, 19.2, 19.3**

  - [x] 24.3 Write property test for malformed URL parameters
    - **Property 43: URL decoding tolerates malformed parameters**
    - **Validates: Requirements 19.8**

  - [x] 24.4 Implement share links
    - `api/share.py` and `routes/share.py`: SQLite store at `HOTSPOTS_SHARE_DB`, id up to 16 characters from a hash of the canonical geometry, parameterized inserts, validation before storing, rate limit, 30-day retention, `GET /api/v1/share/{id}` with 404; client uses `s=` when the URL exceeds 2000 characters, else Douglas-Peucker simplification with the maximum displacement in metres
    - _Requirements: 19.6, 19.7, 19.8, 29.4_

- [x] 25. Analytics and chart downloads
  - [x] 25.1 Implement the analytics CSV
    - `POST /api/v1/export/analytics`: one row per month and per year in the range with harmonized count, raw MODIS and raw VIIRS (separate columns), baseline, anomaly columns, empty null bounds and a provisional flag, with the shared `#` metadata header
    - _Requirements: 18.1, 18.4, 18.5, 30.7_

  - [x] 25.2 Write property test for the analytics CSV
    - **Property 34: Analytics CSV matches the result**
    - **Validates: Requirements 18.1, 18.4, 18.5**

  - [x] 25.3 Implement chart PNG and SVG export
    - `lib/exportChart.ts`: offscreen ECharts with title, units, query description and citation; PNG at least 1600 px wide, SVG via the SSR renderer; Calendar export from `CalendarModel`; menu in `ChartFrame`; `lib/filenames.ts` matching Python `sanitize_filename`
    - _Requirements: 18.2, 18.3, 18.6, 30.7_

  - [x] 25.4 Write property test for export file names
    - **Property 35: Export file names are safe**
    - **Validates: Requirements 18.3**

- [x] 26. Watch badge and recent view
  - [x] 26.1 Implement the recent view
    - `api/recent.py` and `routes/recent.py`: `POST /api/v1/recent`, 7 local days ending on the latest local date in `detections_harmonized.parquet` (DEFAULT (confirm)), per-day raw detection counts (7 bars including zeros, labelled "raw, not harmonized"), points capped at 5,000 with the count omitted, `latest_utc`, `data_age_days`, and the monthly `watch` object; `features/recent/RecentTab.tsx` with 7 bars, map points, latest detection time, stale-data notice above 3 days, zero-state message, error after 10 s with the area kept
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6_

  - [x] 26.2 Implement `watch_level` (monthly)
    - `src/hotspots/stats/watch.py` (pure): for the latest complete month only; mid-rank percentile against the zero-filled baseline years of that calendar month; "Not available" with a reason when fewer than 5 baseline years or an empty series; "Above normal" when percentile is greater than `watch_threshold`, else "Within normal range"; the incomplete latest month returned beside it as provisional with its count to date and not evaluated; the 7-day watch is DEFERRED
    - _Requirements: 20.7, 20.8, 20.9, 20.13, 20.14, 20.15, 20.16_

  - [x] 26.3 Write property test for the watch level
    - **Property 49: Watch_Level matches the threshold and is monotone**
    - **Validates: Requirements 20.9, 20.13, 20.14, 20.15, 20.16**

  - [x] 26.4 Expose the watch result through the API
    - `watch` in `/stats` and `POST /api/v1/watch` (same object: `level`, `count`, `median`, `percentile`, `period`, `baseline_start`, `baseline_end`, `n_years`, `provisional`, `reason`, `threshold`), independent of the Date_Range; regenerate `lib/api.types.ts`
    - _Requirements: 20.1, 20.7, 20.8, 20.14, 20.15_

  - [x] 26.5 Implement `WatchBadge` and `formatWatchBadge`
    - `lib/watchBadge.ts` pure `formatWatchBadge(watch) -> {text, ariaLabel}` (level, count, baseline median, ordinal percentile, month, both baseline years; "provisional" label; "Not available" shows the reason only); `components/WatchBadge.tsx` with an icon and label in addition to colour; tokens `--watch-above` and `--watch-within` covered by the contrast and CVD tests
    - _Requirements: 20.10, 20.11, 20.12, 20.13, 20.14_

  - [x] 26.6 Place the watch badge in the recent view and summary cards
    - Badge in `RecentTab.tsx` and `SummaryCards.tsx` for the current area; every number on the badge equals the card and table value
    - _Requirements: 20.10, 20.15_

  - [x] 26.7 Write property test for the badge text
    - **Property 50: Watch badge text contains every required value**
    - **Validates: Requirements 20.11, 20.12, 20.14, 20.15**

- [x] 27. Season tracker (monthly)
  - [x] 27.1 Implement the season tracker
    - `stats.py`: cumulative sums at month-of-season 1 to 12 from the zero-filled series for each season year (start month configurable, default January), envelope (p10, median, p90) over season years entirely inside the baseline period, no envelope below 5 years, in-progress season stops at the latest complete month, percent of median null when median is 0; `routes/season.py` `POST /api/v1/season`; `features/season/SeasonTracker.tsx`. Timing metrics are DEFERRED
    - _Requirements: 21.1, 21.2, 21.3, 21.6, 21.7, 21.8, 21.10_

  - [x] 27.2 Write property test for cumulative curves
    - **Property 36: Cumulative season curves never decrease**
    - **Validates: Requirements 21.1, 21.4, 21.7**
    - Add a monthly `season_series()` to `strategies/series.py`

  - [x] 27.3 Write property test for envelope ordering
    - **Property 37: Season envelope ordering**
    - **Validates: Requirements 21.2, 21.5, 21.10**

  - [x] 27.4 Write property test for season total preservation
    - **Property 38: Season total is preserved**
    - **Validates: Requirements 21.8, 21.9**

- [x] 28. Remaining P1 items
  - [x] 28.1 Implement custom baseline period selection
    - `validate_baseline_years` (7.5) wired into `/calendar` and `/stats` (422 `invalid_baseline` naming the limit); `features/baseline/BaselinePanel.tsx` keeps the previous period on rejection
    - _Requirements: 10.2, 10.10_

  - [x] 28.2 Write property test for baseline period limits
    - **Property 26: Baseline period limits**
    - **Validates: Requirements 10.2, 10.10**

  - [x] 28.3 NOAA-20 gap fill: COMPLETED EXTERNALLY (no work)
    - _Requirements: 6.13_
  - [x] 28.4 Ratio drift test: COMPLETED EXTERNALLY (no work)
    - _Requirements: 8.6, 8.7_
  - [x] 28.5 Land polygon filter: COMPLETED EXTERNALLY (no work; no state-mask claim is made, design G2)
    - _Requirements: 5.5, 5.8_

  - [x] 28.6 Implement comparison mode
    - `features/compare/`: two areas or two date ranges side by side, one binning scale from the union of both panels, per-1000 km2 toggle using `geodesic_area_km2`, settings stored in the URL
    - _Requirements: 19.1, 19.4, 19.5_

  - [x] 28.7 Implement responsive layout and theme
    - One column below 768 px, no horizontal page scroll from 320 px to 2560 px and at 200 % zoom; theme from `prefers-color-scheme` with a saved control; map style follows the theme
    - _Requirements: 26.6, 26.7, 27.6_

  - [x] 28.8 Implement the month filter and switchover marker
    - Selecting a Calendar cell filters the map layer to that month; selecting again clears it; chip "Filtered to {Month} {Year}" with "Clear filter"; switchover marker (2012-01) kept in the legend
    - _Requirements: 15.9, 15.10_

  - [x] 28.9 Implement tap-to-select with one `selectCell` action
    - `useSelectCell` and `cell=YYYY-MM` in the URL state; Pointer Events (touch and pen select on `pointerup` without a drag beyond 8 px and show no hover tooltip; mouse hovers and clicks; Enter or Space selects; Escape clears)
    - _Requirements: 15.10, 15.24, 15.25, 15.27_

  - [x] 28.10 Implement the `DetailPanel`
    - `features/calendar/DetailPanel.tsx` with content from the shared `describeCell` (also used by the tooltip), the six `InfoControl`s, partial and provisional lines; non-modal `role="dialog"` with heading "{Month} {Year}", "Close details" button, no focus trap; beside the Calendar, bottom sheet under 768 px; focus and live-region rules from the design
    - _Requirements: 15.5, 15.21, 15.24, 15.25, 15.26, 15.27, 27.9_

  - [x] 28.11 Write tests for tap-to-select and the detail panel
    - Touch tap, click, drag threshold, re-select, close and Escape, text equals tooltip text, live-region messages, chip, `vitest-axe`
    - _Requirements: 15.24, 15.25, 15.26, 15.27, 27.9_

  - [x] 28.12 Fill `lower_bound` and `upper_bound` (BLOCKED, last P1 task)
    - BLOCKED until the data owner provides the calibration holdout-error file (`reports/phase2d_*.csv`, not delivered, design G7). Then: compute bounds from holdout error for calibrated (2012 onward) months only, leave native months null, set `bounds_available: true` in `/meta`, show the interval line in the Calendar tooltip and detail panel, and test that native months stay null. Until then the fields stay null and the interval line stays hidden
    - _Requirements: 7.1, 7.3, 7.4_
    - NOTE: marked complete without implementation (user decision). The holdout-error file was not delivered, so `lower_bound` and `upper_bound` stay null, `bounds_available` stays false, and the interval line stays hidden. Revisit if the data owner delivers the file.

- [x] 29. Checkpoint: P1 complete
  - Ensure all tests pass, ask the user if questions arise.
  - Run both test commands and linters, rebuild the image and rerun the smoke check on the redeployed URL

- [x] 35. Fix the two known xfail defects (post-P1 cleanup)
  - [x] 35.1 Fix the `hotspots.config` gap recorded in `tests/property/test_config_errors.py` and the `iter_detections` error translation recorded in `tests/unit/test_data_store.py`
    - Remove each strict xfail only after its test passes for the right reason; `iter_detections` raises `DataUnavailableError` (cause kept) on `duckdb.Error`; a failed CSV stream must not end with a `# rows:` line
    - _Requirements: 30.4_

### Stage 5: submission (P0, protected time; do this before Stage 4)

- [x] 31. Submission deliverables
  - [x] 31.1 Write the README
    - Purpose, features, setup (`uv sync`, `cd web && npm install`), where to put the delivered data (`outputs2.0/`, not in git), data check command, tests, deployment (deployed URL and local container run in 3 commands or fewer), region label "California region" (no state-boundary claim), the full known-limitations list from the data contract, links to the methodology
    - _Requirements: 30.5, 32.3, 33.1, 33.2_

  - [x] 31.2 Write the methodology document
    - `docs/methodology.md`: data source (FIRMS via the delivered files), counting unit (cell-day), fixed UTC-8, filters already applied, harmonization method summary (per-region quantile mapping of VIIRS to MODIS-equivalent, switchover 2012), validation numbers from DATA_README, query-time baselines and anomalies, limitations, deferred items, unverified facts
    - _Requirements: 26.8, 33.5_

  - [x] 31.3 Generate the NASA data and references list
    - `src/hotspots/references.py` (`uv run python -m hotspots.references`): writes `docs/submission/data_and_references.md` with the FIRMS MODIS and VIIRS products used (from `DATA_README.md`), citation, other references, and every pinned library from `uv.lock` and `web/package-lock.json`
    - _Requirements: 33.6_

  - [x] 31.4 Write the AI tool disclosure
    - `docs/submission/ai_disclosure.md` naming each AI tool used and what it was used for
    - _Requirements: 33.7_

  - [x] 31.5 Write the project summary and details text
    - `docs/submission/summary.md`: problem, solution, users, benefits, tools; note length limits to check on the live form (DEFAULT (confirm))
    - _Requirements: 33.4_

  - [x] 31.6 Write the demo materials
    - `docs/submission/slides.md` (at most 7 slides) and `docs/submission/video_script.md` (30 seconds or less)
    - _Requirements: 33.3_

  - [x] 31.7 Add the final submission checks
    - `tests/unit/test_repo_hygiene.py`: no tracked file under `outputs2.0/`, no tracked `.env`, no key-like strings outside `.env.example`, `.gitignore` and `.dockerignore` contain the required entries
    - `docs/submission/checklist.md`: one row per Req 33.1 to 33.7 item, the smoke check command against the deployed URL, a final logged-out browser check (open the deployed URL in a private window, draw an area, view the Calendar, download a CSV), and the fallback steps (fallback host or local run)
    - _Requirements: 29.3, 29.8, 33.1, 33.9, 33.10, 33.11_

- [x] 32. Final checkpoint: submission ready
  - Ensure all tests pass, ask the user if questions arise.
  - Run both test commands, both linters, `docker build`, `uv run python -m hotspots.smoke <deployed URL>`; fill in `docs/submission/checklist.md`; confirm the deadline time zone (Req 33.8, DEFAULT (confirm))

- [x] 36. Name the site
  - [x] 36.1 Apply the product name Emberline
    - Header (`PRODUCT_NAME`), page title, README title and Space title, API title, docs under `docs/submission/`; keep "California region" and all data wording unchanged
    - _Requirements: 33.1_
  - [x] 36.2 Fix the web build after the rename
    - Add the missing `PRODUCT_SHORT_NAME` import in App.test.tsx, AppShell.test.tsx and a11y.views.test.tsx; typecheck, lint and the build must pass
    - _Requirements: 33.1_

### Stage 4: P2 features (all optional, only if time remains)

- [ ] 30. P2 differentiators
  - [x] 30.1 (P2) Fire-season timing metrics: DEFERRED (no daily harmonized series; no build task, see Notes)
    - _Requirements: 22.1, 22.2, 22.3_
  - [x] 30.2 (P2) Property 39, season timing: DEFERRED (no build task)
    - _Requirements: 22.1_

  - [ ] 30.3 (P2) Implement the plain-language briefing
    - `features/briefing/briefing.ts`: pure `buildBriefing(result, season)` with fixed templates and `format.ts`, monthly statements only (no day-level claim); `BriefingCard.tsx` replaced on every query change
    - _Requirements: 23.1, 23.2, 23.3, 23.4, 23.5, 23.6, 23.7, 23.8_

  - [ ] 30.4 (P2) Write property test for briefing numbers
    - **Property 48: Briefing numbers match displayed values**
    - **Validates: Requirements 23.1, 23.2, 23.4, 23.5, 23.6**

  - [ ] 30.5 (P2) Implement sensor transparency (monthly raw series only)
    - `api/routes/sensors.py`: `POST /api/v1/sensors` returning the monthly raw MODIS and raw VIIRS cell-day series for the area, `source_flag`, `calib_model` and `provenance` per month (gaps where a sensor did not operate); `features/sensors/SensorsTab.tsx` with per-sensor lines and the 2012 switchover marker. No calibration ratio map, no filtered-sources layer, no filter counts (not delivered)
    - _Requirements: 24.1, 24.2, 24.3_

  - [x] 30.6 (P2) Property 40, per-query filter counts: NOT APPLICABLE (no excluded detections delivered)
    - _Requirements: 24.4, 24.5_

  - [ ] 30.7 (P2) Implement the situation brief
    - `features/brief/`: map snapshot, chart and Calendar images, cards, briefing, query description, time convention, citation and share URL composed into a one-page A4 PDF (jsPDF) and a PNG; 60 s timeout, no partial file on failure
    - _Requirements: 25.1, 25.2, 25.3, 25.4, 25.5_

  - [ ] 30.8 (P2) Implement named areas
    - Optional `named_areas` in `config/app.yaml` (GeoJSON), searchable combobox in `features/area/`
    - _Requirements: 11.6_

  - [ ] 30.9 (P2) Implement the first-visit guide
    - `features/help/`: 3-step dismissible guide, `localStorage` flag, reachable from the Help control
    - _Requirements: 26.9_

  - [x] 30.10 (P2) Scheduled NRT refresh: COMPLETED EXTERNALLY (pipeline refresh, no work)
    - _Requirements: 32.5, 32.8_

- [ ] 34. Future work (not P0 or P1, not a build blocker)
  - [ ] 34.1 (FUTURE) Cross-check against a regenerated zero-filled cell climatology
    - The data owner regenerates a zero-filled cell climatology (the delivered one skips years with no row). When that file exists: add a `delivered`-marked test comparing query-time baselines of single cells to it. The API stays query-time and does not read the file
    - _Requirements: 10.1_

## Notes

- Tasks marked `*` are optional. Required property tests (not starred, P0): Property 21 area partition (17.4), 22 temporal consistency (7.2), 24 anomaly zero (18.3), 25 monotone rank (18.4), 56 zero-filled series (7.7), 57 boundary rule (7.8), 54 provisional month (18.11), 51 default date range (19.16), 55 CSV estimate (19.28). All other property tests are optional. Properties 36, 37, 38 and 42 become required if their P1 feature ships.
- Property tests for pipeline code (Properties 2 to 20, 33, 39, 40, 41) are completed externally or not applicable (see design.md); they have no tests here.
- Completed-externally and deferred items are checked with a note and sit in wave 0; no work is needed.
- Deferred, no build tasks (not delivered data): daily harmonized counts and chart (22.2), season timing metrics (30.1, 30.2), 7-day watch level, filtered-sources layer and per-query filter counts (30.5 trimmed, 30.6), calibration ratio map.
- Uncertainty intervals: fields exist and are null; filling them is task 28.12, BLOCKED on the holdout-error file.
- Regenerating the zero-filled cell climatology is future work (34.1).
- Deployment to the host and recording the demo are team actions outside these coding tasks. The checkpoints run the smoke check after each deploy. Data reaches the host from a Hugging Face dataset repo at container start, DEFAULT (confirm).
- Tests use synthetic fixtures labelled "TEST FIXTURE, not NASA data". Never show fixture values as NASA data.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.3", "2.4", "3.1", "3.2", "3.3", "3.4", "3.5", "3.6", "3.7", "3.8", "4.1", "4.2", "4.3", "4.4", "4.5", "4.6", "4.7", "4.8", "5.1", "5.2", "5.3", "5.4", "5.5", "6.1", "6.2", "6.3", "6.4", "6.5", "6.6", "7.1", "8.1", "8.2", "8.3", "10.3", "14.1", "14.2", "14.3", "15.1", "15.2", "15.3", "15.4", "15.5", "16.1", "16.2", "16.3", "17.3", "17.7", "22.1", "22.2", "28.3", "28.4", "28.5", "30.1", "30.2", "30.6", "30.10"] },
    { "id": 1, "tasks": ["1.3", "2.1", "11.1", "11.2"] },
    { "id": 2, "tasks": ["2.6", "2.8", "2.10", "9.1", "11.3", "11.5", "11.6"] },
    { "id": 3, "tasks": ["2.2", "2.7", "2.9", "2.11", "7.3", "9.2", "11.4", "11.7", "11.8", "17.1"] },
    { "id": 4, "tasks": ["2.5", "7.4", "7.8", "9.5", "12.3", "17.2"] },
    { "id": 5, "tasks": ["7.5", "7.7", "8.4"] },
    { "id": 6, "tasks": ["7.6", "18.2", "18.3", "18.4"] },
    { "id": 7, "tasks": ["7.2", "17.4", "17.5", "17.6", "18.10"] },
    { "id": 8, "tasks": ["9.3", "18.11"] },
    { "id": 9, "tasks": ["9.4", "11.10", "12.2"] },
    { "id": 10, "tasks": ["10.1", "12.1", "18.1", "19.3", "19.7", "19.15", "19.23"] },
    { "id": 11, "tasks": ["10.2", "11.9", "18.5", "18.6", "18.8", "19.4", "19.5", "19.16", "19.17", "19.19", "19.24", "19.27"] },
    { "id": 12, "tasks": ["18.7", "19.1", "19.6", "19.18", "19.20", "19.21", "19.28", "19.29"] },
    { "id": 13, "tasks": ["19.2", "19.8", "19.9", "19.10", "19.13", "19.22", "19.25", "19.30", "20.1"] },
    { "id": 14, "tasks": ["19.11", "19.14", "19.26"] },
    { "id": 15, "tasks": ["19.12", "22.3", "23.1", "24.1", "25.1", "26.2", "27.1", "28.1", "28.7"] },
    { "id": 16, "tasks": ["23.2", "24.2", "24.3", "24.4", "25.2", "25.3", "26.3", "26.4", "27.2", "28.2", "28.8"] },
    { "id": 17, "tasks": ["18.9", "25.4", "26.1", "26.5", "27.3", "27.4", "28.9"] },
    { "id": 18, "tasks": ["26.6", "26.7", "28.6", "28.10"] },
    { "id": 19, "tasks": ["28.11", "28.12"] },
    { "id": 20, "tasks": ["31.1", "31.2", "31.3", "31.4", "31.5", "31.6"] },
    { "id": 21, "tasks": ["31.7"] },
    { "id": 22, "tasks": ["30.3", "30.5", "30.8", "30.9"] },
    { "id": 23, "tasks": ["30.4", "30.7"] },
    { "id": 24, "tasks": ["34.1"] }
  ]
}
```

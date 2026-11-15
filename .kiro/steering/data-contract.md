# Data Contract

Fixed data contract for the delivered pipeline outputs. The data pipeline was built outside Kiro. Do NOT implement acquisition, cleaning, calibration, harmonization or validation. Read `DATA_README.md` (in the outputs folder) in full before data work.

Project: Harmonized Fire Calendar, California only (NASA Space Apps 2026, MODIS and VIIRS Hot Spots).

Location note: the contract names the folder `data/outputs/`. The files were delivered at `outputs2.0/` in the project root. The data path comes from config (see rules); do not hard-code either.

## Region and extent
Label in the UI, API docs and README: "California region". Do not call it "California state".
- Actual data extent (measured with DuckDB on the delivered files): grid cells span lat 32.5 to 42.2 and lon -124.4 to -114.0 (SW corners plus 0.1 degree). Detections span lat 32.5 to 42.1 and lon -124.39 to -114.1.
- The addendum text said lat 32.5 to 42.3 and lon -124.4 to -113.9. The measured values above are one 0.1 degree cell smaller on the north and east edges. DEFAULT (confirm) use the measured values until the data owner says otherwise.
- The download request box (lat 32.0 to 42.5, lon -125.0 to -113.0) is NOT the data extent. Do not display it.
- Whether a state boundary mask was applied is unknown. DEFAULT (confirm): make no claim either way (do not say "clipped to the state" or "includes neighbouring areas") until the data owner confirms.

## Record
Effective record starts November 2000 (`RECORD_START = 2000-11`, config). October 2000 holds only one day (2000-10-31 local, one grid row) and must be excluded from the Calendar and all baselines. Record runs to 2026. MODIS-native counts for 2000 to 2011; calibrated VIIRS counts from 2012 onward. Reference scale is MODIS-equivalent. The latest month (currently 2026-11) is incomplete.

## Time convention
Days, months and years use local standard time at a fixed UTC-8 (PST, no daylight saving). `acq_datetime_utc` keeps the true UTC time. The UI, CSV headers and methodology must say this plainly.

## Counting unit
One cell-day = one 1 km cell with at least one kept detection on a local day, counted once per sensor family. Counts are cell-days, not raw detections.

## Files (all in the outputs folder)

1. `harmonized_monthly_grid.parquet` (89,467 rows, 5,370 cells). One row per display cell x year x month WITH activity. The grid is sparse (89,467 rows; a full grid would be about 1.69 million): a missing row means zero cell-days. `frp_mean` is null in 4,697 calibrated rows. `disp_lon` has floating-point noise (for example -114.10000000000001): join on `cell_id`, never on `disp_lat` or `disp_lon` equality.
   `cell_id` (str, "{lat}_{lon}" of the SW corner), `disp_lat`, `disp_lon` (double, 0.1 degree cell SW corner), `region_id` (str, 1.0 degree calibration region), `year` (int), `month` (int), `count_harmonized` (double, MODIS-equivalent cell-day count; THE calendar value), `count_raw_modis` (int), `count_raw_viirs` (int), `frp_sum` (double, MW), `frp_mean` (double), `source_flag` (str: native | calibrated), `calib_model` (str: quantile_map | ratio_month | log_regression | none), `provenance` (str, e.g. "Aqua+Terra" or "N20+N21+SNPP"), `incomplete` (bool, TRUE only for the latest partial month).
2. NOT USED. `climatology_cell_month.parquet` and `climatology_region_month.parquet`. Per cell (or region) x calendar month: `clim_median`, `clim_mean`, `clim_p10`, `clim_p90`, `n_years`. Baseline = full record, excluding incomplete months. Not used by the API: sparse-baseline issue (years with no row are skipped, not counted as zero), 120 rows with `clim_p10` above `clim_median`, 6 rows with `clim_median` above `clim_p90`, and missing region-month rows (1,089 of 1,176).
3. NOT USED. `anomaly_cell_month.parquet`. Per cell x year x month: `count_harmonized`, `clim_median`, `anomaly_abs` (value minus median), `anomaly_ratio` (value divided by median), `percentile_rank` (0 to 1, within that cell's same-month history). The file also has `source_flag` and `incomplete`, which are not in the original contract. Not used by the API.
4. `detections_harmonized.parquet` (2,105,593 rows). Standardized detection-level table, sorted by local date, for bbox and date-range CSV downloads. Columns: `sensor_family`, `satellite`, `source`, `lat`, `lon`, `acq_datetime_utc`, `acq_date_local`, `year`, `month`, `daynight`, `confidence_class` (low | nominal | high), `confidence_raw`, `frp`, `type`, `pixel_size_m`, `version`.
   IMPORTANT: this holds filtered RAW detections. They are not individually harmonized. Harmonization applies only to the monthly counts. Every CSV export header and the methodology page must say so.

## Filters already applied (do not reapply)
Low-confidence detections dropped. Only type 0 (vegetation or other fire) kept; volcano, other static land and offshore dropped. Near-real-time rows (which have no type column) were filtered with a static-cell mask (211 cells), which is approximate.

## Method summary (for the methodology page)
VIIRS counts are mapped to MODIS-equivalent using a transfer function fitted on the 2012+ overlap, per 1.0 degree region. Quantile mapping was chosen (statewide holdout RMSE 22.2, bias 0.8, seasonality correlation 0.989), with the best model per region and a statewide fallback for 13 data-poor regions. Source and calibration details are in `DATA_README.md`.

## Known limitations (must appear in the app and README)
- Calibration assumes the overlap period represents the earlier regime.
- Terra/Aqua overpass drift and VIIRS constellation changes may leave residual effects.
- Pre-2012 small fires are undercounted relative to the VIIRS era.
- Cloud and smoke reduce detections.
- Near-real-time filtering is approximate.
- The latest month is incomplete and must be marked provisional, never plotted as a full month.
- Small areas look noisy after 2012: quantile mapping can turn small counts into zero.
- Before Aqua started, only Terra provides coverage (check the `provenance` column).
- 96 of 98 regions have validation metrics.
- Validation picked each region's best model on the same holdout used to report errors, so reported accuracy is slightly optimistic.

## Deferred: Req 7 (uncertainty intervals)
Do not implement now. Include optional `lower_bound` and `upper_bound` fields, null for now, in the API response and Calendar tooltip, and hide the interval line when they are null. A task at the end of the P1 stage fills them from calibration holdout error. Intervals would apply only to calibrated (2012 onward) months.

## Configuration constants (app config, paths from config)
- `RECORD_START = 2000-11`.
- `EXCLUDED_CELLS = ["38.7000_-117.4000"]`: stray cell outside California with null climatology (one incomplete-month row, count 0). Apply in every query.
- `BASELINE_PERIOD`: full record from `RECORD_START`, excluding incomplete months (configurable).
- Data folder path (`outputs2.0/` today). The folder is in `.gitignore`.
- Pin the DuckDB version in the Python requirements (the check used 2.0.0, as in `DATA_README.md`).

## Area-level statistics (computed in the API with DuckDB at query time)
a. Select cells by centre point (`disp_lat + 0.05`, `disp_lon + 0.05`) inside the selection, excluding `EXCLUDED_CELLS`.
b. Build the list of in-record complete year-months (on or after `RECORD_START`, excluding incomplete months). LEFT JOIN the area sums of `count_harmonized` and fill missing with 0.
c. For each calendar month, the baseline median, p10, p90, mean, standard deviation and `n_years` come from that zero-filled series over the baseline period.
d. Anomaly fields: absolute difference, percent difference, z-score and percentile rank. When the baseline median is 0, percent difference is null and the UI shows "no typical fires in this month" plus the absolute difference and percentile rank. Never show infinity.
e. FRP: use `frp_sum` for area totals only. Never average `frp_mean` across cells. Return null where `frp_mean` is null; the UI shows a dash.

## Not available in the delivered data (do not invent)
- No daily harmonized counts. The harmonized grid is monthly only. Daily values exist only as raw filtered detections in `detections_harmonized.parquet`, which are not harmonized.
- No uncertainty intervals, no per-detection weights, no static-source mask file, no list of excluded detections, no calibration-holdout error file (`reports/phase2d_*.csv` are not delivered).

## Open items
- Req 7 intervals: DEFERRED (see above).
- Future task, not a build blocker: regenerate a zero-filled cell climatology.

## Rules for all future tasks
- Read data only through a DuckDB access layer. Paths come from config. Never commit data files, keys or Raw_Files to git.
- Never invent columns or values. If something is not in this contract, ask the user.
- Never present demo or fake numbers as NASA data.

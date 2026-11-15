# Requirements Document

## Introduction

This document specifies the Harmonized Fire Calendar, the NASA Space Apps Challenge 2026 entry for "MODIS and VIIRS Hot Spots". The system presents one consistent record of burning activity for the California region from November 2000 to the present, and presents that record in a web application built around a month × year burning activity calendar.

Target users are early warning and emergency responders, scientists, land managers and firefighters. They need to answer three questions for any area they choose: which periods of the year burn most, which years burned most, and how current activity compares with the historical median.

The data pipeline (acquisition, filtering, calibration, harmonization and validation) was built outside this project. Its outputs are the Delivered_Data, a fixed Data_Contract (`.kiro/steering/data-contract.md`, with method and validation numbers in `outputs2.0/DATA_README.md`). The app reads those files and implements none of those pipeline steps.

The system is one deployable application:
- An API that reads the Delivered_Data with DuckDB at query time and computes area statistics (cell selection, zero-filled series, baselines, anomalies).
- A Web_App that lets users select an area and dates, view the calendar and figures, and download data and charts.

### Priority legend

Each requirement carries a priority. The deadline is Sunday 15 November 2026, 11:59 PM local time.
- **P0**: must ship for a valid submission.
- **P1**: should ship.
- **P2**: differentiator or stretch goal.

Where a requirement is P0 overall, individual criteria may carry a lower priority tag in brackets, for example "[P1]".

### Defaults to confirm

Open decisions use a proposed default marked `DEFAULT (confirm)`. Work proceeds on the default until the team decides otherwise.

| Topic | Default |
|---|---|
| Region label and extent | "California region". Grid cells span latitude 32.5 to 42.2 and longitude −124.4 to −114.0 (EPSG:4326), measured on the Delivered_Data. The Data_Contract addendum text said 32.5 to 42.3 and −124.4 to −113.9; the measured values are used until the data owner says otherwise. The FIRMS download request box (latitude 32.0 to 42.5, longitude −125.0 to −113.0) is not the data extent and is not displayed. DEFAULT (confirm) |
| State boundary mask | Unknown whether one was applied. The app makes no claim either way and never says "California state". DEFAULT (confirm) |
| RECORD_START | 2000-11. October 2000 holds one day of data and is excluded from the Calendar and all baselines. DEFAULT (confirm) |
| EXCLUDED_CELLS | `["38.7000_-117.4000"]`, a stray cell outside California with null climatology, applied in every query. DEFAULT (confirm) |
| Baseline period | The full record from RECORD_START, excluding incomplete months, configurable. DEFAULT (confirm) |
| Statistics granularity | Months and years only. The harmonized grid is monthly and has no daily harmonized counts. DEFAULT (confirm) |
| Time convention | Days, months and years use local standard time at a fixed UTC-8 (PST, no daylight saving). `acq_datetime_utc` stays true UTC. |
| Counting unit | Cell-days (one 1 km cell with at least one kept detection on a local day, counted once per sensor family), not raw detections. |
| Provisional month | A month whose grid `incomplete` flag is true (currently 2026-11). The grid has no per-month flag for standard versus near-real-time data. DEFAULT (confirm) |
| Provisional month handling | The Provisional_Month is marked provisional, never plotted as a full month, excluded from baselines and not evaluated against baselines. DEFAULT (confirm) |
| Season year | Calendar year (January start), configurable start month. DEFAULT (confirm) |
| Season timing thresholds | Onset at 10 %, end at 90 % of the season total; peak as the centre of the highest 7-day rolling sum. DEFAULT (confirm) |
| Watch threshold | Percentile rank above 90 gives "Above normal" (see Requirement 1.8). DEFAULT (confirm) |
| Data delivery to the host | The Delivered_Data files stay out of git. How the files reach the host (copied into the image at build time, or mounted at run time from the configured data folder) is a design decision. DEFAULT (confirm) |
| Hosting | Hugging Face Spaces (Docker), fallback Render or Fly.io, fallback local container. DEFAULT (confirm) |
| Performance targets | See Requirement 28. DEFAULT (confirm) |
| Default Date_Range | The 10 full calendar years before the year of the latest available month, plus that year up to the latest available month. The full record from RECORD_START stays available as a preset. DEFAULT (confirm) |
| Calendar cell selection | Selecting a Calendar cell opens the detail panel and applies the month filter together, as one action (see Requirement 15.27). DEFAULT (confirm) |
| CSV size estimate | Rows × average bytes per row, shown as approximate (see Requirement 17.12). DEFAULT (confirm) |
| Session hint scope | The draw hint is remembered for the browser tab session only (see Requirement 11.13). DEFAULT (confirm) |

### Default example areas (Pilot_Region)

Four one-click example areas inside the California region, chosen for different fire settings. The polygons are approximate hand-drawn outlines in EPSG:4326 (longitude, latitude), each closed by repeating the first position. The descriptions are qualitative and unverified: no fire statistics are claimed, and the team should check them against the Delivered_Data before publication. DEFAULT (confirm)

| Name | Description (max 160 characters) | Approximate polygon |
|---|---|---|
| Central Valley farmland | Flat irrigated farmland. Burning here is expected to be mostly agricultural and other managed fires. | (−120.0, 35.3), (−118.9, 35.3), (−119.4, 36.3), (−120.3, 37.5), (−121.2, 37.5), (−120.4, 36.3), (−120.0, 35.3) |
| Sierra Nevada forest | Forested mountain range. Burning here is expected to be mostly wildfire, mainly in summer and autumn. | (−121.0, 39.6), (−120.0, 39.6), (−118.3, 36.2), (−119.2, 36.2), (−121.0, 39.6) |
| Southern California chaparral | Shrubland and foothills beside large cities. Burning here is expected to be mostly wildfire, often during autumn wind events. | (−118.9, 33.9), (−117.0, 33.7), (−116.8, 34.3), (−118.7, 34.5), (−118.9, 33.9) |
| North Coast and Klamath | Forested coastal and inland mountains. Burning here is expected to be mostly wildfire in summer, with a cooler, wetter coast. | (−124.1, 39.0), (−122.6, 39.0), (−122.6, 41.9), (−124.1, 41.9), (−124.1, 39.0) |

### Facts used and their sources

- The harmonization method is per-region quantile mapping of VIIRS counts to MODIS-equivalent, fitted on the 2012 onward overlap per 1.0 degree Calibration_Region. Quantile mapping was chosen on a statewide holdout with RMSE 22.2, bias 0.8 and seasonality correlation 0.989, against RMSE 91.0 (ratio_month) and 102.3 (log_regression). Thirteen data-poor regions use a statewide fallback. Source: `outputs2.0/DATA_README.md`, "Harmonization method".
- The harmonized series shows no step at the switchover: the 2009 to 2011 mean is 383.7 and the 2012 to 2014 mean is 366.3 (−4.5 %). Source: `outputs2.0/DATA_README.md`, "Validation".
- Per-region validation metrics exist for 96 of 98 regions. The best model per region was picked on the same holdout used to report errors, so reported accuracy is slightly optimistic. Source: `outputs2.0/DATA_README.md` and `data-contract.md`.
- Filters already applied in the Delivered_Data: low-confidence detections dropped, and only `type` 0 (vegetation or other fire) kept. Near-real-time rows have no `type` column and were filtered with an approximate static-cell mask of 211 cells. Source: `outputs2.0/DATA_README.md`.
- The Delivered_Data build date is 2026-11-14. Source: `outputs2.0/DATA_README.md`.
- Limitation context: planned end of Aqua MODIS science data around August 2026 and Terra around January 2027, with both orbits drifting ([LAADS transition document](https://ladsweb.modaps.eosdis.nasa.gov/learn/modis-to-viirs-transition/MODIS-VIIRS_Transition.pdf)).
- Unverified, check before relying on: the Space Apps submission form contents; whether a state boundary mask was applied to the Delivered_Data.

## Glossary

- **Data_Contract**: the fixed description of the Delivered_Data in `.kiro/steering/data-contract.md`, with method and validation details in `outputs2.0/DATA_README.md`. It is the authoritative source for files, columns, filters and limitations.
- **Delivered_Data**: the Parquet files produced by the external data pipeline and read by the API: `harmonized_monthly_grid.parquet` (the monthly grid) and `detections_harmonized.parquet` (raw filtered detections). The climatology and anomaly files in the same folder are not used. The files are not committed to git.
- **Processed_Data**: alias of Delivered_Data, kept so that later requirements that still use the older name remain readable.
- **Aggregator**: the API component that selects cells and sums grid values into counts by area and time period.
- **Statistics_Engine**: the API component that computes Baselines, Anomalies, Season_Metrics and rankings from aggregated counts.
- **API**: the HTTP service that answers Web_App queries by reading the Delivered_Data with DuckDB.
- **Web_App**: the browser application used by end users.
- **Calendar**: the Web_App view showing a month × year heatmap of burning activity.
- **Exporter**: the component that produces downloadable CSV, PNG, SVG and PDF files.
- **Briefing_Generator**: the component that produces plain-language summary sentences from statistics using fixed rules.
- **FIRMS**: NASA Fire Information for Resource Management System, the original source of the active-fire data in the Delivered_Data.
- **Region**: the covered area, labelled "California region", with the measured extent in Defaults to confirm. It is never called "California state".
- **Pilot_Region**: the California region, the only Region processed and deployed.
- **Cell_Day**: the counting unit. One Display_Cell with at least one kept detection on a local day, counted once per sensor family. All counts in the app are in Cell_Days, not raw detections.
- **Display_Cell**: a 0.1 degree grid cell (about 1 km detection cells aggregated for display) identified by `cell_id` ("{lat}_{lon}" of its south-west corner). Its centre point is (`disp_lat` + 0.05, `disp_lon` + 0.05). Cells are joined on `cell_id`, never on latitude or longitude equality.
- **Calibration_Region**: a 1.0 degree region (`region_id`) in which one VIIRS-to-MODIS-equivalent transfer function was fitted by the external pipeline.
- **MODIS_Equivalent_Scale**: the reference scale of `count_harmonized`. VIIRS counts from the Switchover_Month onward are mapped to the MODIS Cell_Day scale.
- **Switchover_Month**: 2012-01, the first month whose counts come from calibrated VIIRS (`source_flag` = calibrated). Earlier months are MODIS native.
- **Sensor**: a sensor family in the Delivered_Data: MODIS (Terra, Aqua) or VIIRS (S-NPP, NOAA-20, NOAA-21). The grid column `provenance` lists the satellites that contributed in a month, for example "Aqua+Terra" or "N20+N21+SNPP". Before Aqua started only Terra provides coverage.
- **Detection**: one raw filtered detection row of `detections_harmonized.parquet`. Detections are used only for CSV downloads and the recent activity view. They are not individually harmonized.
- **Record_Start**: the first month of the effective record, 2000-11 (`RECORD_START` in the app configuration).
- **Excluded_Cells**: the `cell_id` values removed from every query (`EXCLUDED_CELLS` in the app configuration), currently `38.7000_-117.4000`.
- **Zero_Filled_Series**: the series of area sums of `count_harmonized` for every in-record complete year-month, built by a LEFT JOIN of the area sums onto the list of year-months, where a missing grid row means zero Cell_Days and is filled with 0.
- **Provisional_Month**: a month whose grid `incomplete` flag is true. DEFAULT (confirm)
- **Harmonized_Series**: the Zero_Filled_Series of `count_harmonized` for a Selection_Area, on the MODIS_Equivalent_Scale.
- **Uncertainty_Interval**: an optional interval (`lower_bound`, `upper_bound`) around a harmonized count for calibrated months. DEFERRED: both fields are null for now (see Requirement 7).
- **Baseline**: per-calendar-month statistics (median, mean, sample standard deviation, 10th percentile, 90th percentile and `n_years`) of the Zero_Filled_Series over the Baseline_Period.
- **Baseline_Period**: the range of complete in-record months used to compute Baselines. The default is the full record from Record_Start, excluding incomplete months.
- **Anomaly**: the difference between an observed harmonized count and the Baseline, reported as absolute difference, percent difference, z-score and percentile rank.
- **Watch_Level**: a status computed from the percentile rank of a recent harmonized count against the Baseline for the same period, with one of three values: "Above normal", "Within normal range" or "Not available".
- **Season_Year**: a 12-month period starting at a configured month, used for season metrics and cumulative curves.
- **Season_Metrics**: per Season_Year values for onset date, peak date, end date and season length.
- **Season_Tracker**: a chart of the cumulative year-to-date harmonized count for a Season_Year against the historical percentile envelope of cumulative counts.
- **Selection_Area**: the area the user chose, as a polygon in EPSG:4326.
- **Date_Range**: the start and end date (inclusive, local standard time at fixed UTC-8) the user chose. Harmonized statistics include every month that overlaps the Date_Range, as whole months. DEFAULT (confirm)
- **Query**: one Selection_Area plus one Date_Range.
- **Validation_Report**: the methodology document in `docs/` that restates the validation results of `outputs2.0/DATA_README.md`.
- **Situation_Brief**: a one-page PDF or PNG summarising a Query for emergency managers.
- **Repository**: the public Git repository holding code, configuration, documentation and tests (data files excluded).
- **README**: the top-level documentation file of the Repository.
- **Test_Suite**: the automated Python and front-end tests in the Repository.
- **Build**: the process that produces the deployable container image.
- **Deployment**: the running instance of the container image on a host.
- **Submission**: the set of items handed in to Space Apps judging.
- **Team**: the project team members responsible for the Submission.
- **CVD_Safe_Palette**: a colour palette that stays distinguishable under common colour-vision deficiencies (protanopia, deuteranopia, tritanopia).
- **Example_Area**: a named area with a short description and a polygon geometry, defined in the app configuration and offered by the Web_App as a one-click Selection_Area.
- **Detail_Panel**: the Web_App panel opened by selecting a Calendar cell, holding the same content as the Calendar tooltip of Requirement 15.5.
- **Help_Text_File**: the single file that holds every plain-language help string of the Web_App for review and translation.
- **Latest_Month**: the most recent year-month in the monthly grid (currently 2026-11). It is the Provisional_Month while its `incomplete` flag is true.
- **Latest_Complete_Month**: the most recent year-month in the Zero_Filled_Series, that is, the latest month whose `incomplete` flag is false (currently 2026-10).
- **Recent_View**: the Web_App view of the filtered raw Detections of the last 7 local days (Requirement 20). Its values are raw, are not harmonized and are not comparable across sensors.

## Requirements

### Requirement 1: Region and application configuration (P0)

**User Story:** As a scientist, I want the data folder, record start, excluded cells, baseline, watch threshold and example areas in one configuration file, so that the app can be repointed or tuned without code changes.

#### Acceptance Criteria

1. WHEN the API starts, THE API SHALL read the app configuration from a YAML file in the `config/` folder. The file contains the Region name (1 to 100 characters, not blank after trimming whitespace), the Region extent (west, south, east, north, EPSG:4326), the data folder path, `RECORD_START`, `EXCLUDED_CELLS`, the Baseline_Period, the Watch_Level threshold and an optional `example_areas` list.
2. IF the app configuration file is missing a required field, has a data folder that does not contain `harmonized_monthly_grid.parquet` and `detections_harmonized.parquet`, has a `RECORD_START` that is not a valid year-month (YYYY-MM), has an `EXCLUDED_CELLS` entry that is not a non-blank string, has a Region extent with a longitude outside −180 to 180, a latitude outside −90 to 90, west not less than east or south not less than north, or has a Watch_Level threshold that is not greater than 0 and less than 100, THEN THE API SHALL stop starting and report every invalid field and its reason in a single run, with a non-zero exit status.
3. THE API SHALL ship with a configuration file for the Pilot_Region. That file names the Region "California region" and uses the measured extent listed in Defaults to confirm (latitude 32.5 to 42.2, longitude −124.4 to −114.0). DEFAULT (confirm)
4. THE API SHALL take the data folder path from the app configuration, with `outputs2.0` as the value in the shipped file. THE Repository SHALL list that folder in `.gitignore`, and no code SHALL hard-code a data path.
5. THE API SHALL take `RECORD_START` from the app configuration, with 2000-11 as the shipped value, and SHALL exclude every month before it from the Calendar and from all Baselines.
6. THE API SHALL take `EXCLUDED_CELLS` from the app configuration, with `["38.7000_-117.4000"]` as the shipped value, and SHALL exclude those `cell_id` values in every query.
7. THE API SHALL take the Baseline_Period from the app configuration. The shipped value is the full record from RECORD_START, excluding incomplete months. DEFAULT (confirm)
8. THE API SHALL take the Watch_Level threshold from the app configuration, with 90 as the shipped value. DEFAULT (confirm)
9. WHERE the app configuration contains an `example_areas` list, THE API SHALL read each entry as a name, a description and a GeoJSON Polygon geometry in EPSG:4326. A configuration file without `example_areas` is valid and defines no Example_Areas.
10. IF the `example_areas` list is present and has fewer than 3 or more than 5 entries, or an entry lacks a name, description or geometry, has a name that is not 1 to 60 characters (not blank after trimming whitespace), has a description longer than 160 characters, has a geometry with a ring of fewer than 4 positions, a ring whose first and last positions differ, a self-intersecting ring or zero area, has a longitude outside −180 to 180 or a latitude outside −90 to 90, or has a geometry that is not entirely inside the Region extent (a boundary position on the extent counts as inside), THEN THE API SHALL stop starting, report each invalid entry (by its position in the list), field and reason in a single run as in criterion 2, and exit with a non-zero status.
11. THE API SHALL include in the Pilot_Region configuration file the four Example_Areas listed in Default example areas (Pilot_Region). DEFAULT (confirm)
12. WHEN the API receives a request for the Region metadata, THE API SHALL return the name, description and geometry of each Example_Area from the loaded app configuration, without writing any metadata file. FOR ALL valid Example_Area lists, loading the configuration and then reading the API response SHALL return the same names, descriptions and geometries in the same order (round-trip property).

### Requirement 2: FIRMS data acquisition - completed externally (P0)

**User Story:** As a scientist, I want a scripted, documented download of all MODIS and VIIRS data for the Region, so that the dataset can be reproduced by anyone.

#### Acceptance Criteria

1. THE API SHALL treat the Delivered_Data files named in the Data_Contract as the fixed data source, and THE Repository SHALL contain no FIRMS download code and no FIRMS access key.
2. THE Web_App SHALL state in the methodology page that the data come from NASA FIRMS MODIS and VIIRS active-fire detections and that the acquisition was done outside this app, citing `outputs2.0/DATA_README.md`.

### Requirement 3: Sensor-specific parsing - completed externally (P0)

**User Story:** As a scientist, I want MODIS and VIIRS files parsed into one common Detection schema, so that downstream steps do not depend on file format.

#### Acceptance Criteria

1. THE API SHALL read the common detection schema of `detections_harmonized.parquet` as delivered in the Data_Contract, and THE Repository SHALL contain no MODIS or VIIRS file parsing code.
2. WHERE a CSV download of Detections is produced, THE Exporter SHALL use the column names of `detections_harmonized.parquet` as delivered.

### Requirement 4: Confidence filtering - completed externally (P0)

**User Story:** As a fire manager, I want low-confidence detections removed, so that counts reflect likely fires.

#### Acceptance Criteria

1. THE API SHALL treat the confidence filtering already applied in the Delivered_Data (low-confidence detections dropped) as fixed, and THE API SHALL NOT reapply or change that filter.
2. THE Web_App SHALL state in the methodology page and in every CSV export header that low-confidence detections were dropped before delivery.

### Requirement 5: Static thermal source filtering - completed externally (P0)

**User Story:** As a land manager, I want volcanoes, industrial sites and offshore flares removed, so that counts show burning activity only.

#### Acceptance Criteria

1. THE API SHALL treat the static-source filtering already applied in the Delivered_Data (only `type` 0 kept, and an approximate static-cell mask of 211 cells for near-real-time rows) as fixed, and THE API SHALL NOT reapply or change that filter.
2. THE Web_App SHALL state in the methodology page that near-real-time filtering is approximate because those rows have no `type` column.

### Requirement 6: Harmonization to a single scale - completed externally (P0)

**User Story:** As a scientist, I want MODIS and VIIRS detections put on one scale, so that the sensor of origin no longer affects counts and trends.

#### Acceptance Criteria

1. THE API SHALL use `count_harmonized` of the monthly grid, on the MODIS_Equivalent_Scale, as the calendar value, and THE API SHALL NOT implement, refit or re-derive the harmonization.
2. THE Web_App SHALL show, for each month in the Calendar tooltip and Detail_Panel, the `source_flag` (native or calibrated), the `calib_model` and the `provenance` of the Delivered_Data without changing them.
3. THE Web_App SHALL state in the methodology page that harmonization applies to monthly counts only, and that Detections in CSV downloads are filtered raw detections that are not individually harmonized.

### Requirement 7: Harmonization uncertainty - DEFERRED (P0)

**User Story:** As a scientist, I want uncertainty bounds on harmonized counts, so that I can judge how far to trust comparisons across the switchover.

#### Acceptance Criteria

1. THE API SHALL include optional `lower_bound` and `upper_bound` fields in every monthly count in its responses, with the value null for now.
2. THE Web_App SHALL include `lower_bound` and `upper_bound` in the Calendar tooltip data, and WHEN both fields are null, THE Web_App SHALL hide the interval line.
3. [P1] WHEN the task at the end of the P1 stage is completed, THE API SHALL fill `lower_bound` and `upper_bound` from the calibration holdout error for calibrated months (2012 onward) only, and SHALL keep them null for native months.
4. IF the calibration holdout-error file is not in the Delivered_Data, THEN THE Team SHALL obtain it from the data owner before criterion 3 is implemented. The file is not delivered today (`reports/phase2d_*.csv` are not delivered).

### Requirement 8: Harmonization validation - completed externally (P0)

**User Story:** As a scientist, I want harmonization quality measured and published, so that the method can be judged and trusted.

#### Acceptance Criteria

1. THE API SHALL treat the validation results in `outputs2.0/DATA_README.md` as fixed, and THE API SHALL NOT recompute validation metrics.
2. THE Validation_Report SHALL restate the validation numbers of `outputs2.0/DATA_README.md` (statewide holdout RMSE 22.2, bias 0.8, seasonality correlation 0.989; no step at the switchover, 2009 to 2011 mean 383.7 against 2012 to 2014 mean 366.3, −4.5 %; metrics for 96 of 98 regions) and the known limitations of the Data_Contract.
3. THE Validation_Report SHALL state that the best model per region was selected on the same holdout used to report errors, so the reported accuracy is slightly optimistic.

### Requirement 9: Aggregation (P0)

**User Story:** As a firefighter, I want counts for my area by month and year, so that I can see when burning occurred.

#### Acceptance Criteria

1. WHEN the API receives a Query, THE Aggregator SHALL return the sum of `count_harmonized` (Cell_Days on the MODIS_Equivalent_Scale) for the Selection_Area by month and by year, for every in-record complete month that overlaps the Date_Range, as whole months. The Aggregator SHALL read the monthly grid with DuckDB at query time.
2. THE Aggregator SHALL return, for each month and year, the sums of `count_raw_modis` and `count_raw_viirs` as two separate values and SHALL NOT add them together. A sensor family with no Cell_Days in that period SHALL be reported as 0.
3. FOR ALL partitions of a Selection_Area into non-overlapping parts, the sum of the parts' unrounded `count_harmonized` sums SHALL equal the unrounded sum of the whole Selection_Area within an absolute tolerance of 1e-6, and the sum of the parts' raw counts per sensor family SHALL equal the whole Selection_Area's raw count per sensor family exactly (partition property).
4. FOR ALL Queries, the sum of unrounded monthly `count_harmonized` sums SHALL equal the sum of unrounded yearly sums over the same months within an absolute tolerance of 1e-6. Raw counts per sensor family SHALL be equal exactly across both periods (temporal consistency property).
5. THE Aggregator SHALL use the grid columns `year` and `month` as delivered, which follow the fixed UTC-8 day convention (PST, no daylight saving), and THE Web_App, CSV headers and methodology page SHALL state this convention plainly.
6. THE Aggregator SHALL report `count_harmonized` sums as non-negative numbers rounded to one decimal place and raw counts as non-negative integers. Rounding SHALL happen only at output, after all sums are computed.
7. THE Aggregator SHALL select Display_Cells for a Selection_Area by testing the cell centre point (`disp_lat` + 0.05, `disp_lon` + 0.05, EPSG:4326) against the polygon, excluding the Excluded_Cells. A centre strictly inside the polygon is selected. A centre exactly on a polygon edge or vertex is handled by a deterministic half-open boundary rule, so that a centre on an edge shared by two non-overlapping adjacent parts is selected in exactly one part, and is selected in the whole Selection_Area only if it is selected in one of the parts. THE Aggregator SHALL join on `cell_id`, never on `disp_lat` or `disp_lon` equality.
8. THE Aggregator SHALL build the Zero_Filled_Series by taking the list of in-record complete year-months (on or after Record_Start, excluding months whose `incomplete` flag is true), LEFT JOINing the area sums onto it and filling missing sums with 0, because a missing grid row means zero Cell_Days. A month with no grid row inside the Selection_Area SHALL be returned with a harmonized count of 0.0 and raw counts of 0, not left out.
9. WHEN the API receives the same Query more than once against the same Delivered_Data, THE Aggregator SHALL return identical counts each time.
10. THE Aggregator SHALL return FRP for an area as the sum of `frp_sum` (MW) and SHALL NOT average `frp_mean` across cells. WHERE `frp_mean` is null, THE API SHALL return null, and THE Web_App SHALL show a dash.
11. WHEN a Query covers the Provisional_Month, THE Aggregator SHALL return that month with a provisional flag and SHALL keep it out of the Zero_Filled_Series used for Baselines.
12. WHEN no Display_Cell centre falls inside the Selection_Area, THE API SHALL return all-zero counts for the in-record complete months and a notice that the Selection_Area contains no cells.

### Requirement 10: Baselines and anomalies (P0)

**User Story:** As an emergency responder, I want current activity compared with the historical median, so that I can tell whether this season is unusual.

#### Acceptance Criteria

1. THE Statistics_Engine SHALL compute a Baseline for each calendar month from the Zero_Filled_Series over the Baseline_Period (default: the full record from Record_Start, excluding incomplete months). The Baseline contains the median, p10, p90, mean, sample standard deviation (divisor N − 1) and `n_years` (N, the number of years in the series for that calendar month). Percentiles use linear interpolation between closest ranks. DEFAULT (confirm)
2. WHERE the user selects a different Baseline_Period of at least 5 and at most 30 complete calendar years, all inside the in-record years, THE Statistics_Engine SHALL compute the Baseline over the selected years. [P1]
3. THE Statistics_Engine SHALL compute, for each complete month in the Date_Range, these measures of the month's harmonized count x against the Baseline for the same calendar month:
   - absolute Anomaly = x − median
   - percent Anomaly = 100 × (x − median) / median
   - z-score = (x − mean) / standard deviation
   - percentile rank = 100 × (L + 0.5 × E) / N, where L is the number of Baseline-year counts strictly less than x, E is the number equal to x, and N is the number of Baseline years (mid-rank definition, range 0 to 100)
4. FOR ALL Baselines, the absolute Anomaly of a count equal to the Baseline median SHALL be zero, and the percent Anomaly of that count SHALL be zero when the median is greater than zero (anomaly zero property).
5. FOR ALL calendar months and any two harmonized counts x1 < x2 compared against the same Baseline, the percentile rank of x2 SHALL be greater than or equal to the percentile rank of x1 (monotone rank property).
6. IF the Baseline standard deviation is zero, THEN THE Statistics_Engine SHALL report the z-score as not defined, and SHALL NOT report it as zero or infinity.
7. IF the Baseline median is zero, THEN THE Statistics_Engine SHALL return the percent Anomaly as null, and THE Web_App SHALL show the text "no typical fires in this month" together with the absolute Anomaly and the percentile rank. THE Statistics_Engine SHALL NOT report the percent Anomaly as zero or infinity, and SHALL still compute the absolute Anomaly, z-score and percentile rank.
8. THE Statistics_Engine SHALL compute the four Anomaly measures from criterion 3 for each complete calendar-year total in the Date_Range, against the distribution of calendar-year totals in the Baseline_Period.
9. WHEN the latest month is the Provisional_Month, THE Statistics_Engine SHALL return its count labelled provisional and SHALL NOT evaluate it against the Baseline, leaving its Anomaly fields null. The monthly grid holds no partial-month Baseline. DEFAULT (confirm)
10. IF the user selects a Baseline_Period with fewer than 5 complete years, more than 30 years, or years outside the in-record years, THEN THE Statistics_Engine SHALL reject the selection with an error message identifying the violated limit, and SHALL keep the previously active Baseline_Period. [P1]
11. WHEN a calendar year contains the Provisional_Month, THE Statistics_Engine SHALL label the year total provisional and SHALL NOT evaluate it against the Baseline_Period totals. DEFAULT (confirm)
12. THE Statistics_Engine SHALL return, with every Anomaly result, the first and last year of the Baseline_Period used and the number of Baseline years N.

### Requirement 11: Area selection on the map (P0)

**User Story:** As a land manager, I want to draw my area of interest on a map, so that I get statistics for exactly the land I manage.

#### Acceptance Criteria

1. WHEN the Web_App loads, THE Web_App SHALL display an interactive map that the user can pan and zoom, with the Region extent (the data extent in Defaults to confirm) drawn as an outline and the whole Region visible in the initial map view.
2. WHEN the user finishes drawing a rectangle or a polygon on the map that passes the validation rules of Requirement 13, THE Web_App SHALL replace any previous Selection_Area with the drawn shape, so that exactly one Selection_Area exists, and request results for the new Query within the response times set in Requirement 28.
3. WHEN the user finishes editing the vertices of the Selection_Area shape or deletes it, THE Web_App SHALL update the Selection_Area to the edited shape, or to the full Region after a delete, and refresh results within the response times set in Requirement 28.
4. WHEN the Web_App loads with no Selection_Area specified, THE Web_App SHALL use the full Region as the Selection_Area and show the Region as the current selection.
5. THE Web_App SHALL show on the map, as points or as a density layer, only the Delivered_Data Detections that fall inside the current Selection_Area and inside the Date_Range (exact local dates, local standard time, UTC-8). Points SHALL be coloured by satellite and the density layer by the number of Detections, using a CVD_Safe_Palette with a visible legend that states the Detections are filtered raw detections, not harmonized. [P1]
6. WHERE administrative or named areas are configured for the Region, THE Web_App SHALL let the user choose a named area (for example a county) as the Selection_Area. DEFAULT (confirm) California counties [P2]
7. IF a drawn or edited shape fails the validation rules of Requirement 13 (self-intersection, fewer than 3 distinct vertices, zero area, or more than 1000 vertices), THEN THE Web_App SHALL reject the shape, keep the previous Selection_Area and its results unchanged, and show a message giving the reason.
8. IF a drawn or edited shape lies partly outside the Region, THEN THE Web_App SHALL clip the Selection_Area to the Region extent and show a notice that it was clipped. IF the shape lies entirely outside the Region, THEN THE Web_App SHALL reject it, keep the previous Selection_Area, and show a message saying the area is outside coverage.
9. IF the API request for a new Selection_Area fails or does not respond within 30 seconds, THEN THE Web_App SHALL keep the drawn shape on the map, show an error message saying results could not be loaded, and offer a retry action. DEFAULT (confirm)
10. THE Web_App SHALL show three visible buttons next to the map, labelled "Draw rectangle", "Draw polygon" and "Clear". WHEN the user activates "Draw rectangle" or "Draw polygon", THE Web_App SHALL enter the matching drawing mode.
11. WHEN the user activates "Clear", THE Web_App SHALL return the Selection_Area to the full Region, remove any drawn shape from the map, leave drawing mode, update the page URL state in the same way as any other Selection_Area change, and refresh results within the response times set in Requirement 28.
12. THE Web_App SHALL give each button of criterion 10 an accessible name equal to its visible label, a visible focus indicator that meets Requirement 27.2, and an active state, exposed to assistive technology and shown with a cue other than colour alone, on the button of the current drawing mode.
13. WHEN the Web_App loads with no drawn Selection_Area and the hint has not been dismissed in the current browser tab session, THE Web_App SHALL show a hint next to the map that explains how to draw a rectangle, how to draw a polygon and how to clear the shape. THE hint SHALL have a dismiss control, SHALL close when the user completes a drawing, and SHALL not appear again in the same browser tab session after it has been dismissed or closed. The hint is separate from the first-visit guide of Requirement 26.9. DEFAULT (confirm)
14. WHERE the Region metadata contains Example_Areas, THE Web_App SHALL show each Example_Area as a one-click button in the control panel, labelled with its name and giving access to its description. THE Web_App SHALL show no Example_Area control where the Region metadata contains none.
15. WHEN the user activates an Example_Area button, THE Web_App SHALL set the Example_Area geometry as the Selection_Area in exactly the same way as a drawn shape: it SHALL apply the validation and clipping rules of Requirement 13, replace the previous Selection_Area, draw the shape on the map, store the Selection_Area in the page URL state, and request results within the response times set in Requirement 28. IF validation rejects the geometry, THEN THE Web_App SHALL follow Requirement 13.9.
16. THE API SHALL return the Example_Areas (name, description and GeoJSON geometry) of a Region in its Region metadata response, read from the app configuration (Requirement 1.9). THE Web_App SHALL take Example_Area names, descriptions and geometries only from that response, and SHALL contain no Example_Area name or geometry in its own source code, so that changing the app configuration file and restarting the API changes the offered Example_Areas without a front-end change.
17. IF the Region metadata request fails, THEN THE Web_App SHALL show no Example_Area control and keep drawing, coordinate entry and every other function available.
18. THE Web_App SHALL state next to the map that results for a Selection_Area use the Display_Cells whose centre point lies inside it (Requirement 9.7), so that a drawn shape is matched to whole 0.1 degree cells and not to its exact outline.

### Requirement 12: Area selection by coordinates and file (P1)

**User Story:** As a scientist, I want to enter coordinates or upload a GeoJSON file, so that I can reproduce an exact study area.

#### Acceptance Criteria

1. WHEN the user enters a latitude, longitude and radius in kilometres and confirms the entry, THE Web_App SHALL set a circular Selection_Area centred on the point. The circle SHALL be approximated by a polygon of 64 vertices, and each vertex SHALL lie within 0.5 % of the given radius from the centre, measured as geodesic distance. DEFAULT (confirm) vertex count
2. WHEN the user enters west, south, east and north coordinates in decimal degrees and confirms the entry, THE Web_App SHALL set a rectangular Selection_Area with those bounds.
3. WHEN the user uploads a GeoJSON file of up to 5 MB whose content is a Polygon or MultiPolygon geometry, a Feature containing one, or a FeatureCollection containing at least one, THE Web_App SHALL read the coordinates as EPSG:4326 longitude and latitude, and SHALL set the union of all Polygon and MultiPolygon geometries in the file as the Selection_Area. If the file also contains other geometry types, THE Web_App SHALL ignore them and tell the user how many features it ignored. DEFAULT (confirm) size limit
4. THE Web_App SHALL show the bounding box of the current Selection_Area (west, south, east, north) in decimal degrees (EPSG:4326) to 5 decimal places. THE Web_App SHALL also provide a copy control that places the Selection_Area geometry on the clipboard as GeoJSON text.
5. IF an uploaded file is larger than 5 MB, is not valid JSON or GeoJSON, or contains no Polygon or MultiPolygon geometry, THEN THE Web_App SHALL reject the file, keep the previous Selection_Area unchanged, and show a message stating which of these conditions failed.
6. IF the entered south coordinate is greater than or equal to the north coordinate, or the west coordinate is greater than or equal to the east coordinate, THEN THE Web_App SHALL mark the invalid fields, keep the previous Selection_Area unchanged, and state that south must be less than north and west less than east.
7. WHEN a Selection_Area is produced by any input in this requirement, THE Web_App SHALL apply the validation rules of Requirement 13 (coordinate ranges, radius range, vertex limit, self-intersection, Region coverage and clipping) before setting it. IF validation rejects it, THEN THE Web_App SHALL keep the previous Selection_Area unchanged.
8. WHEN a Selection_Area produced by any input in this requirement contains no Display_Cell centre point, THE Web_App SHALL accept it and show the notice of Requirement 9.12 instead of rejecting it.

### Requirement 13: Selection validation (P0)

**User Story:** As any user, I want clear messages when my area is invalid, so that I can fix it quickly.

#### Acceptance Criteria

1. IF the Selection_Area polygon is self-intersecting, has fewer than 3 distinct vertices, or has zero area, THEN THE Web_App SHALL reject the Selection_Area and show a message naming which of these problems was found.
2. IF the Selection_Area lies entirely outside the Region extent, THEN THE Web_App SHALL reject the Selection_Area, show a message saying the area is outside the Region, and show the Region extent as west, south, east and north coordinates and as an outline on the map.
3. IF the Selection_Area lies partly outside the Region extent, THEN THE Web_App SHALL clip the Selection_Area to the Region extent, show the clipped Selection_Area on the map, and tell the user that clipping occurred and what percentage of the original area was removed.
4. IF the Selection_Area has more than 1000 vertices, counted across all rings and all parts of a MultiPolygon, THEN THE Web_App SHALL reject the Selection_Area and state the 1000-vertex limit and the submitted vertex count. DEFAULT (confirm)
5. IF entered coordinates are outside longitude −180 to 180 or latitude −90 to 90, or the radius is not between 1 and 500 km inclusive, THEN THE Web_App SHALL mark each invalid field and state its allowed range. DEFAULT (confirm) radius range
6. THE API SHALL apply the same validation rules as the Web_App (criteria 1, 2, 4, 5, 7 and 8) and the same clipping rule (criterion 3), and return an HTTP 422 response with a field-level message for invalid Queries.
7. IF the user enters a rectangle whose west value is greater than or equal to its east value, or whose south value is greater than or equal to its north value, THEN THE Web_App SHALL mark the inconsistent fields and state that west must be less than east and south must be less than north.
8. IF an uploaded GeoJSON file is larger than 5 MB, cannot be parsed as GeoJSON, or contains no Polygon or MultiPolygon geometry, THEN THE Web_App SHALL reject the file and show a message naming which of these reasons applies. DEFAULT (confirm) size limit
9. WHEN the Web_App rejects a Selection_Area or marks a field invalid, THE Web_App SHALL keep the previous valid Query and its displayed results unchanged, and keep the values the user entered in the input fields so they can be corrected.
10. THE Web_App and THE API SHALL test Region coverage and clipping against the Region extent of the app configuration (Defaults to confirm: latitude 32.5 to 42.2, longitude −124.4 to −114.0, EPSG:4326) and SHALL make no claim that the extent follows a state boundary. DEFAULT (confirm)

### Requirement 14: Date range selection (P0)

**User Story:** As a scientist, I want to choose the date range, so that I can focus on the period I study.

#### Acceptance Criteria

1. THE Web_App SHALL let the user choose a Date_Range by entering or picking a start date and an end date in YEAR-MONTH-DAY form (for example 2020-08-15), both inclusive, in local standard time at fixed UTC-8. Statistics work in whole months: every month that overlaps the Date_Range is included as a whole month. The available record starts on the first day of Record_Start and ends on the last day of the Latest_Month. The default Date_Range SHALL be the range defined in criterion 8. DEFAULT (confirm)
2. THE Web_App SHALL offer these preset ranges for the Calendar and statistics, each ending with the Latest_Month: this year (January of the Latest_Month's year onward), last 5 years (the 60 months ending with the Latest_Month) and full record (Record_Start onward). THE Web_App SHALL also offer the presets last 7 days (7 local dates inclusive) and last 30 days (30 local dates inclusive), each ending on the local date of the latest Detection in the Delivered_Data. The presets last 7 days and last 30 days SHALL apply only to the Recent_View and to the hotspot CSV (exact local dates), and SHALL NOT change the whole-month range of the Calendar and statistics. DEFAULT (confirm)
3. IF the start date is after the end date, or either date is outside the available record, or either date is not a real calendar date, THEN THE Web_App SHALL mark each invalid date field, state the first and latest dates of the available record, and send no Query to the API.
4. THE Web_App SHALL show all dates labelled "local standard time, UTC-8".
5. WHEN the user applies a valid Date_Range, THE Web_App SHALL update the Calendar, figures and download contents for the current Selection_Area to that Date_Range, and SHALL store the start and end dates in the page URL so that opening the URL restores the same Date_Range.
6. IF the user enters an invalid Date_Range, THEN THE Web_App SHALL keep showing the results of the last valid Date_Range until a valid Date_Range is applied.
7. IF a preset range would start before the first date of the available record, THEN THE Web_App SHALL set the start date to the first date of the available record.
8. WHEN the Web_App opens without a Date_Range in the page URL, THE Web_App SHALL compute the default Date_Range from the Latest_Month L reported by the API (not from the browser clock) and its year Y. The default SHALL start in January of year Y − 10 and end with L, so that it covers the 10 full calendar years Y − 10 to Y − 1 plus year Y up to L, counted in months. The last month of the default is the Provisional_Month while the Latest_Month is incomplete. DEFAULT (confirm)
9. IF the available record starts after January of year Y − 10, THEN THE Web_App SHALL start the default Date_Range on the first date of the available record, so that the default never starts before the record and a record shorter than 10 years produces a valid default.
10. THE Web_App SHALL keep the "full record" preset of criterion 2 available, so that the user can select the range from Record_Start to the Latest_Month in one action.
11. FOR ALL Date_Ranges, Selection_Areas and Baseline_Periods, the Baseline and the Anomaly of each month SHALL have the same values whatever Date_Range is selected, because the Baseline_Period of Requirement 10 is independent of the Date_Range (independence property).
12. WHEN a Date_Range starts or ends partway through a month, THE Web_App SHALL tell the user that statistics cover the whole of that month, and SHALL send the exact local dates unchanged to the Recent_View and the hotspot CSV.

### Requirement 15: Burning activity calendar (P0)

**User Story:** As a fire manager, I want a month × year calendar of burning activity, so that I can see at a glance which months and years burned most.

#### Acceptance Criteria

1. WHEN a Query is set, THE Calendar SHALL display a heatmap with the 12 calendar months (January to December) on one axis and every year from the first to the last year of the Date_Range on the other, with each cell inside the Date_Range coloured by the monthly Zero_Filled_Series value of `count_harmonized` (MODIS-equivalent Cell_Days) summed over the Selection_Area, and each cell outside the Date_Range shown with the no-data pattern defined in criterion 7.
2. THE Calendar SHALL offer a counts view using a sequential CVD_Safe_Palette (cividis, DEFAULT (confirm)) and an anomaly view using a diverging CVD_Safe_Palette (blue–orange, blue for below Baseline and orange for above, DEFAULT (confirm)), in which each cell is coloured by its percent-difference Anomaly from the Baseline median for that calendar month, and the neutral colour of the palette is assigned to the bin that contains zero Anomaly.
3. THE Calendar SHALL offer a month-to-month difference view in which each cell is coloured by its harmonized count minus the harmonized count of the previous calendar month (December of the previous year for January), using the diverging CVD_Safe_Palette of criterion 2, with the neutral colour assigned to the bin that contains zero, and the cell shown with the no-data pattern when the previous month has no data.
4. WHEN a view is active, THE Calendar SHALL display a legend stating the variable, the units (MODIS-equivalent Cell_Days per month, percent, or Cell_Days per month change), the time convention (local standard time, UTC-8), and the bin edges and colour of every colour class of that view.
5. WHEN the user hovers over or moves keyboard focus to a Calendar cell, THE Calendar SHALL show the month, the year, the harmonized count to one decimal place in Cell_Days, the `source_flag`, the `calib_model` and the `provenance` of that month, the Baseline median, and the Anomaly (absolute difference, percent difference, z-score and percentile rank). WHERE `lower_bound` and `upper_bound` are both non-null, THE Calendar SHALL also show the interval line, and WHEN both are null, THE Calendar SHALL hide the interval line (Requirement 7).
6. THE Calendar SHALL display the sum of the displayed monthly harmonized counts at the end of each year row, and a summary row with the Baseline median for each calendar month.
7. THE Calendar SHALL show months with no data available (before Record_Start, after the Latest_Month, or outside the Date_Range) with a hatched pattern explained in the legend, and SHALL colour months with a zero count using the lowest colour class of the active view, so the two cases are visually distinct.
8. THE Calendar SHALL provide a data table alternative with one row per displayed month, containing the same year, month, harmonized count, `source_flag`, `calib_model`, `provenance`, `lower_bound`, `upper_bound` (empty when null), Baseline median, Anomaly and month-to-month difference values as the heatmap, at the same rounding.
9. THE Calendar SHALL mark the Switchover_Month (2012-01, where `source_flag` changes from native to calibrated) on the heatmap with a line or marker that is labelled in the legend. [P1]
10. WHEN the user selects a Calendar cell, THE Web_App SHALL filter the map Detections to that month, and WHEN the user selects the same cell again, THE Web_App SHALL clear that filter. [P1]
11. THE Calendar SHALL set colour classes from one scale per view across all cells of the displayed Calendar, excluding the Provisional_Month cell: in the counts view, one class for zero and 7 classes with edges at the quantiles of the non-zero monthly counts in the displayed Calendar; in the anomaly view, 9 fixed percent-difference bins with edges at −75, −50, −25, −10, +10, +25, +50 and +100 percent; in the month-to-month difference view, 9 equal-width bins symmetric around zero, with limits at ± the 95th percentile of the absolute differences in the displayed Calendar, and values beyond those limits placed in the end bins. DEFAULT (confirm)
12. IF the Date_Range starts or ends partway through a month, THEN THE Calendar SHALL show that month's count for the whole month (statistics work in whole months, Requirement 14.1) and SHALL mark the cell and its table row with a whole-month marker explained in the legend. A cell that is also the Provisional_Month keeps its provisional marker (criterion 17).
13. IF the Baseline median for a calendar month is zero, THEN THE Calendar SHALL show the percent-difference Anomaly for that month as undefined in the tooltip and data table, SHALL show in their place the text "no typical fires in this month" together with the absolute difference and the percentile rank, and SHALL never show infinity. In the anomaly view, THE Calendar SHALL place the cell in the highest bin when the count is above zero and in the bin containing zero when the count is zero.
14. WHILE the counts view is active, THE Calendar SHALL show in its legend a statement that the colour classes are set from the displayed Calendar only, so colours are not comparable between different Selection_Areas or Date_Ranges.
15. WHILE the counts view is active, THE Calendar SHALL show in its legend the numeric bin edges computed under criterion 11 for the displayed Calendar, with the unit and at the same rounding as the data table, and SHALL update them whenever the Query changes.
16. THE Calendar SHALL mark the Latest_Month when it lies inside the Date_Range with a marker that does not rely on colour alone (for example an outline and a text label), and SHALL explain the marker in the legend.
17. THE Calendar SHALL mark each Provisional_Month cell with a distinct cell marker that does not rely on colour alone (for example a corner mark or border style, different from the whole-month marker of criterion 12 and the latest-month marker of criterion 16), and SHALL add a "provisional" legend entry explaining it while at least one Provisional_Month is displayed. THE Calendar SHALL state in the tooltip, the Detail_Panel and the data table whether each month is provisional.
18. THE API SHALL return, for each month in the Calendar data, a provisional flag equal to the grid `incomplete` flag of that month, so that the Web_App does not infer it.
19. FOR ALL monthly grids, a month SHALL be provisional exactly when its `incomplete` flag is true, and a provisional month SHALL never appear in the Zero_Filled_Series used for Baselines (provisional-month property).
20. THE Calendar SHALL provide a one-sentence plain-language help text for each of these terms: harmonized count, uncertainty interval, baseline median, anomaly, z-score and percentile rank.
21. THE Web_App SHALL make each help text of criterion 20 available from an info control next to the term in the tooltip and the Detail_Panel, and from an info control in the matching column header of the data table. Each info control SHALL be reachable and operable by keyboard (Enter or Space opens the help text, Escape closes it), SHALL have an accessible name that includes the term, and SHALL show its help text without requiring pointer hover.
22. THE Web_App SHALL keep every help text of criterion 20 in the Help_Text_File and SHALL contain no help text elsewhere in its source, so that the strings can be reviewed and translated in one place.
23. THE Help_Text_File SHALL hold, for each help text, one sentence of at most 30 words that states only what the number means, consistent with the definitions of Requirement 10, and SHALL contain no advice, interpretation or claim about fire risk. The help text for the harmonized count SHALL state that the count is in Cell_Days (cells with at least one kept detection on a local day) on the MODIS-equivalent scale.
24. WHEN the user taps a Calendar cell on a touch device, THE Calendar SHALL select that cell and THE Web_App SHALL open the Detail_Panel for it, holding the same content as the tooltip of criterion 5 plus the provisional and whole-month states. [P1]
25. WHEN the Detail_Panel is open and the user taps the selected cell again or activates the Detail_Panel close button, THE Web_App SHALL close the Detail_Panel and clear the cell selection. [P1]
26. WHEN a Calendar cell has keyboard focus, THE Web_App SHALL open the Detail_Panel on Enter or Space and close it on Escape, returning keyboard focus to the cell. THE Web_App SHALL expose the Detail_Panel to assistive technology with an accessible name stating the month and year, and SHALL announce its opening and closing in the status live region of Requirement 27.8. [P1]
27. THE Web_App SHALL treat opening the Detail_Panel and the month filter of criterion 10 as one action: selecting a cell by tap, click or keyboard SHALL open the Detail_Panel and filter the map Detections to that month, and closing the Detail_Panel or selecting the same cell again SHALL clear both. WHILE the filter is active, THE Web_App SHALL show the filtered month as a label with a clear control next to the map. DEFAULT (confirm) [P1]
28. THE Calendar SHALL draw the Provisional_Month cell with the provisional marker of criterion 17 and no colour-class fill, SHALL show its count to date in the tooltip labelled provisional, and SHALL show no Anomaly for it, because the Provisional_Month is excluded from Baselines and is not evaluated against them. DEFAULT (confirm)

### Requirement 16: Key figures and charts (P0)

**User Story:** As an emergency responder, I want key numbers and simple charts, so that I can brief others without analysing raw data.

#### Acceptance Criteria

1. WHEN a Query is set, THE Web_App SHALL display summary cards with the following values, all in Cell_Days: total harmonized count over the Date_Range (MODIS-equivalent Cell_Days); raw MODIS Cell_Days and raw VIIRS Cell_Days as two separate labelled values that the Web_App never adds together; the harmonized count of the current month against the Baseline median for that calendar month; the current-year harmonized total against the Baseline yearly median; and the percentile rank (0 to 100) of the current-year total among Baseline_Period yearly totals. Here the current month and current year are the calendar month and calendar year that contain the end of the Date_Range. WHEN the current month is the Provisional_Month, THE Web_App SHALL show its count to date labelled provisional and SHALL show no Baseline comparison for it. THE Web_App SHALL label a year comparison as provisional if the year contains the Provisional_Month.
2. WHEN a Query is set, THE Web_App SHALL display a bar chart with one bar per calendar year in the Date_Range showing that year's harmonized total within the Selection_Area, and a horizontal reference line at the Baseline yearly median. A year that contains the Provisional_Month SHALL be marked provisional.
3. WHEN a Query is set, THE Web_App SHALL display a seasonal profile chart with 12 points (January to December) showing the Baseline median and the 10th to 90th percentile range of monthly harmonized counts, with the monthly harmonized counts of the selected year overlaid. The selected year defaults to the year containing the end of the Date_Range, and the user can change it to any year in the Date_Range.
4. WHEN a Query is set, THE Web_App SHALL display a monthly time series covering every month in the Date_Range. The series shows each month's absolute Anomaly against the Baseline mean and against the Baseline median for the same calendar month, as two distinguishable labelled series.
5. WHEN a Query is set, THE Web_App SHALL display a ranking of the top 10 months (year-month) and the top 10 years by harmonized count within the Query, in descending order of count. Ties are ordered by earlier date first, and fewer than 10 entries are listed if the Date_Range contains fewer than 10 months or years. The Provisional_Month and its year SHALL be left out of the rankings.
6. DEFERRED. THE Web_App SHALL show no daily harmonized count chart, because the Delivered_Data has no daily harmonized counts (the harmonized grid is monthly only). Daily values exist only as raw Detections, which are shown in the Recent_View of Requirement 20 and are not harmonized.
7. WHERE a chart includes calibrated months (2012 onward) and `lower_bound` and `upper_bound` are non-null, THE Web_App SHALL display those bounds as a shaded band or error bar, with a legend entry naming the interval. WHEN the bounds are null, THE Web_App SHALL draw no band. [P1] DEFAULT (confirm)
8. WHEN the user changes the Selection_Area, the Date_Range or the selected year, THE Web_App SHALL replace every summary card and chart value with values computed for the new Query. No value from the previous Query stays on screen once the new results have loaded.
9. IF a Query contains zero Cell_Days, THEN THE Web_App SHALL show 0 for the total harmonized count and for the raw MODIS and raw VIIRS Cell_Days, show the percent Anomaly as not defined where the Baseline median is zero, and show a message in each chart area stating that the area and period contain no detected burning activity, without showing an error.
10. FOR ALL Queries, the total harmonized count on the summary card SHALL equal the sum of the yearly bar values in criterion 2, within a tolerance of 0.01 after rounding for display (consistency property).

### Requirement 17: Hotspot CSV download (P0)

**User Story:** As a scientist, I want to download the detections behind my search, so that I can run my own analysis.

#### Acceptance Criteria

1. WHEN the user requests a hotspot download, THE Exporter SHALL produce a UTF-8 CSV file with one header row and one data row per Detection of `detections_harmonized.parquet` in the Query. A Detection is in the Query if its `lat` and `lon` pass a bounding-box pre-filter of the Selection_Area and then lie inside the Selection_Area polygon (point-in-polygon, with the boundary rule of Requirement 9.7 applied to edges), and its `acq_date_local` lies within the exact start and end dates of the Date_Range (inclusive, local standard time, UTC-8). DEFAULT (confirm) The columns SHALL be exactly the 16 columns of the Data_Contract, in this order: `sensor_family`, `satellite`, `source`, `lat`, `lon`, `acq_datetime_utc`, `acq_date_local`, `year`, `month`, `daynight`, `confidence_class`, `confidence_raw`, `frp`, `type`, `pixel_size_m`, `version`.
2. THE Exporter SHALL start the CSV with comment lines (prefixed `#`) stating: the Query geometry; the Date_Range in local dates and the convention "local standard time, fixed UTC-8, no daylight saving" (with `acq_datetime_utc` in true UTC); the generation timestamp (UTC); the data source (NASA FIRMS MODIS and VIIRS active-fire detections, Delivered_Data); the filters already applied (low-confidence detections dropped, only `type` 0 kept, approximate static-cell mask for near-real-time rows); the statement that the rows are filtered raw detections and that harmonization applies only to monthly Cell_Day counts; the statement that CSV rows are Detections while Calendar counts are Cell_Days, so the two do not reconcile row for row; the Region label "California region"; and the FIRMS citation. THE Exporter SHALL end a complete CSV with a final comment line stating the number of data rows written.
3. THE Exporter SHALL stream CSV files of up to 2,000,000 data rows without loading the whole file in memory, and the first bytes of the file SHALL reach the browser within 10 seconds of the download request. DEFAULT (confirm)
4. FOR ALL hotspot CSV files, parsing the CSV with a standard CSV reader that skips `#` lines SHALL reproduce the Detection values exported (round-trip property): the same number of rows, identical text values, numeric values equal to the exported values, and missing values written as empty fields.
5. FOR ALL Queries, the row count of the estimate of criterion 11 SHALL equal the number of data rows exported, and every exported row SHALL lie inside the Selection_Area and inside the Date_Range (estimate and containment property).
6. IF the Query contains more than 2,000,000 Detections, THEN THE Exporter SHALL not start the download, and THE Web_App SHALL display a message stating the Detection count and the 2,000,000-row limit and asking the user to narrow the Selection_Area or Date_Range, while keeping the current Query unchanged. DEFAULT (confirm)
7. IF the Query contains zero Detections, THEN THE Exporter SHALL produce a CSV containing the comment lines, the header row and zero data rows.
8. IF CSV generation fails after streaming has started, THEN THE Exporter SHALL stop writing without the final row-count comment line, and THE Web_App SHALL display an error message stating that the download is incomplete, while keeping the current Query unchanged.
9. WHEN the user requests a hotspot download, THE Web_App SHALL, before the download starts, show a confirmation that gives the number of data rows the CSV would contain (all Detections in the Query, as in criterion 1) and the approximate file size, with "Cancel" and "Download" actions. The download SHALL start only when the user activates "Download".
10. WHEN the user activates "Cancel", THE Web_App SHALL close the confirmation, start no download and keep the current Query unchanged. IF the row count is above 2,000,000, THEN THE Web_App SHALL show the message of criterion 6 in place of the "Download" action, and SHALL offer only a close action.
11. THE API SHALL provide an estimate for a Query that returns the row count and the approximate file size in bytes without generating the CSV, and SHALL answer within the response time of Requirement 28.1. The design will specify the interface. FOR ALL Queries, the row count of the estimate SHALL equal the number of data rows in the CSV of criterion 1 for the same Query and Delivered_Data (consistency property).
12. THE API SHALL compute the approximate file size as the row count multiplied by an average number of bytes per row, plus the size of the comment and header lines, where the average is a value in the app configuration measured once on the Delivered_Data detections file. THE Web_App SHALL label the size as approximate, rounded to 2 significant figures, in decimal units (kB, MB, GB). DEFAULT (confirm)
13. IF the estimate request fails or does not respond within 30 seconds, THEN THE Web_App SHALL start no download, show an error message and a retry action, and keep the current Query unchanged.

### Requirement 18: Analytics and chart downloads (P1)

**User Story:** As a land manager, I want to download tables and charts, so that I can use them in reports.

#### Acceptance Criteria

1. WHEN the user requests an analytics download, THE Exporter SHALL produce a CSV for the Query that contains: one row per month and one row per year in the Date_Range, each with the harmonized count (MODIS-equivalent Cell_Days), the raw MODIS Cell_Days and the raw VIIRS Cell_Days as two separate columns that are never summed, the `lower_bound` and `upper_bound` (empty when null), the Baseline statistics for that calendar month or year, the Anomaly values (absolute difference, percent difference, z-score, percentile rank) and a provisional flag. The CSV SHALL start with the same `#`-prefixed metadata header as the hotspot CSV (Requirement 17, criterion 2), stating that counts are Cell_Days and that the time convention is local standard time, UTC-8.
2. WHEN the user requests a chart download for any chart shown in the Web_App (the Calendar and every other chart displayed for the Query), THE Exporter SHALL produce that chart as a PNG at least 1600 pixels wide and as an SVG, each with the title, axis labels, units, Query description (Selection_Area name or bounding coordinates, and Date_Range in local standard time, UTC-8) and FIRMS data citation drawn on the image. DEFAULT (confirm)
3. THE Exporter SHALL name each downloaded file with the Region or area name, the Date_Range start and end dates in YYYY-MM-DD format, and the file type, using only letters, digits, hyphens and underscores, with a maximum of 100 characters before the file extension. DEFAULT (confirm)
4. FOR ALL Queries, each monthly and yearly harmonized count, Baseline and Anomaly value in the analytics CSV SHALL equal the corresponding value shown in the Web_App for the same Query, after rounding both to the number of decimal places shown in the Web_App.
5. IF the Query contains zero Cell_Days, THEN THE Exporter SHALL still produce the analytics CSV with the metadata header and one row per month and year in the Date_Range, with harmonized and raw counts set to 0.
6. IF the Exporter fails to produce a requested CSV, PNG or SVG file, THEN THE Web_App SHALL show an error message stating which file failed, SHALL NOT deliver a partial file, and SHALL keep the current Query and view unchanged.

### Requirement 19: Shareable state and comparison (P1)

**User Story:** As an emergency responder, I want to share a link to my exact view and compare areas or periods, so that colleagues see the same picture.

#### Acceptance Criteria

1. WHEN the user changes the Selection_Area, Date_Range, Baseline_Period, active Calendar view (counts, anomaly or month-to-month difference) or comparison mode settings, THE Web_App SHALL update the page URL within 1 second, without reloading the page, to encode all of these values, with Selection_Area vertex coordinates in decimal degrees (EPSG:4326) rounded to 6 decimal places.
2. WHEN a user opens a URL containing an encoded Query, THE Web_App SHALL restore the same Selection_Area, Date_Range, Baseline_Period, Calendar view and comparison mode settings, and SHALL display the same harmonized counts as the original view when both views read the same Delivered_Data.
3. FOR ALL valid Queries (valid under Requirement 13, up to 1000 vertices), encoding the Query into a URL and decoding the URL SHALL produce an equivalent Query (round-trip property). Equivalent means the same Date_Range, Baseline_Period and Calendar view, the same vertex count and order, and each vertex coordinate within 0.000001 degrees of the original.
4. WHERE comparison mode is enabled, THE Web_App SHALL show two Selection_Areas or two Date_Ranges side by side, with both panels using one colour scale whose minimum and maximum span the values of both panels and one shared legend.
5. WHEN comparison mode shows two Selection_Areas, THE Web_App SHALL offer a toggle that displays counts per 1000 km² for both areas. The value is the harmonized count (Cell_Days) divided by the total geodesic area in km² of the Display_Cells selected for the Selection_Area (Requirement 9.7), multiplied by 1000, and the label states the unit "Cell_Days per 1000 km²". DEFAULT (confirm)
6. IF the encoded URL would exceed 2000 characters, THEN THE Web_App SHALL store the Selection_Area through the API, replace the coordinates in the URL with an identifier of at most 16 characters, and keep that identifier resolvable for at least 30 days after it is created. DEFAULT (confirm) 2000-character limit, short server-side identifier, 30-day retention
7. IF the encoded URL would exceed 2000 characters and the API cannot store the Selection_Area, THEN THE Web_App SHALL simplify the Selection_Area coordinates until the URL is 2000 characters or fewer, and SHALL tell the user that the shared area is simplified and give the largest vertex displacement in metres. DEFAULT (confirm) simplification fallback
8. IF an opened URL contains a parameter that is malformed, fails Requirement 13 validation, or refers to an unknown or expired Selection_Area identifier, THEN THE Web_App SHALL keep the valid parameters, use the default value for each rejected parameter, and show a message naming each rejected parameter and the reason.

### Requirement 20: Recent activity view (P1)

**User Story:** As a firefighter, I want a quick view of the last 7 days, so that I can see current activity in the field.

#### Acceptance Criteria

1. WHEN the user opens the "last 7 days" view, THE Web_App SHALL show, for the current Selection_Area, the Delivered_Data Detections from the 7 consecutive local days (local standard time, UTC-8) ending on the local date of the latest Detection in the Delivered_Data. DEFAULT (confirm) The Detections SHALL appear as map points distinguished by satellite, alongside a daily bar chart with exactly 7 bars. Each bar is the number of raw Detections for one local day, and a day with no Detections shows as zero. THE Web_App SHALL label the map and the chart "raw, not harmonized, not comparable across sensors" and SHALL state the unit as raw Detections.
2. WHILE the "last 7 days" view is displayed, THE Web_App SHALL display the date and time (`acq_datetime_utc`, labelled UTC, to the minute) of the latest Detection in the Delivered_Data.
3. WHILE the current local date (UTC-8) is more than 3 calendar days after the local date of the latest Detection in the Delivered_Data, THE Web_App SHALL display a notice stating the data age in whole days. DEFAULT (confirm)
4. WHERE the Web_App shows the `source` value of a Detection (for example in a map point popup), THE Web_App SHALL show it as delivered and SHALL make no other provisional or near-real-time label on daily counts.
5. IF the Selection_Area contains no Detections in the 7-day period, THEN THE Web_App SHALL show an empty map layer and seven zero-count bars, together with a message stating that no Detections were found in that period.
6. IF the API fails to return recent-activity data, or takes longer than 10 seconds to respond, THEN THE Web_App SHALL display an error message saying the recent data could not be loaded and keep the current Selection_Area unchanged. DEFAULT (confirm)
7. DEFERRED. A Watch_Level for the last 7 days is not computed, because the Delivered_Data has no daily harmonized series to compare against a daily Baseline. The Watch_Level of criterion 8 uses months, which resolves the conflict between the 7-day window of criterion 1 and a 7-day Watch_Level.
8. WHEN a Query is set, THE Statistics_Engine SHALL compute a Watch_Level for the Latest_Complete_Month of the Selection_Area. The observed value is the harmonized count of that month in the Zero_Filled_Series, compared with the Baseline of Requirement 10 for the same calendar month.
9. THE Statistics_Engine SHALL compute the percentile rank of the Watch_Level with the mid-rank definition of Requirement 10.3 against the zero-filled Baseline years, and, when the Watch_Level is not reported as "Not available" under criterion 13, SHALL set the Watch_Level to "Above normal" when the percentile rank is greater than the Watch_Level threshold and to "Within normal range" otherwise. The threshold is a configuration value with a default of 90. DEFAULT (confirm)
10. THE Web_App SHALL show one Watch_Level badge for the Latest_Complete_Month for the current Selection_Area, both in the Recent_View and in the summary cards area.
11. THE Web_App SHALL show on the Watch_Level badge the level, the harmonized count in Cell_Days, the Baseline median, the percentile rank, the evaluated month and the first and last years of the Baseline_Period, for example "Above normal — 412 Cell_Days vs median 130 (96th percentile, October 2026, baseline 2001–2025)".
12. THE Web_App SHALL convey the Watch_Level by a text label and an icon in addition to colour, SHALL use a CVD_Safe_Palette with WCAG 2.2 level AA contrast as defined in Requirement 27.1, and SHALL expose the level, count, Baseline median, percentile rank and month of the badge to assistive technology as text.
13. IF fewer than 5 Baseline_Period years have data for the calendar month of the Latest_Complete_Month, or the Zero_Filled_Series contains no complete month, THEN THE Statistics_Engine SHALL report the Watch_Level as "Not available", and THE Web_App SHALL show the badge as "Not available" with the reason.
14. WHEN the Latest_Month is the Provisional_Month, THE Web_App SHALL show it next to the Watch_Level badge as provisional with its count to date, and THE Statistics_Engine SHALL NOT evaluate it against the Baseline.
15. THE Statistics_Engine SHALL compute the Watch_Level only from counts, Baselines and percentile ranks that the Statistics_Engine returns for the same Query, so that every number on the Watch_Level badge equals the corresponding value in the charts and tables of the Web_App after the same rounding.
16. FOR ALL Baselines with at least 5 years and all observed counts, the Watch_Level SHALL be "Above normal" exactly when the percentile rank is greater than the threshold, and for any two counts x1 < x2 against the same Baseline, the Watch_Level of x2 SHALL be "Above normal" whenever the Watch_Level of x1 is "Above normal" (monotone property).

### Requirement 21: Season tracker (P1, uncommon in existing tools)

**User Story:** As a fire manager, I want to see this season's cumulative activity against the historical range, so that I know whether the season is running ahead or behind.

#### Acceptance Criteria

1. WHEN a Query is submitted, THE Statistics_Engine SHALL compute, for the Selection_Area and for each Season_Year in the record, the cumulative harmonized count (Cell_Days) at the end of each month-of-season 1 to 12, from the Zero_Filled_Series. The Season_Tracker works at monthly resolution because the Delivered_Data has no daily harmonized counts. DEFAULT (confirm)
2. WHEN a Query is submitted, THE Statistics_Engine SHALL compute, for each month-of-season 1 to 12, the median, the 10th percentile and the 90th percentile of the cumulative counts of the Season_Years that lie entirely inside the Baseline_Period, using the same percentile definition as the Baseline. The Provisional_Month is excluded.
3. WHEN a Query result is shown, THE Season_Tracker SHALL display the selected Season_Year cumulative curve over the 10th to 90th percentile envelope and the median curve. For a Season_Year that is still in progress, the curve SHALL end at the Latest_Complete_Month and SHALL NOT include the Provisional_Month.
4. FOR ALL Season_Years and all month-of-season values m from 1 to 11, the cumulative count at m + 1 SHALL be greater than or equal to the cumulative count at m (monotone property).
5. FOR ALL month-of-season values from 1 to 12, the envelope SHALL satisfy 10th ≤ median ≤ 90th percentile (ordering property).
6. WHEN a Query result is shown, THE Season_Tracker SHALL state the selected Season_Year cumulative count at its last complete month as a percentage of the median cumulative count for the same month-of-season, rounded to the nearest whole percent. IF that median is 0, THEN THE Season_Tracker SHALL show the percentage as not available and show the cumulative count and the median as numbers instead.
7. WHERE the user sets a Season_Year start month (January to December, default January), THE Statistics_Engine SHALL compute season curves with that start month. [P2]
8. THE Statistics_Engine SHALL assign month-of-season by calendar month relative to the Season_Year start, so that each calendar month maps to the same month-of-season in every Season_Year. The folding of 29 February used for daily curves is not applicable at monthly resolution. DEFAULT (confirm)
9. FOR ALL complete Season_Years, the cumulative count at month-of-season 12 SHALL equal the total harmonized count of that Season_Year for the Selection_Area (total-preservation property).
10. IF fewer than 5 Season_Years lie entirely inside the Baseline_Period for the chosen start month, THEN THE Season_Tracker SHALL display the selected Season_Year curve without the envelope or median curve, together with a message saying the baseline has too few years. DEFAULT (confirm)

### Requirement 22: Fire-season timing metrics (P2, uncommon in existing tools)

**User Story:** As a scientist, I want onset, peak, end and length of each fire season, so that I can study shifts in fire timing.

#### Acceptance Criteria

1. DEFERRED. THE Web_App SHALL show no Season_Metrics (onset, peak, end, length or their trends), because they need a daily harmonized series and the Delivered_Data has monthly harmonized counts only. Raw daily Detections are not harmonized and are not used for Season_Metrics.
2. WHERE a daily harmonized series is added to the Delivered_Data, THE Team SHALL reinstate this requirement with the season timing thresholds listed in Defaults to confirm (see Future work).

### Requirement 23: Plain-language briefing (P2, uncommon in existing tools)

**User Story:** As an emergency responder, I want plain-language summary sentences, so that I can relay the situation quickly.

#### Acceptance Criteria

1. WHEN a Query is set, THE Briefing_Generator SHALL produce sentences from fixed templates stating the rank and percentile of the Latest_Complete_Month among the same calendar months in the record, for example "October 2026 is the 3rd highest October since 2000 (96th percentile)." The Latest_Complete_Month is the most recent month of the Zero_Filled_Series that is not after the end of the Date_Range. The rank uses 1 for the highest harmonized count and gives tied counts the same (best) rank. The percentile is rounded to the nearest whole number.
2. WHEN a Query is set, THE Briefing_Generator SHALL produce a sentence comparing the year-to-date cumulative harmonized count (Cell_Days) for the current Season_Year, through the Latest_Complete_Month, with the Baseline median cumulative count for the same month-of-season (the median shown in the Season_Tracker). The sentence SHALL state both counts and the percent difference, each rounded to the nearest whole number, and SHALL say whether the current count is above, below or equal to the median.
3. WHEN a Query is set, THE Briefing_Generator SHALL produce a sentence naming the calendar month with the highest Baseline median in the Baseline seasonal profile. If two or more months tie, the sentence SHALL name all of them in calendar order.
4. THE Briefing_Generator SHALL compute each statement only from values displayed elsewhere in the Web_App for the same Query, so that every number in a sentence matches the corresponding chart or table value after the stated rounding.
5. IF the Query has fewer than 5 complete years of data, THEN THE Briefing_Generator SHALL omit rank statements and state that the record is too short.
6. IF the Baseline median used in criterion 2 is zero, THEN THE Briefing_Generator SHALL omit the percent difference, state both counts, and state that the historical median for that month is zero.
7. IF the Selection_Area has a harmonized count of zero in every month of the Baseline_Period, THEN THE Briefing_Generator SHALL replace the sentences of criteria 2 and 3 with one sentence stating that no burning activity was detected in the area during the Baseline_Period.
8. WHEN the Selection_Area or Date_Range of the Query changes, THE Briefing_Generator SHALL replace every sentence with sentences computed for the new Query, and THE Web_App SHALL show no sentence from the previous Query once the new values are displayed.
9. THE Briefing_Generator SHALL make no day-level statement, and SHALL mention the Provisional_Month only as provisional and not evaluated against the Baseline.

### Requirement 24: Sensor transparency (P2, uncommon in existing tools)

**User Story:** As a scientist, I want to see raw and harmonized series and what was filtered, so that I can judge the effect of each processing step.

#### Acceptance Criteria

1. WHERE sensor transparency is enabled, WHEN a Query is submitted, THE Web_App SHALL display, on one time axis covering the Date_Range, the monthly `count_raw_modis` and `count_raw_viirs` (Cell_Days, one labelled line per sensor family, never summed) beside the Harmonized_Series for the same Selection_Area, with a vertical marker at the Switchover_Month (2012-01) whenever it falls within the Date_Range.
2. WHERE sensor transparency is enabled, WHEN the user selects a year and month, THE Web_App SHALL display a map of the `calib_model` (quantile_map, ratio_month, log_regression or none) of each Display_Cell that has a grid row in that month and intersects the Selection_Area, with a legend naming each value, a cue that does not rely on colour alone, and a separate style for Display_Cells with no grid row (no Cell_Days) in that month.
3. DEFERRED. The filtered-sources map layer is not provided, because the static-source mask file and the list of excluded detections are not delivered.
4. DEFERRED. The per-rule counts of removed Detections are not provided, because no list of excluded detections is delivered.
5. DEFERRED. The rule that each removed Detection is counted under exactly one filter rule does not apply, because no excluded detections are delivered.
6. IF a sensor family has no data for a month within the Date_Range because the sensor was not operating (for that sensor family, absent from the `provenance` of every grid row in that month), THEN THE Web_App SHALL show that month as a gap in that sensor family's raw series rather than as a zero count. DEFAULT (confirm)
7. DEFERRED. The 10,000-excluded-Detection display limit does not apply, because no excluded Detections are shown.
8. THE Web_App SHALL show the global filters already applied to the Delivered_Data (low-confidence detections dropped, only `type` 0 kept, approximate static-cell mask of 211 cells for near-real-time rows) on the methods page only, as text without counts for the Selection_Area.

### Requirement 25: Situation brief (P2, uncommon in existing tools)

**User Story:** As an emergency manager, I want a one-click one-page brief, so that I can attach it to a situation report.

#### Acceptance Criteria

1. WHEN the user activates the single Situation_Brief control in the Web_App for the current Query, THE Exporter SHALL produce a PDF of exactly one page and a PNG with the same content, each containing the map of the Selection_Area, the Calendar, the summary cards, the Season_Tracker, the briefing sentences from the Briefing_Generator, the Query description (Selection_Area coordinates or name and Date_Range), the generation timestamp (UTC), the time convention (local standard time, UTC-8) and the data citation for FIRMS.
2. WHEN the user requests a Situation_Brief for a Query whose Selection_Area is the full Pilot_Region and whose Date_Range covers Record_Start to the Latest_Month, THE Exporter SHALL make both files available for download within 15 seconds, measured from the request to the start of the download. DEFAULT (confirm)
3. THE Exporter SHALL include the shareable URL of the Query in the Situation_Brief, so that opening that URL restores the same Selection_Area and Date_Range in the Web_App.
4. IF the Query contains zero Cell_Days, THEN THE Exporter SHALL still produce the Situation_Brief, show harmonized counts of 0, and include a statement that no burning activity was detected for the Query.
5. IF Situation_Brief generation fails or does not finish within 60 seconds, THEN THE Web_App SHALL show an error message indicating that the brief could not be produced, provide no partial file, and keep the current Query, map and Calendar state unchanged.

### Requirement 26: Design and layout (P0)

**User Story:** As a user in an operations centre or in the field, I want a clear, modern interface, so that I find answers without training.

#### Acceptance Criteria

1. WHILE the viewport is at least 768 px wide, THE Web_App SHALL show the map, a control panel holding the area, date and option inputs, and a results panel at the same time. The results panel SHALL show the summary cards above the Calendar and charts.
2. THE Web_App SHALL take every font family, font size, spacing value, colour and interactive component (button, input, card, dialog, tooltip) in all views from one shared set of design tokens and components, so that no view defines its own.
3. WHEN a Query starts, THE Web_App SHALL show a loading indicator in the results panel within 300 ms and keep it visible until results, the empty-state message or the error message appear.
4. WHEN a Query finishes with zero Cell_Days, THE Web_App SHALL show an empty-state message that names the Selection_Area and Date_Range and suggests widening one of them, in place of the Calendar and charts.
5. IF a Web_App request to the API fails or returns no response within 30 seconds, THEN THE Web_App SHALL show an error message saying the request failed, offer a retry action that resends the same Query, and keep the Selection_Area, Date_Range and options the user entered.
6. THE Web_App SHALL lay out all views at viewport widths from 360 px to 2560 px without horizontal page scrolling, and SHALL stack the control panel, map and results panel in one column at widths below 768 px. [P1]
7. WHEN the Web_App is first opened, THE Web_App SHALL apply the light or dark theme that matches the operating-system colour-scheme preference. WHEN the user chooses a theme with the theme control, THE Web_App SHALL apply it to all views and keep it on later visits from the same browser. [P1]
8. THE Web_App SHALL provide a methods and data page that covers data sources, filtering, harmonization, validation results, limitations and citations, and SHALL make the page reachable with one click from every view.
9. WHEN a browser opens the Web_App for the first time, THE Web_App SHALL show a guide of no more than 3 steps (choose area, choose dates, read the Calendar). The guide SHALL have a dismiss control, SHALL not reappear after dismissal in that browser, and SHALL stay reachable from a help control. [P2]
10. WHILE the viewport is 1440 × 900 CSS px at 100 % browser zoom and the default Date_Range is applied, THE Web_App SHALL show the summary cards and the Calendar month header row with at least the 3 most recent year rows without any page or panel scrolling. This criterion does not require the whole Calendar to be visible without scrolling.
11. THE Calendar SHALL scroll inside its own scroll area when its rows exceed the area height. WHILE the Calendar scrolls, THE Calendar SHALL keep the month headers fixed at the top and the year column fixed at the left of the scroll area. THE scroll area SHALL be reachable and scrollable by keyboard, SHALL keep a focused cell fully visible and not hidden behind the fixed headers, SHALL have an accessible name, and SHALL cause no horizontal page scrolling at the widths of criterion 6.
12. THE methods and data page of criterion 8 SHALL contain: the method summary of the Data_Contract (VIIRS counts mapped to MODIS-equivalent with a transfer function fitted on the 2012 onward overlap per 1.0 degree Calibration_Region, quantile mapping chosen, best model per region, statewide fallback for 13 data-poor regions, Switchover_Month 2012-01); the validation numbers of `outputs2.0/DATA_README.md` (statewide holdout RMSE 22.2, bias 0.8, seasonality correlation 0.989; no step at the switchover, 2009 to 2011 mean 383.7 against 2012 to 2014 mean 366.3, −4.5 %); the Region label "California region" with its extent and the statement that no claim is made about a state boundary mask; the time convention (local standard time, fixed UTC-8, no daylight saving, with `acq_datetime_utc` kept in true UTC); the counting unit (Cell_Days, not raw detections); the filters already applied (low-confidence detections dropped, only `type` 0 kept, approximate static-cell mask for near-real-time rows); and the statement that Detections in CSV downloads and in the Recent_View are filtered raw detections that are not individually harmonized, and that harmonization applies only to monthly counts.
13. THE methods and data page SHALL list every known limitation of the Data_Contract: the calibration assumes the overlap period represents the earlier regime; Terra and Aqua overpass drift and VIIRS constellation changes may leave residual effects; pre-2012 small fires are undercounted relative to the VIIRS era; cloud and smoke reduce detections; near-real-time filtering is approximate; the latest month is incomplete and is marked provisional, never plotted as a full month; small areas look noisy after 2012 because quantile mapping can turn small counts into zero; before Aqua started only Terra provides coverage (see the `provenance` column); 96 of 98 regions have validation metrics; and the best model per region was selected on the same holdout used to report errors, so reported accuracy is slightly optimistic.

### Requirement 27: Accessibility (P0)

**User Story:** As a user with a visual or motor impairment, I want the app to meet accessibility standards, so that I can use every feature.

#### Acceptance Criteria

1. THE Web_App SHALL meet WCAG 2.2 level AA contrast ratios against the adjacent background colour: at least 4.5:1 for normal text, and at least 3:1 for large text (at least 24 CSS px regular or 18.66 CSS px bold), for graphical elements needed to read a chart or the Calendar (data marks, axes, legend swatches, Selection_Area outline), and for control boundaries.
2. THE Web_App SHALL make every control, Calendar cell and chart reachable and operable using only the Tab, Shift+Tab, arrow, Enter, Space and Escape keys, with no keyboard trap, and with a visible focus indicator that has at least 3:1 contrast against adjacent colours.
3. THE Web_App SHALL give each chart and the Calendar a text label, exposed to assistive technology, that states the variable, units, Selection_Area name or coordinates, Date_Range, total harmonized count and the month with the highest count, and SHALL place a link next to it to the data table alternative containing the same values.
4. THE Web_App SHALL use only CVD_Safe_Palettes for data colours, and SHALL show the sign of each Anomaly and each month-to-month difference with a second cue that does not depend on colour (a value label with a + or − sign, a pattern, or a tooltip with the signed value).
5. THE Web_App SHALL offer coordinate entry (bounding box or polygon vertices in EPSG:4326) as an equivalent way to set the Selection_Area, reachable by keyboard and labelled for screen readers, so that a user who cannot operate the map drawing tool can create the same Selection_Area.
6. WHEN the browser zoom is set to 200 % or the viewport width is 320 CSS px, THE Web_App SHALL show all content and controls without loss of information or function, and without horizontal scrolling outside the map, charts and data tables.
7. THE Web_App SHALL make every pointer target at least 24 × 24 CSS px, or space it so that a 24 CSS px circle centred on the target does not overlap another target, as required by WCAG 2.2 success criterion 2.5.8.
8. WHEN a Query starts loading, finishes loading, returns an error or produces a download, THE Web_App SHALL announce the status change to assistive technology without moving keyboard focus.
9. THE Web_App SHALL make the draw buttons and Example_Area buttons (Requirement 11), the hint dismiss control (Requirement 11.13), the help info controls, the Detail_Panel and its close button (Requirement 15), and the CSV confirmation actions (Requirement 17.9) meet criteria 1, 2 and 7, with accessible names, and SHALL not move keyboard focus when the "Updating" state of Requirement 28.7 starts or ends.

### Requirement 28: Performance (P0)

**User Story:** As an emergency responder, I want results in seconds, so that the tool is usable during an incident.

#### Acceptance Criteria

1. WHEN the API receives a Query whose Selection_Area lies within the Pilot_Region and has up to 1000 vertices, and whose Date_Range covers any part of the full record (Record_Start to the Latest_Month), THE API SHALL read the monthly grid (89,467 rows) with DuckDB and return the complete Calendar data within 3 seconds at the 95th percentile. The time is measured from request receipt to the last response byte on the deployed host, over at least 100 such Queries with up to 5 concurrent requests. DEFAULT (confirm)
2. WHEN the Web_App is first opened with an empty browser cache on a 10 Mbit/s connection, THE Web_App SHALL render the map base layer and an interactive control panel (area selection and Date_Range inputs accept input) within 4 seconds of the navigation start. DEFAULT (confirm)
3. WHEN a hotspot CSV of up to 2,000,000 rows is requested for a valid Query, THE Exporter SHALL send the first bytes of the CSV (the `#` metadata header) within 10 seconds of the request, as measured on the deployed host. DEFAULT (confirm)
4. WHEN the user returns to a Query already completed in the same browser session, THE Web_App SHALL show that Query's results within 500 ms without a new API request. [P1]
5. WHILE a Query or CSV request has not completed for more than 1 second, THE Web_App SHALL show a loading indicator on the affected view and keep the previous results on screen, dimmed and labelled "Updating" as set in criteria 7 to 9, until new results arrive.
6. IF the API has not returned Calendar data within 30 seconds of the request, THEN THE Web_App SHALL stop waiting, show an error message saying the request timed out, offer a retry action, and keep the user's Selection_Area and Date_Range unchanged. DEFAULT (confirm)
7. WHILE a new Query is loading and the previous results are still shown, THE Web_App SHALL dim the previous results in the results panel so that their text stays legible at the contrast ratios of Requirement 27.1, and SHALL show an "Updating" label in the results panel, so that the previous results do not look current.
8. WHILE the "Updating" state of criterion 7 is active, THE Web_App SHALL show the dimming and the label from the moment the loading indicator of Requirement 26.3 appears, and SHALL remove both when the new results, the empty-state message or an error message replace the previous results.
9. WHEN the "Updating" state of criterion 7 starts and when it ends, THE Web_App SHALL announce it in the status live region of Requirement 27.8 without moving keyboard focus.
10. IF the new Query fails or times out while the previous results are still shown, THEN THE Web_App SHALL keep the previous results dimmed, replace the "Updating" label with a "Not updated" label, and show the error message and retry action of Requirement 26.5, so that the previous results do not look current for the Query the user selected.

### Requirement 29: Security and data handling (P0)

**User Story:** As the team, I want secrets and data handled safely, so that the public deployment is safe.

#### Acceptance Criteria

1. THE API SHALL read any secret (for example a host access token) only from environment variables or an untracked `.env` file, and the Repository SHALL contain a `.env.example` file in which each secret has a placeholder value instead of a real value. The app needs no FIRMS key.
2. THE API SHALL replace every occurrence of a secret value in logs and error messages with a fixed placeholder, and THE API SHALL never include a secret in any response sent to the Web_App.
3. THE Repository SHALL exclude `.env` and the Delivered_Data folder (`outputs2.0/`) through `.gitignore`, so that no data file is committed to git.
4. THE API SHALL accept only read operations from public users, with one exception: storing a Selection_Area to create a short share link (Requirement 19). THE API SHALL validate all Query parameters against declared types and the limits of Requirement 13 (coordinate ranges, radius 1 to 500 km, at most 1000 vertices, GeoJSON up to 5 MB). DEFAULT (confirm)
5. THE API SHALL pass every user-supplied value to data access as a query parameter and SHALL never concatenate user-supplied values into query text.
6. IF a share-link store request contains a Selection_Area that fails the validation rules of Requirement 13, THEN THE API SHALL reject the request with an error indicating the invalid field and SHALL store nothing.
7. IF the API encounters an internal error while answering a request, THEN THE API SHALL return an error indication without stack traces, server file paths or secrets.
8. THE Repository SHALL contain no real secret value and no Delivered_Data file in any tracked file or commit.

### Requirement 30: Units, time and reproducibility (P0)

**User Story:** As a scientist, I want units, time zones and processing steps stated, so that results can be reproduced and cited.

#### Acceptance Criteria

1. THE API SHALL return every day, month and year on the local standard time convention of the Delivered_Data (fixed UTC-8, PST, no daylight saving) without conversion, and SHALL return `acq_datetime_utc` as true UTC in ISO 8601 with an explicit UTC designator.
2. THE Web_App and THE Exporter SHALL state the unit of every displayed or exported value (MODIS-equivalent Cell_Days, raw Cell_Days, raw Detections in the Recent_View and hotspot CSV, MW, km, km²) and the CRS (EPSG:4326 for latitude and longitude). Units SHALL appear in chart axis labels, chart legends, key-figure labels, CSV column headers or CSV metadata lines, and Situation_Brief figure captions. Every date shown or exported SHALL be labelled "local standard time, UTC-8", and every `acq_datetime_utc` value SHALL be labelled UTC.
3. THE API SHALL report in its metadata response the app configuration values used (Region name and extent, RECORD_START, EXCLUDED_CELLS, Baseline_Period, Season_Year start month, Watch_Level threshold) and the Delivered_Data build date stated in `outputs2.0/DATA_README.md` (2026-11-14), taken from the app configuration. DEFAULT (confirm)
4. WHEN the API receives the same Query more than once against the same Delivered_Data and app configuration, THE API SHALL return the same values in the same order each time (determinism property).
5. THE README SHALL document one command that runs the app (API and built Web_App) with no manual step in between, given the Delivered_Data in the configured data folder.
6. NOT APPLICABLE. Failures of data preparation steps belong to the external data build and are not handled by this app. Unreadable or missing Delivered_Data is handled by Requirement 32.7.
7. WHEN the Exporter produces a CSV, PNG, SVG or PDF file, THE Exporter SHALL include the Delivered_Data build date, the generation timestamp (UTC), the Query (Selection_Area and Date_Range in local standard time, UTC-8) and a FIRMS data citation, either in the file or in its metadata.

### Requirement 31: Automated testing (P0)

**User Story:** As the team, I want automated tests of the core computations, so that statistics stay correct as code changes.

#### Acceptance Criteria

1. THE Test_Suite SHALL include property-based tests for the properties stated in Requirements 9.3, 9.4, 10.4, 10.5, 15.19, 16.10, 17.4, 17.5, 19.3, 20.16, 21.4, 21.5, 21.9, 30.4 and in criterion 8 of this requirement (zero-fill area series), with each property checked against at least 100 generated inputs per test run.
2. THE Test_Suite SHALL include example-based tests that read tiny synthetic Parquet fixtures with the same schema as `harmonized_monthly_grid.parquet` and `detections_harmonized.parquet`, and SHALL compare cell selection by centre point, zero-filling, Baselines, Anomalies and CSV output against expected values stored with the fixtures. THE fixtures SHALL be labelled as test fixtures, SHALL be generated, and SHALL never be presented as NASA data.
3. THE Test_Suite SHALL include an integration test that runs the API on the synthetic fixtures (a monthly grid and a detections file of no more than 10,000 Detections, spanning the Switchover_Month). The test SHALL check that every month × year value in the API Calendar response equals the precomputed expected harmonized count within an absolute tolerance of 1e-6.
4. THE Test_Suite SHALL run with one command for Python and one command for the front end. The Python linter and the front-end linter SHALL each report zero errors before submission.
5. IF any test in the Test_Suite fails, THEN the test command SHALL exit with a non-zero status and report the name of each failing test.
6. THE Test_Suite SHALL run without network access and without the Delivered_Data. Every test SHALL use only fixture data stored in the Repository.
7. WHEN either test command is run on the Team's development machine, THE Test_Suite SHALL finish within 10 minutes. DEFAULT (confirm)
8. FOR ALL sparse monthly grids and sets of selected Display_Cells, the Zero_Filled_Series SHALL contain exactly one entry for each in-record complete year-month, SHALL hold 0 for every year-month with no grid row among the selected cells, and SHALL sum to the sum of `count_harmonized` of the grid rows of the selected cells in those year-months (zero-fill property, Requirement 9.8).

### Requirement 32: Deployment (P0)

**User Story:** As a judge or user, I want to open the app online, so that I can try it without installing anything.

#### Acceptance Criteria

1. THE Build SHALL produce one container image that contains the API and the built Web_App, and that serves both from a single port without network access to FIRMS and without any FIRMS key. The Delivered_Data files are not committed to git (Requirement 29.3).
2. THE Deployment SHALL run on Hugging Face Spaces (Docker), with Render or Fly.io as fallback hosts, and SHALL serve the Web_App at a public URL that opens without login or local installation. DEFAULT (confirm)
3. THE README SHALL document one shell command that starts the container locally and the local URL at which the Web_App then opens. This is the fallback when no online host is available.
4. WHEN the health endpoint is requested, THE API SHALL respond within 1 second with the service status, whether the Delivered_Data are present, and the Latest_Month (YYYY-MM). DEFAULT (confirm)
5. NOT APPLICABLE. The Deployment serves fixed Delivered_Data and runs no scheduled refresh. New data needs new Delivered_Data files from the data owner.
6. THE Build SHALL exclude any `.env` file and any secret from the container image.
7. IF the Delivered_Data are missing or unreadable when the API starts, THEN THE API SHALL report an unavailable status on the health endpoint, and THE Web_App SHALL display an error message stating that data are unavailable instead of showing empty charts.
8. NOT APPLICABLE. No scheduled refresh or rebuild exists, so there is no refresh failure to handle.
9. THE Team SHALL decide how the Delivered_Data files reach the host, for example by downloading them from a Hugging Face dataset repository when the container starts, or by building the image locally with the data baked in. The files stay out of git in both cases. DEFAULT (confirm)

### Requirement 33: Submission deliverables (P0)

**User Story:** As the team, I want every submission item ready before the deadline, so that the project is judged complete.

#### Acceptance Criteria

1. THE Submission SHALL include the URL of the Deployment, and the URL SHALL load the Web_App Calendar for the Pilot_Region in a browser that is not logged in to any team account. IF no online host is available, THEN THE Submission SHALL instead include local run instructions that start the container image with at most 3 commands, documented in the README. DEFAULT (confirm against the live submission form)
2. THE Submission SHALL include the URL of the Repository, hosted publicly on GitHub and readable without login, with a README that has one section for each of the following: purpose, features, setup, data (where the Delivered_Data come from and where to place them), tests, deployment and license.
3. THE Submission SHALL include a demo video no longer than 30 seconds, a slide deck of no more than 7 slides, or both, following the demo limits in the Space Apps judging guide. DEFAULT (confirm)
4. THE Submission SHALL include a project summary text and a project details text that together describe the problem, solution, target users, benefits and tools used. Any length limits on these texts come from the live submission form. DEFAULT (confirm)
5. THE Submission SHALL include a methodology document in the Repository covering data sources, filtering, harmonization, validation results (including the Validation_Report) and limitations, and the Web_App methods page SHALL link to that document.
6. THE Submission SHALL list all NASA data used, with each FIRMS product named by Sensor, collection or version, and citation. It SHALL also list all other references and every software library pinned in the Repository dependency files.
7. THE Submission SHALL include a disclosure that names each AI tool used and the tasks each tool was used for.
8. THE Team SHALL submit all items before Sunday 15 November 2026, 11:59 PM local time. The time zone that "local time" refers to is DEFAULT (confirm) the Team's own time zone.
9. WHEN 24 hours remain before the deadline in criterion 8, THE Team SHALL check each item in criteria 1 to 7 from a browser that is not logged in, and SHALL record for each item whether it passed or failed. DEFAULT (confirm)
10. IF the Deployment URL fails to load the Web_App during the check in criterion 9, THEN THE Team SHALL redeploy to the fallback host listed in Defaults to confirm, or submit the local run instructions from criterion 1, before the deadline.
11. THE Repository SHALL contain no secrets and no Delivered_Data files at the time of Submission.
12. THE README and the methodology document SHALL each contain the items listed in Requirement 26.12 (method summary, validation numbers cited to `outputs2.0/DATA_README.md`, "California region" label and extent, time convention, Cell_Day counting unit, filters already applied, and the statement that detection-level data are raw and not individually harmonized).
13. THE README and the methodology document SHALL each list every known limitation listed in Requirement 26.13.

## Future work

These items are outside the current scope and carry no acceptance criteria.

- **Regenerate a zero-filled cell climatology.** The delivered climatology files are not used (sparse baseline, inconsistent percentiles). A zero-filled cell climatology could replace the query-time Baseline for large areas. Not a build blocker.
- **Fill `lower_bound` and `upper_bound` from holdout error.** Requirement 7 is deferred until the calibration holdout-error file is delivered. The bounds would apply to calibrated months (2012 onward) only.
- **Daily harmonized series.** A daily harmonized series would allow fire-season timing metrics (Requirement 22), a daily harmonized count chart (Requirement 16.6) and a 7-day Watch_Level (Requirement 20.7).
- **Fixed or shared colour scale for the counts view.** The counts view sets its colour classes from the displayed Calendar only (Requirement 15.14), so colours cannot be compared between areas or date ranges. A later version could offer an option to use a fixed scale (for example, edges set from the Pilot_Region full-record quantiles) or a scale shared between two compared Queries.

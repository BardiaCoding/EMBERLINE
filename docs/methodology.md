## How the harmonized series is built

Emberline: Harmonized Fire Calendar combines two satellite records of active-fire hotspots for the California region: MODIS (on Terra and Aqua, from November 2000) and VIIRS (Suomi NPP, joined by NOAA-20 in 2018 and NOAA-21 in 2023, and used in this series from 2012). The two sensors differ in pixel size, sensitivity and overpass schedule, so their raw counts cannot be compared directly. This page describes how the delivered monthly series was made comparable, how the app computes baselines and anomalies from it, and where it falls short.

The harmonization was done before this app was built. The app reads the delivered files and does not repeat it. Every figure about the pipeline on this page comes from the data README delivered with the data (`outputs2.0/DATA_README.md`, build date 2026-11-14) or from the data contract of this project. Statements that come from neither are marked unverified or DEFAULT (confirm).

## Data source

The data are NASA FIRMS (Fire Information for Resource Management System) active-fire detections from MODIS and VIIRS. The downloads, parsing, filtering, calibration and validation were done outside this app, and the data README describes the pipeline. The app uses two delivered files:

- `harmonized_monthly_grid.parquet`: 89,467 rows over 5,370 cells of 0.1 degrees (EPSG:4326). One row per cell, year and month with activity. A missing row means zero cell-days. The README names the calendar value `count_harmonized`.
- `detections_harmonized.parquet`: 2,105,593 filtered detections, used for CSV downloads and the map of recent detections.

Region label: California region. The measured extent of the grid cells is latitude 32.5 to 42.2 and longitude -124.4 to -114.0 (south-west corners plus 0.1 degree). DEFAULT (confirm): these measured values stand until the data owner confirms otherwise. Whether a state boundary mask was applied is unknown, so this page makes no claim either way.

The record starts in November 2000. October 2000 holds a single day and is excluded from the calendar and from every baseline. Counts are MODIS-native for 2000 to 2011 and calibrated VIIRS from 2012 onward, on the MODIS-equivalent scale.

## Counting unit

The unit is the cell-day. One cell-day is one 1 km cell with at least one kept detection on a local day, counted once per sensor family (all satellites of a family merged). Counts are cell-days, not raw detections. Counting cell-days instead of detections removes most of the difference between the 375 m VIIRS pixel and the 1 km MODIS pixel, and most of the effect of the growing VIIRS constellation (one satellite, then two in 2018, then three in 2023).

Fire radiative power (FRP) is in megawatts (MW). Area totals use the summed FRP (`frp_sum`). The app never averages the per-cell mean FRP (`frp_mean`) across cells. Where the mean is missing in the delivered data, the app shows a dash.

## Time convention

Days, months and years use local standard time at a fixed offset of UTC-8 (Pacific Standard Time, no daylight saving) all year. The field `acq_datetime_utc` keeps the true UTC time of each detection. The data README reports that this convention moves about 24% of MODIS detections to a different day than UTC would, and about 0% of VIIRS detections. Because the offset is fixed, detections within about one hour of local midnight in summer can fall on the adjacent day. The README calls this negligible at monthly aggregation.

## Filters already applied

The delivered data are already filtered, and the app does not filter again.

- Low-confidence detections were dropped. MODIS numeric confidence below 30 is low. VIIRS confidence class l is low.
- Only `type` 0 (vegetation or other fire) was kept. Volcano (1), other static land (2) and offshore (3) detections were dropped.
- Near-real-time (NRT) files have no `type` column. Their rows were filtered with a mask of persistent static cells built from the standard-processing record: a cell of about 1 km is static if, across at least 3 distinct years, at least 80% of its detections are type 2 or 3. The README found 211 such cells. This filter is approximate, because it works per cell and not per detection.
- Standard-processing data are used wherever available. NRT data are used only after the last standard-processing date of each sensor. NRT also uses a different processing version.
- One stray cell outside California (`38.7000_-117.4000`) is excluded from every query by the app configuration.

## From VIIRS to the MODIS-equivalent scale

The reference scale is MODIS-equivalent. Counts before 2012 are MODIS-native. From 2012 onward the VIIRS counts are mapped to the MODIS scale with a transfer function fitted on the months where both sensors operated (the 2012 and later overlap). The function is fitted separately for each 1.0 degree calibration region, never as one global factor. The switchover year is 2012.

Three candidate models were compared on a held-out 25% of the overlap months: a monthly ratio, a quantile mapping and a log regression. Quantile mapping had the lowest error and is the model chosen statewide. Within each region the model with the lowest error is used, and a fallback fitted on all regions together is used in 13 data-poor regions that have fewer than 24 overlap months. The held-out months are picked by a stable hash of region, year and month, so the pipeline is deterministic.

Every monthly value in the calendar carries a source flag (`native` or `calibrated`), the calibration model used (`quantile_map`, `ratio_month`, `log_regression` or `none`) and the satellites that contributed, so the origin of each number can be checked even though the scale is the same throughout.

### Validation numbers

These numbers are copied from the data README. They are statewide results on the held-out overlap months.

- Quantile mapping (chosen): root mean square error (RMSE) 22.2, bias 0.8, seasonality correlation 0.989.
- Monthly ratio: RMSE 91.0, bias -11.8, seasonality correlation 0.945.
- Log regression: RMSE 102.3, bias -11.4, seasonality correlation 0.973.
- Per-region metrics exist for 96 of 98 regions.
- The mean harmonized count was 383.7 for 2009 to 2011 and 366.3 for 2012 to 2014, a change of -4.5%, so the harmonized line shows no step at the 2012 switchover.
- The README reports that the raw VIIRS rise at 2018 and 2023 (more satellites) is removed by the harmonization, and that anomalies show no regime break across the switchover. The README gives plots for these, not numbers.

The README places the per-region metrics in `reports/phase2d_region_metrics.csv`. That file was not delivered with the data, so the per-region values are not reproduced here.

### What is not harmonized

Harmonization applies to the monthly counts only. The detection rows offered in CSV downloads are the filtered raw detections. They are not individually harmonized and still carry the sensor, pixel size and confidence of the original product. There is no daily harmonized series.

## Baselines and anomalies

The app computes baselines at query time from the monthly series of the area you select. It does not use the climatology or anomaly files in the delivery, because their baselines skip years without a row instead of counting them as zero.

- Cells are selected by their centre point (south-west corner plus 0.05 degree in each direction) inside the selected area.
- The series covers every complete month of the record from November 2000. The latest, incomplete month is left out of baselines. Months with no row in the grid are filled with zero cell-days.
- For each calendar month the baseline has the median, the 10th and 90th percentiles, the mean, the standard deviation and the number of years (`n_years`).
- For a month you look at, the app reports the absolute difference from the median, the percent difference, the z-score and the percentile rank.
- Percent difference is empty when the baseline median is zero. The app then shows "no typical fires in this month" with the absolute difference and the percentile rank. It never shows infinity.
- The z-score is empty when the standard deviation is zero.
- The percentile rank is a mid-rank percentile, 100 times (L + 0.5 E) divided by N. L is the number of baseline years with a lower count, E the number with an equal count and N the number of baseline years.
- Counts are rounded to one decimal place and percent values are rounded only when shown. All sums use unrounded values.
- A baseline period you choose must cover 5 to 30 complete years of the record.

## Watch level

The watch level describes the latest complete month for the selected area and is monthly only. It compares the percentile rank of that month, computed as above against the same calendar month in the baseline, with a threshold.

- "Above normal" when the mid-rank percentile is greater than the threshold. The threshold is set in the app configuration, currently 90. DEFAULT (confirm).
- "Within normal range" otherwise.
- "Not available" when the baseline for that calendar month has fewer than 5 years, or when the area has no complete month.
- The provisional latest month is shown next to the result with its count to date. It is never evaluated.

The watch level is an indicator of how unusual a month was in the harmonized record. It is not a fire forecast or a warning.

## Known limitations

- Calibration rests on the MODIS and VIIRS overlap. If the fire regime after 2012 differs structurally from the earlier one, the transfer learned on the overlap is still the best bridge available but remains an assumption.
- Terra and Aqua overpass times drift in later years, and the VIIRS constellation changed in 2018 and 2023. The cell-day unit and the per-region calibration absorb most of this, but residual effects are possible.
- VIIRS (375 m) sees smaller and cooler fires than MODIS (1 km). Harmonization rescales counts but cannot recover fires MODIS never saw, so small fires before 2012 are undercounted relative to the VIIRS era by construction.
- Cloud and smoke hide fires from both sensors. Dense smoke over very large fires can undercount at the peak.
- Near-real-time filtering is approximate, because it uses a static-cell mask and not a per-detection type.
- The latest month is incomplete. It is marked provisional and never plotted as a full month.
- Small areas look noisy after 2012. Quantile mapping can turn small counts into zero.
- Before Aqua started, only Terra provides MODIS coverage. The `provenance` value of each month shows which satellites contributed.
- Validation chose each region's best model on the same held-out months that are used to report errors, so the reported accuracy is slightly optimistic.
- The fixed UTC-8 day convention can place a few detections near local midnight on the adjacent day.

## Deferred items

- Uncertainty intervals for calibrated months are not available. The API and the calendar tooltip carry optional lower and upper bound fields that are empty for now, and the interval line is hidden when they are empty. Filling them needs the calibration holdout error file, which was not delivered.
- A daily harmonized series is not available. The harmonized grid is monthly. Daily values exist only as raw filtered detections.
- A 7-day watch is not implemented. The watch level is monthly only.
- Season timing figures are not part of this release. DEFAULT (confirm) with the team before adding them to the submission.
- A zero-filled climatology of the cells is a possible future task. The app computes baselines at query time instead.

## Unverified facts

- DEFAULT (confirm): the measured grid extent given above replaces the larger extent in the data addendum until the data owner confirms.
- Unverified: whether a state boundary mask was applied to the data.
- Unverified: the start date of Aqua coverage and the launch dates of the satellites. They are not in the delivered documents. Check the NASA FIRMS documentation before quoting them.
- Unverified: the descriptions of the example areas in the app are qualitative and make no claim about fire statistics.
- DEFAULT (confirm): the watch threshold of 90.

## Sources

- `outputs2.0/DATA_README.md`: pipeline, filters, validation numbers and limitations of the delivered data.
- NASA FIRMS (https://firms.modaps.eosdis.nasa.gov/): the origin of the MODIS and VIIRS detections.
- NASA Space Apps Challenge 2026, MODIS and VIIRS Hot Spots: https://www.spaceappschallenge.org/2026/challenges/modis-and-viirs-hot-spots/

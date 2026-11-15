# Demo slides: Emberline: Harmonized Fire Calendar, California region

7 slides, the maximum for the Space Apps demo. Numbers come only from `summary.md` and `outputs2.0/DATA_README.md` (DR). Only built features are shown. Do not show test fixture data as real values: capture screens from the app running on the delivered data.

Deployed URL on slide 7: `<deployed URL: add after deployment>` (DEFAULT (confirm); not yet verified).

---

## Slide 1. The problem

**Title:** Two sensors, one fire record that cannot be compared

- Satellites have tracked active-fire hotspots for more than two decades.
- MODIS (Terra, Aqua) is near the end of its operational life. VIIRS is replacing it.
- The sensors differ in resolution, sensitivity and overpass schedule, so raw counts are not comparable.
- Fire managers lack one consistent picture of when and where burning happened.

**Capture:** Title or home screen of the app (example area loaded, Calendar visible) as backdrop. No numbers needed.

---

## Slide 2. The harmonization idea

**Title:** After harmonization, the sensor of origin no longer matters

- Unit: the cell-day (one 1 km cell with at least one kept detection on a local day).
- VIIRS counts are mapped to a MODIS-equivalent scale, per 1.0 degree region, using the 2012 onward overlap.
- Quantile mapping chosen: statewide holdout RMSE 22.2, bias 0.8, seasonality correlation 0.989 (DR).
- MODIS counts before 2012, calibrated VIIRS counts from 2012.
- No step at the switchover: 2009 to 2011 mean 383.7 cell-days versus 2012 to 2014 mean 366.3, a difference of -4.5 % (DR).

**Capture:** Methods page (the harmonization section). If it has a chart, the yearly totals chart across 2012 from the Trends tab.

---

## Slide 3. The Calendar

**Title:** Which months burn most, which years burned most, how now compares

- Calendar of months by years for the California region, from November 2000.
- Colour ramps for counts, anomalies and month-to-month differences, with accessible palettes.
- Select a cell for details: value, baseline median, anomaly, percentile rank.
- Latest month hatched or labelled provisional.

**Capture:** Calendar tab with an example area and the whole record shown. Then the tooltip or detail panel for one selected cell. Show the colour ramp legend.

---

## Slide 4. Draw an area, download the data

**Title:** Any area of the California region, data you can take away

- Select an area by drawing a rectangle or polygon, entering coordinates, circle, GeoJSON upload, or an example area.
- Choose a date range and, optionally, a baseline period.
- Shareable link stores the area and dates.
- Downloads: hotspot CSV for the search, analytics CSV, chart images (PNG and SVG).

**Capture:** Map with a drawn polygon and the date-range inputs, then the Downloads panel with the CSV option visible.

---

## Slide 5. Key figures and the watch badge

**Title:** Fires detected, anomalies, and how this month compares

- Key figures: fires detected (cell-days) and anomaly against the historical median, with percentile rank.
- Monthly watch badge for the latest complete month: "Above normal" or "Within normal range".
- Season tracker compares the running year with the historical range.
- Also built: yearly totals, seasonal profile, anomaly series, rankings, recent 7-day view (raw counts, not harmonized), comparison mode (two areas or two date ranges, limited).

**Capture:** Key figures cards with the watch badge in view, then the Season tab with the season tracker. Optional: comparison mode with two panels sharing one colour scale.

---

## Slide 6. Limitations and honesty

**Title:** What the numbers are, and are not

- Counts are cell-days, not raw detections.
- Days, months and years use a fixed UTC-8 (no daylight saving).
- The latest month is incomplete and marked provisional, never shown as a full month.
- Hotspot CSV rows are filtered raw detections. Only the monthly counts are harmonized. Every CSV header says so.
- Small fires before 2012 are undercounted. Cloud and smoke reduce detections. Small areas look noisy after 2012.
- 96 of 98 calibration regions have validation metrics. Reported accuracy is slightly optimistic because the model was picked on the same holdout (DC).
- Labelled "California region". No claim that it follows the state boundary.

**Capture:** Methods page limitations section, plus a CSV file opened to show the header notes (units, UTC-8, "raw, not harmonized"). Also the provisional marker on the latest month in the Calendar.

---

## Slide 7. Next steps and try it

**Title:** What is next

- Uncertainty intervals: fields exist but are empty, because the calibration holdout-error file was not delivered.
- Daily harmonized series, fire-season timing metrics and a 7-day watch level: need daily harmonized data, which does not exist.
- Full colour-scale reclassification in comparison mode; per-query filter counts.
- Try it: `<deployed URL: add after deployment>` (DEFAULT (confirm)). Source: `<public repository URL: add before submission>`.
- Data: NASA Earthdata FIRMS, MODIS and VIIRS active fire products.

**Capture:** Calendar screen with an area selected as the closing backdrop, with the URL and repository placeholders as text overlay. Add a NASA FIRMS credit line.

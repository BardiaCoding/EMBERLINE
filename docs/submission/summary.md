# Project summary and details (Space Apps 2026)

Project: Emberline: Harmonized Fire Calendar, California region.
Challenge: [MODIS and VIIRS Hot Spots](https://www.spaceappschallenge.org/2026/challenges/modis-and-viirs-hot-spots/).

> **Length limits: DEFAULT (confirm).** The limits for the summary and details fields on the live
> submission form have not been checked. Check them on the form before pasting. Cut the long
> version down to fit if needed. The short version is about 50 words.

Numbers below come from `data-contract.md` (DC) or `outputs2.0/DATA_README.md` (DR), as marked.
No other statistics are used.

## Short version (about 50 words)

MODIS and VIIRS fire records cannot be compared directly. We built a web app that harmonizes
them into one monthly burning activity calendar for the California region, from November 2000.
Draw an area, see which months and years burned most, compare with the historical median, and
download CSV files.

## Long version

### Problem

Satellites have tracked active-fire hotspots for more than two decades. The record is split
between MODIS (on Terra and Aqua, near the end of its operational life) and VIIRS (its
replacement). The sensors differ in spatial resolution, sensitivity and overpass schedule, so
their counts cannot be compared directly. Fire managers lack one consistent picture of when and
where burning happened. Burning activity here means any fire a satellite can detect: wildfires
and human-caused fires such as agricultural burning and land clearing.

### Solution

A web application with a harmonized burning activity calendar for the **California region**,
November 2000 to the present. The data come from NASA Earthdata FIRMS (MODIS and VIIRS active
fire data).

- **Harmonization (done before this app, documented in the methodology).** Three layers. Layer 1:
  the unit is the cell-day, one 1 km cell with at least one kept detection on a local day,
  counted once per sensor family. Layer 2: VIIRS counts are mapped to a MODIS-equivalent scale with a transfer function
  fitted on the 2012 onward overlap, separately for each 1.0 degree region. Quantile mapping was
  chosen (statewide holdout RMSE 22.2, bias 0.8, seasonality correlation 0.989; DR). Layer 3:
  MODIS counts are used before 2012 and calibrated VIIRS counts from 2012. After this step, the sensor of
  origin no longer matters for the monthly counts.
- **The app.** The user selects an area by drawing on a map, entering coordinates, or picking an
  example area, and chooses a date range. The app shows:
  - the calendar (months by years) with colour ramps for counts, anomalies and month-to-month
    differences, using accessible palettes;
  - key figures: fires detected (cell-days), and anomalies against the historical median,
    with percentile rank;
  - charts: yearly totals, seasonal profile, anomaly series, rankings, and a season tracker that
    compares the running year with the historical range;
  - a monthly watch badge ("Above normal" or "Within normal range") for the latest complete month;
  - a recent view with the last 7 days of raw detection counts;
  - downloads: hotspot CSV for the search, analytics CSV, and chart images (PNG and SVG);
  - shareable links that store the area and dates;
  - a methods page.

### Target users

- Early warning and emergency responders
- Scientists
- Land managers
- Firefighters

### Benefits

- Answers three questions in one place: which periods of the year have more fires, which years
  had more burning, and how current activity compares with the historical median.
- One consistent scale across the sensor change, so a trend is not an artefact of switching
  from MODIS to VIIRS. The harmonized series shows no step at the 2012 switchover (2009 to 2011
  mean 383.7 cell-days versus 2012 to 2014 mean 366.3, a difference of -4.5 %; DR).
- Any area of the California region, not a fixed list of places.
- Data can be taken away: CSV files and chart images, each with a header or caption stating
  units, time convention and method.
- Plain-language help, accessible colours, and a layout that works on narrow screens.

### Tools

Only items listed in `pyproject.toml` and `web/package.json`.

- **Data and API (Python 3.12):** DuckDB (reads the delivered Parquet files), FastAPI, uvicorn,
  pydantic, pyarrow, pandas, numpy, scipy, shapely, PyYAML, huggingface_hub (fetches the data
  files at deploy time).
- **Front end:** React, TypeScript, Vite, MapLibre GL JS (map), Terra Draw (area drawing),
  Apache ECharts (calendar heatmap and charts), TanStack Query, zod, Tailwind CSS, Radix UI
  primitives (shadcn/ui style), lucide-react.
- **Testing and quality:** pytest, Hypothesis, pytest-socket, httpx, ruff; Vitest, fast-check,
  React Testing Library, msw, vitest-axe with axe-core, ESLint, Prettier.
- **Deployment:** one Docker image (FastAPI serving the built front end). DEFAULT (confirm):
  Hugging Face Spaces, with Render or Fly.io as fallback.
- **Data:** NASA Earthdata FIRMS MODIS and VIIRS active fire products. The harmonized monthly
  grid has 89,467 rows over 5,370 cells and the filtered detections table has 2,105,593 rows
  (DC).

### What is built and what is deferred

Built:

- Calendar, area selection (draw, coordinates, circle, GeoJSON upload, example areas), date
  range, custom baseline period, key figures, charts, season tracker, monthly watch badge,
  recent view, hotspot map layer, CSV and analytics downloads, chart export, share links, methods
  page.
- Comparison mode: two areas or two date ranges side by side, with one colour scale shared by
  both panels and an optional per-1000 km2 normalization for areas. It is limited. The shared
  scale is applied to pre-built panels (full reclassification is future work), and area and
  period comparison cannot be combined.
- Baselines, anomalies and rankings are computed at query time from the monthly grid, with
  months that have no activity counted as zero.

Deferred, because the data do not support them:

- **Uncertainty intervals.** The `lower_bound` and `upper_bound` fields exist and are empty. The
  calibration holdout-error file was not delivered, so no interval is shown.
- **Daily harmonized series.** The harmonized grid is monthly only. Daily values exist only as
  raw filtered detections, which are not harmonized. The recent view says "raw, not
  harmonized". A daily chart, fire-season timing metrics and a 7-day watch level are not built.
- Per-query filter counts and a filtered-sources layer.

### Known limitations (in brief)

Full list: README and methodology.

- The calibration assumes the 2012 onward overlap represents the earlier period (DR).
- Terra and Aqua overpass drift and VIIRS constellation changes may leave residual effects (DR).
- Small fires before 2012 are undercounted compared with the VIIRS era (DR).
- Cloud and smoke reduce detections.
- Near-real-time filtering is approximate (a static-cell mask of 211 cells; DC).
- The latest month is incomplete and is marked provisional, never shown as a full month.
- Small areas look noisy after 2012, because quantile mapping can turn small counts into zero.
- Before Aqua started, only Terra provides coverage.
- 96 of 98 calibration regions have validation metrics. The best model was picked on the same
  holdout used to report errors, so the reported accuracy is slightly optimistic (DC).
- Hotspot CSV rows are filtered raw detections. Only the monthly counts are harmonized.
- Days, months and years use a fixed UTC-8 (no daylight saving).
- The region is labelled "California region". The app makes no claim that it follows the state
  boundary.

### How to try it

- **Deployed app:** `<deployed URL: add after deployment>` (DEFAULT (confirm); not yet verified).
- Open it, pick an example area or draw a rectangle or polygon on the map, then read the
  Calendar. Select a cell for details, open the Trends and Season tabs, and use Downloads for
  the CSV.
- **Run locally** (needs Docker and the data files in `outputs2.0/`, which are not in the
  repository):
  ```sh
  make run-image
  ```
  Then open <http://localhost:7860>. Development setup is in the README.
- **Source:** `<public repository URL: add before submission>`.

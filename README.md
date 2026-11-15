---
title: "Emberline: Harmonized Fire Calendar"
emoji: 🔥
colorFrom: red
colorTo: yellow
sdk: docker
app_port: 7860
pinned: false
---

# Emberline: Harmonized Fire Calendar (California region)

A web application for the NASA Space Apps Challenge 2026 challenge
[MODIS and VIIRS Hot Spots](https://www.spaceappschallenge.org/2026/challenges/modis-and-viirs-hot-spots/).

## Purpose

Satellites have tracked active-fire hotspots for more than two decades. The record is split
between MODIS (Terra and Aqua, near the end of its operational life) and VIIRS (its replacement).
The two sensors differ in resolution, sensitivity and overpass schedule, so their counts cannot be
compared directly.

This app shows one harmonized burning activity calendar for the **California region**, from
November 2000 to the present. VIIRS counts are mapped to a MODIS-equivalent scale, so the sensor
of origin no longer matters when you read the calendar. You choose an area and a date range, see
which months and years had more burning, and compare the current period with the historical
median.

Data come from NASA Earthdata [FIRMS](https://firms.modaps.eosdis.nasa.gov/) (MODIS and VIIRS
active-fire data). The app reads delivered, fixed data files. It does not call FIRMS and needs no
FIRMS key.

## Features

- **Burning activity calendar.** Year by month grid of harmonized counts. Three views: counts,
  anomaly against the baseline median, and month-to-month difference. Accessible colour palettes.
  A table view shows the same values. Select a cell for details.
- **Area selection.** Draw a rectangle or polygon on the map, enter west, south, east and north
  coordinates, enter a circle (centre and radius), upload GeoJSON, or pick a configured example
  area.
- **Date range.** Presets and custom ranges. A custom baseline period (5 to 30 complete years) is
  supported.
- **Key figures.** Totals, current month and year against the baseline, anomalies (absolute,
  percent, z-score, percentile rank), and top-10 month and year rankings.
- **Charts.** Yearly bars with the baseline median, seasonal profile, monthly anomaly series.
  Export as PNG or SVG.
- **Season tracker.** Cumulative monthly counts for a season year against a p10 to p90 envelope.
- **Recent tab.** Raw filtered detections for the last 7 local days (not harmonized), plus a
  monthly watch badge ("Above normal" or "Within normal range") for the latest complete month.
- **Comparison mode.** Two areas or two date ranges side by side on one colour scale.
- **Map layer.** Raw filtered detections (labelled "not harmonized") or a cell-day density.
- **Downloads.** Hotspot CSV (with a row and size estimate before download) and analytics CSV.
- **Shareable URL.** Area, dates and view are stored in the URL.
- **Methods page** at `/methods`, with light and dark themes and a responsive layout.

Not built, because the delivered data does not support it:

- Uncertainty intervals (Requirement 7) are deferred. The API fields `lower_bound` and
  `upper_bound` exist and are always null, and the interval line is hidden.
- Fire-season timing metrics are not available.
- There is no daily harmonized series. Harmonized counts are monthly only. Daily values exist
  only as raw filtered detections.

## Region, units and time

- **Region label:** "California region". The app makes no claim about whether the data follow
  the state boundary. Do not read it as "California state".
- **Counting unit:** cell-days. One cell-day is one 1 km cell with at least one kept detection
  on a local day, counted once per sensor family. Counts are cell-days, not raw detections. The
  scale is MODIS-equivalent. Coordinates are EPSG:4326.
- **Time convention:** days, months and years use a fixed local standard time of UTC-8 (PST, no
  daylight saving). `acq_datetime_utc` in the CSV keeps the true UTC time.
- **Hotspot CSV rows are filtered raw detections.** They are not individually harmonized.
  Harmonization applies only to the monthly cell-day counts, so CSV rows and calendar counts do
  not reconcile.

## Setup

Requires Python 3.12 with [uv](https://docs.astral.sh/uv/) and Node 20.19 or newer.

```sh
uv sync
cd web && npm install
```

`make install` runs both.

## Data

The data files are not in git. `outputs2.0/` is in `.gitignore` and `.dockerignore`, and the
container image does not contain them.

Put the delivered files in `outputs2.0/` at the repository root:

- `harmonized_monthly_grid.parquet`
- `detections_harmonized.parquet`

The folder is set by `data_dir` in `config/app.yaml`. Method and validation numbers are in
`outputs2.0/DATA_README.md`. The data pipeline (acquisition, filtering, calibration,
harmonization, validation) was run outside this repository. Its code, `reports/` folder and plots
are not part of this repository. The method has three layers: cell-days, per-region calibration
of VIIRS to a MODIS-equivalent scale, and stitching at 2012 (see `docs/methodology.md`).

Check that the files match the data contract (columns, types, row counts, extent):

```sh
uv run python -m hotspots.data.check
```

It prints pass or fail for each check and exits non-zero on any mismatch.

## Run for development

Run each in its own terminal. Both are long-running.

```sh
uv run uvicorn hotspots.api.main:app --reload   # API on http://127.0.0.1:8000
cd web && npm run dev                           # front end, proxies /api to the API
```

Make targets: `make api` and `make web-dev`.

## Tests and checks

```sh
uv run pytest
cd web && npx vitest --run
```

`make test` runs both. Tests use synthetic fixtures labelled "TEST FIXTURE, not NASA data". They
need no network. Tests marked `delivered` read the real files and are skipped when `outputs2.0/`
is absent.

Lint and type check:

```sh
uv run ruff check .
uv run ruff format --check .
cd web && npm run lint
cd web && npm run typecheck
```

`make lint` runs the first three.

## Deployment

**Deployed URL:** DEFAULT (confirm) `<deployed URL not yet known>`. Replace this line when the
team confirms the live address. Planned host: Hugging Face Spaces (Docker). Fallbacks: Render or
Fly.io, then the local container run below.

Check a running instance (without cookies, against any base URL):

```sh
uv run python -m hotspots.smoke <base_url>
```

### Local container run

Requires Docker and the data files in `outputs2.0/`. Two commands:

```sh
docker build -t hotspots .
docker run --rm -p 7860:7860 -v "$PWD/outputs2.0:/app/outputs2.0:ro" hotspots
```

Then open <http://localhost:7860>. `make run-image` does the same.

If the data files are missing, the app still starts and reports "data unavailable". The health
endpoint `/api/health` then answers 503.

### Hugging Face Spaces

1. Create a Docker Space and push this repository to it. The YAML header at the top of this file
   sets `sdk: docker` and `app_port: 7860`.
2. Upload the two Parquet files to a Hugging Face dataset repo (private or public).
3. In the Space settings, set the variable `HF_DATASET_REPO` and the secret `HF_TOKEN`.
4. At container start, `hotspots.bootstrap` downloads the two files into the data folder when
   they are missing, then checks them against the data contract. If the download fails, the app
   starts in the "data unavailable" state.

### Configuration

| Variable              | Used for                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| `HOTSPOTS_CONFIG`     | Path of the YAML config file (default `config/app.yaml`; `/app/config/app.yaml` in the image). |
| `HOTSPOTS_STATIC_DIR` | Folder with the built front end (`/app/static` in the image).                                  |
| `PORT`                | Port the server listens on (default `7860`).                                                   |
| `HF_DATASET_REPO`     | Hugging Face dataset repo that holds the two Parquet files.                                    |
| `HF_TOKEN`            | Token for that repo. Set it as a Space secret or in an untracked `.env`. Never commit it.      |
| `HOTSPOTS_SHARE_DB`   | Optional SQLite file for short share links. Without it, long areas are simplified.             |

Copy `.env.example` to `.env` for local use. The image never contains `.env` or any secret.

## Methodology

See [docs/methodology.md](docs/methodology.md). In short: VIIRS counts are mapped to
MODIS-equivalent with a transfer function fitted on the 2012 onward overlap, per 1.0 degree
region (quantile mapping, with the best model per region and a statewide fallback for data-poor
regions). Baselines and anomalies are computed at query time from the zero-filled monthly grid.

## Known limitations

- Calibration assumes the overlap period represents the earlier regime.
- Terra and Aqua overpass drift and VIIRS constellation changes may leave residual effects.
- Pre-2012 small fires are undercounted relative to the VIIRS era.
- Cloud and smoke reduce detections.
- Near-real-time filtering is approximate.
- The latest month is incomplete. It is marked provisional and never plotted as a full month.
- Small areas look noisy after 2012: quantile mapping can turn small counts into zero.
- Before Aqua started, only Terra provides coverage (check the `provenance` column).
- 96 of 98 regions have validation metrics.
- Validation picked each region's best model on the same holdout used to report errors, so
  reported accuracy is slightly optimistic.

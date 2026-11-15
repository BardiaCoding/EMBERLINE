# Product

NASA Space Apps Challenge 2026 project for the challenge "MODIS and VIIRS Hot Spots".
Challenge page: https://www.spaceappschallenge.org/2026/challenges/modis-and-viirs-hot-spots/

## Working rule for open decisions
Where a decision is open, propose a sensible default, state it clearly, and flag it for the team to confirm. Do not block progress waiting for an answer. Mark such items `DEFAULT (confirm)` in docs and code comments. Facts taken from outside the challenge text must cite a source or be marked unverified.

## Problem
Satellites have tracked active-fire hotspots for more than two decades. The record is split across sensors whose data cannot be compared directly, so fire managers lack a consistent picture of when and where burning occurred.

- MODIS, on Terra and Aqua, provides more than two decades of observations and is near the end of its operational life.
- VIIRS is replacing MODIS and gives continuity and greater detail.
- The two differ in spatial resolution, sensitivity and observation schedule, so their records need harmonization before comparison.

Burning activity covers wildfires and human-caused fires (agriculture, land-clearing, waste disposal, industry), limited to fires intense enough for satellites to detect.

## Objective
A web application with a harmonized burning activity calendar: one consistent time series of hotspot activity from the early 2000s to the present, combining the MODIS history with VIIRS.

## Target users
Early warning and emergency responders, scientists, land managers and firefighters.

## Data source
NASA Earthdata FIRMS (the challenge's listed resource): MODIS and VIIRS active fire / hotspot data.

## Scope
All features below are in scope (team decision). Priority order, if time runs short: core first, then the rest.

### Core
1. **Harmonization:** after this step the sensor of origin no longer matters.
2. **Web application:** select a region and date range, view and download analytics and visualizations.
3. **Burning activity calendar:** hotspot counts by month and year, answering which periods of the year have more fires, which years had more burning, and how current activity compares with the historical median.

### Also in scope (challenge "may/could/consider" items)
- Color ramps for month-to-month differences, using accessible palettes.
- Downloadable CSV of the hotspots in a search.
- Area selection by drawing on a map or entering latitude and longitude.
- Key figures: anomalies against multi-year averages, number of fires detected.

Extra and differentiating features are specified in the requirements spec.

## Decisions
| Topic | Decision |
|---|---|
| Deadline | Sunday 15 November 2026, 11:59 PM local time. Prioritize a working, submitted result. |
| Coverage | California region (see `data-contract.md` for the measured extent). Record from November 2000. |
| Data products | Delivered, fixed outputs (monthly harmonized grid and filtered detections). See `data-contract.md`. |
| Filtering | Already applied in the delivered data (low confidence and static sources). Do not reapply. |
| Harmonization method | Done externally: per-region quantile mapping of VIIRS to MODIS-equivalent. See `data-contract.md`. |
| Optional features | All of them. |
| Hosting | Deployed online if possible, otherwise local. |
| Stack | See `tech.md`. |
| Deliverables | See "Submission deliverables" below. DEFAULT (confirm against the Space Apps submission guide). |

## Plan
1. **Data acquisition:** completed externally.
2. **Harmonization:** completed externally (validation numbers in `DATA_README.md`).
3. **Aggregation:** counts by area, month and year, with baselines (median, mean, percentiles) and anomalies.
4. **Web application:** area and date-range inputs, the calendar, comparisons, figures, downloads.
5. **Submission:** package for Space Apps judging.

## Submission deliverables (DEFAULT, confirm)
Based on the Space Apps judging guide (demo is a slide deck of at most 7 slides or a video of at most 30 seconds) and a Space Apps discussion post listing the submission parts. Not verified against the live submission form.
- Deployed app URL (or local run instructions as fallback).
- Public GitHub repository with README.
- Demo: 30-second video and/or 7-slide deck.
- Project summary and details text.
- Methodology document (harmonization and validation).
- List of NASA data used and other references.

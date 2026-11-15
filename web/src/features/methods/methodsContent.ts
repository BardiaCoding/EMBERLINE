// Static content of the methods page. The numbers are copied from outputs2.0/DATA_README.md
// (build date 2026-11-14); do not recompute or round them. The method narrative is in
// docs/methodology.md. Wording follows data-contract.md: "California region", no claim
// about a state boundary mask.
import { CRS_LABEL, REGION_LABEL, UNIT_CELL_DAYS } from '@/lib/format'

/** Build date of the delivered data files (DATA_README.md). */
export const DATA_BUILD_DATE = '2026-11-14'

export type ModelRow = {
  model: string
  rmse: string
  bias: string
  seasonalityCorrelation: string
  chosen: boolean
}

/** Candidate transfer models on the held-out 25 % of overlap months, all regions pooled. */
export const MODEL_COMPARISON: readonly ModelRow[] = [
  {
    model: 'ratio_month',
    rmse: '91.0',
    bias: '-11.8',
    seasonalityCorrelation: '0.945',
    chosen: false,
  },
  {
    model: 'quantile_map',
    rmse: '22.2',
    bias: '0.8',
    seasonalityCorrelation: '0.989',
    chosen: true,
  },
  {
    model: 'log_regression',
    rmse: '102.3',
    bias: '-11.4',
    seasonalityCorrelation: '0.973',
    chosen: false,
  },
]

export const VALIDATION = {
  rmse: '22.2',
  bias: '0.8',
  seasonalityCorrelation: '0.989',
  meanBefore: '383.7',
  meanAfter: '366.3',
  changePercent: '-4.5%',
  regionsWithMetrics: 96,
  regionsTotal: 98,
  fallbackRegions: 13,
  minOverlapMonths: 24,
} as const

export const REGION_AND_RECORD = [
  `The data cover the ${REGION_LABEL}. The app makes no claim about whether the data were clipped to a state boundary.`,
  'The record starts in November 2000. MODIS-native counts cover 2000 to 2011 and calibrated VIIRS counts cover 2012 onward, all on the MODIS-equivalent scale.',
  `Coordinates are latitude and longitude in ${CRS_LABEL}. Monthly cells are 0.1 degree display cells.`,
] as const

export const TIME_CONVENTION_TEXT = [
  'Days, months and years use local standard time at a fixed UTC-8 (PST), with no daylight saving time.',
  'The column acq_datetime_utc in the detection table keeps the true UTC time.',
  'With a fixed offset, a detection within about one hour of local midnight in summer can fall on the adjacent day. The effect is negligible in monthly counts.',
] as const

export const COUNTING_UNIT_TEXT = [
  `Counts are in ${UNIT_CELL_DAYS}. One cell-day is one 1 km cell with at least one kept detection on a local day, counted once per sensor family.`,
  'A cell-day is not a raw detection. Raw MODIS and raw VIIRS cell-day counts are shown separately and are never added together.',
] as const

export const HARMONIZATION_SCOPE_TEXT = [
  'Harmonization applies to the monthly counts only.',
  'The rows in the hotspot CSV download are raw filtered detections. They are not individually harmonized.',
] as const

export const FILTERS_TEXT = [
  'These filters were applied before the data were delivered. The app does not apply or change them.',
  'Low-confidence detections were dropped.',
  'Only type 0 detections (vegetation or other fire) were kept. Volcano, other static land and offshore detections were dropped.',
  'Near-real-time rows have no type column. They were filtered with a mask of 211 persistent static-source cells, which is approximate.',
] as const

/** Known limitations (data-contract.md and DATA_README.md). */
export const LIMITATIONS: readonly string[] = [
  'Calibration assumes the overlap period represents the earlier regime. If the fire regime after 2012 differs structurally from before, the transfer is the best available bridge but remains an assumption.',
  'Terra and Aqua overpass times drift in later years, and the VIIRS constellation changed in 2018 and 2023. The cell-day unit and the per-region calibration absorb most of this, but residual effects are possible.',
  'Pre-2012 small fires are undercounted relative to the VIIRS era. VIIRS resolves smaller and cooler fires than MODIS, and harmonization cannot recover fires MODIS never saw.',
  'Cloud and smoke reduce detections for both sensors. Dense smoke over very large fires can undercount at the peak.',
  'Near-real-time filtering is approximate. It uses a static-cell mask, not a per-detection type, and near-real-time data use a different processing version than the standard product.',
  'The latest month is incomplete and provisional. It is never plotted as a full month.',
  'Small areas look noisy after 2012: quantile mapping can turn small counts into zero.',
  'Before Aqua started, only Terra provides coverage. The provenance of each month shows which satellites contributed.',
  `${String(VALIDATION.regionsWithMetrics)} of ${String(VALIDATION.regionsTotal)} regions have validation metrics.`,
  'The best model for each region was picked on the same holdout used to report errors, so the reported accuracy is slightly optimistic.',
]

export const DATA_SOURCE_TEXT = [
  'The data come from NASA FIRMS (Fire Information for Resource Management System): MODIS active-fire detections from Terra and Aqua, and VIIRS 375 m active-fire detections from Suomi NPP, NOAA-20 and NOAA-21.',
  'The data were downloaded and harmonized outside this app. The app reads the delivered files and does not run acquisition, calibration or harmonization. The pipeline is described in the data README delivered with the data (outputs2.0/DATA_README.md).',
] as const

export const FIRMS_URL = 'https://firms.modaps.eosdis.nasa.gov/'

/**
 * Acknowledgement text. DEFAULT (confirm): wording follows NASA's usual FIRMS acknowledgement
 * and has not been checked against the current FIRMS citation page.
 */
export const CITATION_TEXT =
  "We acknowledge the use of data and/or imagery from NASA's Fire Information for Resource Management System (FIRMS), part of NASA's Earth Science Data and Information System (ESDIS)."

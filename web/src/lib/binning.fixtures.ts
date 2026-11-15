import type { CalendarOut, CoverageOut, MonthOut } from '@/lib/api'

// Synthetic values for tests of the Calendar. TEST FIXTURE, not NASA data. Never shown in the app.

/** A month of the API result with harmonized count `harmonized`. */
export function month(
  year: number,
  m: number,
  harmonized: number,
  extra: Partial<MonthOut> = {},
): MonthOut {
  return {
    year,
    month: m,
    harmonized,
    raw_modis: 0,
    raw_viirs: 0,
    frp_sum_mw: null,
    source_flag: year < 2012 ? 'native' : 'calibrated',
    calib_model: year < 2012 ? 'none' : 'quantile_map',
    provenance: 'TEST FIXTURE',
    provisional: false,
    lower_bound: null,
    upper_bound: null,
    anomaly: null,
    ...extra,
  }
}

/** The anomaly of a month of the API result. `percent` null means the baseline median is 0. */
export function anomaly(
  absolute: number,
  percent: number | null,
  extra: Partial<NonNullable<MonthOut['anomaly']>> = {},
): NonNullable<MonthOut['anomaly']> {
  return {
    absolute,
    percent,
    percent_text: percent === null ? 'no typical fires in this month' : null,
    zscore: 0.5,
    percentile_rank: 60,
    baseline_start_year: 2000,
    baseline_end_year: 2025,
    n_years: 20,
    ...extra,
  }
}

/** Coverage of a result with no months. */
export function coverage(extra: Partial<CoverageOut> = {}): CoverageOut {
  return {
    first_month: null,
    last_month: null,
    n_months: 0,
    requested_start: null,
    requested_end: null,
    starts_mid_month: false,
    ends_mid_month: false,
    before_record: false,
    after_latest: false,
    ...extra,
  }
}

/** A Calendar result with baseline medians 10 to 21 for January to December. */
export function result(months: MonthOut[], provisional: string[] = []): CalendarOut {
  return {
    months,
    years: [],
    baseline_by_month: Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      median: 10 + i,
      p10: 1,
      p90: 50,
      mean: 12,
      std: 3,
      n_years: 20,
    })),
    baseline_year: null,
    coverage: coverage(),
    n_cells: 5,
    notice: null,
    provisional_months: provisional,
    clipped_percent: null,
    area_km2: null,
  }
}

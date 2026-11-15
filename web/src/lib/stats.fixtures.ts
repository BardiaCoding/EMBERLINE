import type { CurrentMonthOut, CurrentYearOut, StatsOut, YearOut } from '@/lib/api'
import { anomaly, coverage } from '@/lib/binning.fixtures'

// Synthetic values for tests of the key figures and charts. TEST FIXTURE, not NASA data.
// Never shown in the app.

/** A `/stats` result with plausible empty defaults. Override any field. */
export function statsResult(extra: Partial<StatsOut> = {}): StatsOut {
  return {
    summary: {
      total_harmonized: 0,
      raw_modis: 0,
      raw_viirs: 0,
      frp_sum_mw: null,
      n_months: 0,
      includes_provisional: false,
    },
    current_month: null,
    current_year: null,
    top_months: [],
    top_years: [],
    seasonal_profile: Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      median: 10 + i,
      p10: 1,
      p90: 50,
      n_years: 20,
    })),
    briefing_inputs: {
      latest_complete: null,
      latest_complete_harmonized: null,
      short_record: false,
      record_rank: null,
      year_to_date: null,
      peak_months: [],
      baseline_all_zero: false,
      provisional_months: [],
    },
    watch: null,
    coverage: coverage(),
    n_cells: 5,
    notice: null,
    provisional_months: [],
    clipped_percent: null,
    ...extra,
  }
}

/** A year of the Calendar result. */
export function yearRow(year: number, harmonized: number, extra: Partial<YearOut> = {}): YearOut {
  return {
    year,
    harmonized,
    raw_modis: 0,
    raw_viirs: 0,
    frp_sum_mw: null,
    n_months: 12,
    provisional: false,
    anomaly: null,
    ...extra,
  }
}

/** One calendar month of the seasonal profile: median `median`, band 1 to 50. */
export function seasonalPoint(month: number, median: number): StatsOut['seasonal_profile'][number] {
  return { month, median, p10: 1, p90: 50, n_years: 20 }
}

export function currentMonth(extra: Partial<CurrentMonthOut> = {}): CurrentMonthOut {
  return {
    year: 2003,
    month: 12,
    harmonized: 33,
    provisional: false,
    baseline_median: 21,
    baseline_n_years: 20,
    anomaly: anomaly(12, 57.1, { percentile_rank: 80 }),
    ...extra,
  }
}

export function currentYear(extra: Partial<CurrentYearOut> = {}): CurrentYearOut {
  return {
    year: 2003,
    harmonized: 400,
    n_months: 12,
    provisional: false,
    baseline_median: 350,
    baseline_n_years: 20,
    percentile_rank: 65,
    anomaly: anomaly(50, 14.3, { percentile_rank: 65 }),
    ...extra,
  }
}

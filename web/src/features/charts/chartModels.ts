import type { BaselineOut, MonthOut, SeasonalPointOut, YearOut } from '@/lib/api'
import {
  formatCount,
  formatMonth,
  formatSignedCount,
  MISSING,
  monthName,
  TIME_CONVENTION,
  UNIT_CELL_DAYS,
} from '@/lib/format'

// Chart data models (requirements 16.2 to 16.5, 27.3). Pure functions, no I/O and no
// ECharts, so they can be tested without a canvas. Counts are cell-days (MODIS-equivalent).
// Days, months and years use local standard time, UTC-8. A provisional month or year is
// marked and never drawn as a full one.

const MONTHS_PER_YEAR = 12

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

// --- yearly bars (16.2) --------------------------------------------------------------------

export type YearlyBar = {
  year: number
  /** Axis label: the year, with "(provisional)" or the month count for an incomplete year. */
  label: string
  harmonized: number
  /** Months of the year inside the Date_Range, null when the API did not say. */
  nMonths: number | null
  /** The year holds the provisional month, so its total is a count to date. */
  provisional: boolean
  /** Fewer than 12 months inside the Date_Range and not provisional. */
  partial: boolean
}

export type YearlyBarsModel = {
  bars: YearlyBar[]
  /** Median of the baseline yearly totals, or null when there is no baseline. */
  baselineMedian: number | null
  baselineNYears: number
}

export function yearLabel(year: number, provisional: boolean, nMonths: number | null): string {
  if (provisional) return `${year} (provisional)`
  if (nMonths !== null && nMonths < MONTHS_PER_YEAR) return `${year} (${nMonths} mo.)`
  return String(year)
}

/** One bar per calendar year of the result, oldest first, with the baseline yearly median. */
export function buildYearlyBars(result: {
  years: YearOut[]
  baseline_year: { median: number; n_years: number } | null
}): YearlyBarsModel {
  const bars = [...result.years]
    .sort((a, b) => a.year - b.year)
    .map<YearlyBar>((y) => {
      const nMonths = y.n_months
      return {
        year: y.year,
        label: yearLabel(y.year, y.provisional, nMonths),
        harmonized: y.harmonized,
        nMonths,
        provisional: y.provisional,
        partial: !y.provisional && nMonths !== null && nMonths < MONTHS_PER_YEAR,
      }
    })
  const base = result.baseline_year
  return {
    bars,
    baselineMedian: base !== null && base.n_years > 0 ? base.median : null,
    baselineNYears: base?.n_years ?? 0,
  }
}

/** Sum of the bar values, rounded to one decimal. Equals the summary total (requirement 16.10). */
export function sumBars(bars: readonly YearlyBar[]): number {
  return round1(bars.reduce((sum, b) => sum + b.harmonized, 0))
}

/** Total harmonized count of a Calendar result: the sum of its yearly totals, to one decimal. */
export function calendarTotal(result: { years: readonly Pick<YearOut, 'harmonized'>[] }): number {
  return round1(result.years.reduce((sum, y) => sum + y.harmonized, 0))
}

// --- seasonal profile (16.3) ---------------------------------------------------------------

export type SeasonalPoint = {
  month: number
  /** Three-letter month name. */
  label: string
  median: number | null
  p10: number | null
  p90: number | null
  nYears: number
  /** Harmonized count of the selected year, null when the month is not in the result. */
  selected: number | null
  /** The selected-year value is the provisional month's count to date. */
  selectedProvisional: boolean
}

export type SeasonalModel = {
  year: number
  points: SeasonalPoint[]
}

/** Years of the result, oldest first. */
export function yearsOf(months: readonly Pick<MonthOut, 'year'>[]): number[] {
  return [...new Set(months.map((m) => m.year))].sort((a, b) => a - b)
}

/**
 * The year shown over the baseline: the year that contains the end of the Date_Range, or the
 * newest year of the result when the end year is not in it (requirement 16.3).
 */
export function defaultSelectedYear(endDate: string, years: readonly number[]): number | null {
  const endYear = Number(endDate.slice(0, 4))
  if (years.includes(endYear)) return endYear
  return years.length === 0 ? null : (years[years.length - 1] ?? null)
}

export function buildSeasonalModel(
  profile: readonly SeasonalPointOut[],
  months: readonly MonthOut[],
  year: number,
): SeasonalModel {
  const points = Array.from({ length: MONTHS_PER_YEAR }, (_, i): SeasonalPoint => {
    const month = i + 1
    const base = profile.find((p) => p.month === month)
    const row = months.find((m) => m.year === year && m.month === month)
    return {
      month,
      label: monthName(month).slice(0, 3),
      median: base?.median ?? null,
      p10: base?.p10 ?? null,
      p90: base?.p90 ?? null,
      nYears: base?.n_years ?? 0,
      selected: row?.harmonized ?? null,
      selectedProvisional: row?.provisional ?? false,
    }
  })
  return { year, points }
}

// --- anomaly series (16.4) -----------------------------------------------------------------

export type AnomalyPoint = {
  /** `YYYY-MM`. */
  key: string
  /** Axis label, for example `Jul 2002`. */
  label: string
  year: number
  month: number
  harmonized: number
  provisional: boolean
  /** Harmonized count minus the baseline median of the same calendar month, null when none. */
  vsMedian: number | null
  /** Harmonized count minus the baseline mean of the same calendar month, null when none. */
  vsMean: number | null
}

/**
 * Absolute anomaly of every month against the baseline median and the baseline mean of its
 * calendar month. The provisional month has no anomaly (it is not evaluated against the
 * baseline), so both values are null and the series shows a gap.
 */
export function buildAnomalySeries(result: {
  months: readonly MonthOut[]
  baseline_by_month: readonly Pick<BaselineOut, 'month' | 'mean' | 'n_years'>[]
}): AnomalyPoint[] {
  return [...result.months]
    .sort((a, b) => a.year - b.year || a.month - b.month)
    .map((m): AnomalyPoint => {
      const base = result.baseline_by_month.find((b) => b.month === m.month)
      const evaluated = !m.provisional
      const vsMedian = evaluated && m.anomaly !== null ? round1(m.anomaly.absolute) : null
      const vsMean =
        evaluated && base !== undefined && base.n_years > 0
          ? round1(m.harmonized - base.mean)
          : null
      return {
        key: `${String(m.year).padStart(4, '0')}-${String(m.month).padStart(2, '0')}`,
        label: `${monthName(m.month).slice(0, 3)} ${m.year}`,
        year: m.year,
        month: m.month,
        harmonized: m.harmonized,
        provisional: m.provisional,
        vsMedian,
        vsMean,
      }
    })
}

// --- text summary (27.3) -------------------------------------------------------------------

export type PeakMonth = { year: number; month: number; harmonized: number }

/**
 * The complete month with the highest harmonized count, earlier month first on a tie. The
 * provisional month is left out (as in the rankings). Null when no month has a count above 0.
 */
export function peakMonth(months: readonly MonthOut[]): PeakMonth | null {
  let best: PeakMonth | null = null
  // Oldest first, and only a strictly larger count replaces the best, so a tie keeps the earlier month.
  const ordered = [...months].sort((a, b) => a.year - b.year || a.month - b.month)
  for (const m of ordered) {
    if (m.provisional || m.harmonized <= 0) continue
    if (best === null || m.harmonized > best.harmonized) {
      best = { year: m.year, month: m.month, harmonized: m.harmonized }
    }
  }
  return best
}

export type ChartDescriptionInput = {
  /** What the chart shows, for example `Yearly harmonized totals`. */
  variable: string
  /** Name or description of the Selection_Area. */
  area: string
  start: string
  end: string
  /** Total harmonized count over the Date_Range, or null while it is not known. */
  total: number | null
  peak: PeakMonth | null
  /** Extra sentences, for example the provisional-month note. */
  notes?: readonly string[]
}

/**
 * Text label of a chart for assistive technology (requirement 27.3): the variable, the unit,
 * the area, the Date_Range, the total harmonized count and the month with the highest count.
 */
export function describeChart(input: ChartDescriptionInput): string {
  const total = input.total === null ? MISSING : `${formatCount(input.total)} ${UNIT_CELL_DAYS}`
  const peak =
    input.peak === null
      ? 'Highest month: none with detected fires.'
      : `Highest month: ${formatMonth(input.peak.year, input.peak.month)} with ${formatCount(input.peak.harmonized)} ${UNIT_CELL_DAYS}.`
  return [
    `${input.variable}.`,
    `Unit: ${UNIT_CELL_DAYS}.`,
    `Area: ${input.area}.`,
    `Date range: ${input.start} to ${input.end} (${TIME_CONVENTION}).`,
    `Total harmonized count: ${total}.`,
    peak,
    ...(input.notes ?? []),
  ].join(' ')
}

/** Signed text of an anomaly value for tables and tooltips, or a dash when there is none. */
export function signedOrDash(value: number | null): string {
  return value === null ? MISSING : formatSignedCount(value)
}

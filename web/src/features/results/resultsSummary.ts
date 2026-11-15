import type { CalendarOut } from '@/lib/api'

// Totals over the months of one Calendar result. Pure functions, no I/O.

export type SummaryTotals = {
  /** Harmonized cell-days (MODIS-equivalent), summed over the months in the result. */
  harmonized: number
  /** Raw MODIS cell-days. Never added to `rawViirs`. */
  rawModis: number
  /** Raw VIIRS cell-days. Never added to `rawModis`. */
  rawViirs: number
  /** `YYYY-MM` of every provisional month whose count to date is inside the totals. */
  provisionalMonths: string[]
}

function yearMonth(year: number, month: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
}

export function summaryTotals(result: Pick<CalendarOut, 'months'>): SummaryTotals {
  let harmonized = 0
  let rawModis = 0
  let rawViirs = 0
  const provisionalMonths: string[] = []
  for (const m of result.months) {
    harmonized += m.harmonized
    rawModis += m.raw_modis
    rawViirs += m.raw_viirs
    if (m.provisional) provisionalMonths.push(yearMonth(m.year, m.month))
  }
  return { harmonized, rawModis, rawViirs, provisionalMonths }
}

/** True when the Query holds zero cell-days (requirements 16.9, 26.4). */
export function isEmptyResult(result: Pick<CalendarOut, 'months'>): boolean {
  const t = summaryTotals(result)
  return t.harmonized === 0 && t.rawModis === 0 && t.rawViirs === 0
}

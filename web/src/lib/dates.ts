// Date_Range logic. Pure functions, no I/O, no browser clock (requirements 14.1 to 14.3,
// 14.7, 14.8, 14.9, 14.12). Dates are `YYYY-MM-DD` strings in local standard time at a
// fixed UTC-8. Presets come from the latest month the API reports, never from `Date.now()`.
import { formatMonthLabel, isRealDate, TIME_CONVENTION } from './format'

/** A date range, both ends inclusive, as `YYYY-MM-DD`. */
export type DateRange = { start: string; end: string }

/** The available record: first and last day, both inclusive. */
export type DateRecord = { first: string; last: string }

export type PresetId = 'this-year' | 'last-5-years' | 'full-record' | 'last-7-days' | 'last-30-days'

/** Presets that set the whole-month range of the Calendar and the statistics. */
export const CALENDAR_PRESETS = ['this-year', 'last-5-years', 'full-record'] as const
/** Presets for the Recent view and the hotspot CSV only (exact local dates). */
export const EXACT_PRESETS = ['last-7-days', 'last-30-days'] as const

export const PRESET_LABELS: Record<PresetId, string> = {
  'this-year': 'This year',
  'last-5-years': 'Last 5 years',
  'full-record': 'Full record',
  'last-7-days': 'Last 7 days',
  'last-30-days': 'Last 30 days',
}

const DAY_MS = 86_400_000

const pad = (n: number, width = 2): string => String(n).padStart(width, '0')

function toIso(date: Date): string {
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

function parseIso(iso: string): { y: number; m: number; d: number } {
  return { y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)), d: Number(iso.slice(8, 10)) }
}

/** Number of days in month `m` (1 to 12) of year `y`. */
function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** Last day of a `YYYY-MM` month as `YYYY-MM-DD`. */
export function lastDayOfMonth(yearMonth: string): string {
  const y = Number(yearMonth.slice(0, 4))
  const m = Number(yearMonth.slice(5, 7))
  return `${pad(y, 4)}-${pad(m)}-${pad(daysInMonth(y, m))}`
}

/** First day of a `YYYY-MM` month as `YYYY-MM-DD`. */
export function firstDayOfMonth(yearMonth: string): string {
  return `${yearMonth.slice(0, 7)}-01`
}

/** `iso` moved by a whole number of days. */
export function addDays(iso: string, days: number): string {
  const { y, m, d } = parseIso(iso)
  return toIso(new Date(Date.UTC(y, m - 1, d) + days * DAY_MS))
}

/** First day of the month `months` before the month of `iso`. */
function firstDayMonthsBefore(iso: string, months: number): string {
  const { y, m } = parseIso(iso)
  const index = y * 12 + (m - 1) - months
  return `${pad(Math.floor(index / 12), 4)}-${pad((index % 12) + 1)}-01`
}

/** Calendar month of a date as `YYYY-MM`. */
export function monthOf(iso: string): string {
  return iso.slice(0, 7)
}

/**
 * The available record from the API values: `firstDate` (`YYYY-MM-DD`, first day of the
 * record) and `latestMonth` (`YYYY-MM`). The record ends on the last day of that month.
 */
export function availableRecord(firstDate: string, latestMonth: string): DateRecord {
  return { first: firstDate, last: lastDayOfMonth(latestMonth) }
}

/** The record stated for the user, for example `2000-11-01 to 2026-11-30 (local standard time, UTC-8)`. */
export function formatRecord(record: DateRecord): string {
  return `${record.first} to ${record.last} (${TIME_CONVENTION})`
}

/**
 * Default Date_Range (requirements 14.8, 14.9). It ends with the latest date and starts
 * on January 1 of the latest date's year minus 10, or on the first date of the record
 * when that is later. `first` and `latest` are `YYYY-MM-DD`; a `YYYY-MM` value is read as
 * the first day (`first`) or the last day (`latest`) of that month.
 */
export function defaultDateRange(first: string, latest: string): DateRange {
  const firstDate = first.length === 7 ? firstDayOfMonth(first) : first
  const latestDate = latest.length === 7 ? lastDayOfMonth(latest) : latest
  const tenYearsBack = `${pad(Number(latestDate.slice(0, 4)) - 10, 4)}-01-01`
  return { start: tenYearsBack < firstDate ? firstDate : tenYearsBack, end: latestDate }
}

/**
 * Range for a preset (requirements 14.2, 14.7). Calendar presets end with the last day of
 * the latest month. Day presets end on `latestDetectionDate` (the local date of the latest
 * detection) and cover 7 or 30 local dates inclusive; they return null when that date is
 * not known. A start before the first date of the record is moved to the first date.
 */
export function presetRange(
  id: PresetId,
  record: DateRecord,
  latestDetectionDate: string | null = null,
): DateRange | null {
  const clamp = (start: string): string => (start < record.first ? record.first : start)
  switch (id) {
    case 'this-year':
      return { start: clamp(`${record.last.slice(0, 4)}-01-01`), end: record.last }
    case 'last-5-years':
      return { start: clamp(firstDayMonthsBefore(record.last, 59)), end: record.last }
    case 'full-record':
      return { start: record.first, end: record.last }
    case 'last-7-days':
    case 'last-30-days': {
      if (latestDetectionDate === null || !isRealDate(latestDetectionDate)) return null
      const length = id === 'last-7-days' ? 7 : 30
      return { start: clamp(addDays(latestDetectionDate, -(length - 1))), end: latestDetectionDate }
    }
  }
}

export type DateRangeErrors = { start?: string; end?: string }

export type DateRangeValidation =
  { ok: true; range: DateRange } | { ok: false; errors: DateRangeErrors }

function fieldError(label: string, text: string, record: DateRecord): string | null {
  if (!isRealDate(text)) {
    return `${label} is not a real calendar date. Use YYYY-MM-DD, for example 2020-08-15. The record runs from ${formatRecord(record)}.`
  }
  if (text < record.first || text > record.last) {
    return `${label} is outside the available record. The record runs from ${formatRecord(record)}.`
  }
  return null
}

/**
 * Validate typed dates (requirement 14.3). Each invalid field gets its own message, which
 * states the first and latest dates of the record. A start after the end marks both fields.
 * Input is trimmed. Nothing is sent to the API unless `ok` is true.
 */
export function validateDateRange(
  start: string,
  end: string,
  record: DateRecord,
): DateRangeValidation {
  const s = start.trim()
  const e = end.trim()
  const errors: DateRangeErrors = {}
  const startError = fieldError('Start date', s, record)
  const endError = fieldError('End date', e, record)
  if (startError !== null) errors.start = startError
  if (endError !== null) errors.end = endError
  if (startError === null && endError === null && s > e) {
    const message = `Start date is after end date. The record runs from ${formatRecord(record)}.`
    errors.start = message
    errors.end = message
  }
  if (errors.start !== undefined || errors.end !== undefined) return { ok: false, errors }
  return { ok: true, range: { start: s, end: e } }
}

/**
 * Note for a range that starts or ends partway through a month (requirement 14.12), or
 * null when both ends fall on month boundaries. Statistics use whole months; the Recent
 * view and the CSV use the exact dates.
 */
export function wholeMonthNote(range: DateRange): string | null {
  if (!isRealDate(range.start) || !isRealDate(range.end)) return null
  const partial: string[] = []
  if (range.start !== firstDayOfMonth(range.start)) partial.push(monthOf(range.start))
  if (range.end !== lastDayOfMonth(monthOf(range.end))) {
    if (!partial.includes(monthOf(range.end))) partial.push(monthOf(range.end))
  }
  if (partial.length === 0) return null
  const names = partial.map((m) => formatMonthLabel(m)).join(' and ')
  return `Statistics cover the whole of ${names}. The Recent view and the CSV use the exact dates.`
}

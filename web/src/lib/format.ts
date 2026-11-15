// Display formatting. Pure functions, no I/O. One place for the units and the time
// convention, so every view states them the same way (requirements 14.4, 30.2).
// Numbers use en-US separators, one decimal for counts and percents, and an ASCII
// minus. Missing or non-finite values show a dash, never "NaN" or "Infinity".

export const REGION_LABEL = 'California region'
export const TIME_CONVENTION = 'local standard time, UTC-8'
/** Harmonized monthly counts (`count_harmonized`). */
export const UNIT_CELL_DAYS = 'cell-days (MODIS-equivalent)'
/** Raw MODIS or raw VIIRS cell-day counts, never summed together. */
export const UNIT_CELL_DAYS_RAW = 'cell-days (raw)'
/** Detection rows in the Recent view and the hotspot CSV. */
export const UNIT_DETECTIONS = 'detections (raw)'
export const UNIT_FRP = 'MW'
export const CRS_LABEL = 'EPSG:4326'
/** Shown for a missing value, for example a null `frp_mean`. */
export const MISSING = '\u2014'
/** Shown instead of a percent difference when the baseline median is 0. */
export const NO_TYPICAL_FIRES = 'no typical fires in this month'

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

const oneDecimal = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

function fixed1(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  const text = oneDecimal.format(value)
  // A small negative value rounds to "-0.0". Show "0.0".
  return /^-0\.0$/.test(text) ? '0.0' : text
}

function signed(text: string): string {
  return text === '0.0' || text.startsWith('-') ? text : `+${text}`
}

/** Count to one decimal with thousands separators, for example `1,234.5`. */
export function formatCount(value: number | null | undefined): string {
  return fixed1(value) ?? MISSING
}

/** Count with its unit, for example `1,234.5 cell-days (MODIS-equivalent)`. */
export function formatCountWithUnit(
  value: number | null | undefined,
  unit: string = UNIT_CELL_DAYS,
): string {
  const text = fixed1(value)
  return text === null ? MISSING : `${text} ${unit}`
}

/** Difference of counts with an explicit sign, for example `+12.0` or `-3.5`. */
export function formatSignedCount(value: number | null | undefined): string {
  const text = fixed1(value)
  return text === null ? MISSING : signed(text)
}

/** Percent to one decimal, for example `12.3%`. The input is already in percent. */
export function formatPercent(value: number | null | undefined): string {
  const text = fixed1(value)
  return text === null ? MISSING : `${text}%`
}

/**
 * Percent difference from the baseline median, with an explicit sign, for example
 * `+12.3%`. A null value (baseline median 0) gives "no typical fires in this month".
 */
export function formatPercentDifference(value: number | null | undefined): string {
  if (value === null || value === undefined) return NO_TYPICAL_FIRES
  const text = fixed1(value)
  return text === null ? MISSING : `${signed(text)}%`
}

/** Fire radiative power total in MW to one decimal. Null shows a dash. */
export function formatFrp(value: number | null | undefined): string {
  const text = fixed1(value)
  return text === null ? MISSING : `${text} ${UNIT_FRP}`
}

/** True when `iso` is a real calendar date written YYYY-MM-DD. */
export function isRealDate(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, d))
  // Date.UTC maps years 0 to 99 to 1900 to 1999, so require the year to round-trip.
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
}

/** Month name for a month number 1 to 12, or a dash. */
export function monthName(month: number): string {
  return Number.isInteger(month) ? (MONTH_NAMES[month - 1] ?? MISSING) : MISSING
}

/** `{Month} {Year}`, for example `November 2000`. */
export function formatMonth(year: number, month: number): string {
  const name = monthName(month)
  return name === MISSING || !Number.isInteger(year) ? MISSING : `${name} ${year}`
}

/** `YYYY-MM` to `{Month} {Year}`. Anything else gives a dash. */
export function formatMonthLabel(yearMonth: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(yearMonth)
  return m ? formatMonth(Number(m[1]), Number(m[2])) : MISSING
}

/** A local date as `YYYY-MM-DD`, or a dash when it is not a real date. */
export function formatDate(iso: string): string {
  return isRealDate(iso) ? iso : MISSING
}

/** A local date with its time convention, for example `2020-08-15 (local standard time, UTC-8)`. */
export function formatDateLabelled(iso: string): string {
  return isRealDate(iso) ? `${iso} (${TIME_CONVENTION})` : MISSING
}

/** A local date range stated once, for example `2020-01-01 to 2020-12-31 (local standard time, UTC-8)`. */
export function formatDateRange(start: string, end: string): string {
  return isRealDate(start) && isRealDate(end) ? `${start} to ${end} (${TIME_CONVENTION})` : MISSING
}

/** A true UTC instant as `YYYY-MM-DD HH:mm UTC`, or a dash when it cannot be parsed. */
export function formatUtcTimestamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return MISSING
  const p = (n: number, width = 2): string => String(n).padStart(width, '0')
  return (
    `${p(date.getUTCFullYear(), 4)}-${p(date.getUTCMonth() + 1)}-${p(date.getUTCDate())} ` +
    `${p(date.getUTCHours())}:${p(date.getUTCMinutes())} UTC`
  )
}

/** Header badge text, for example `Data to November 2026 (provisional)`. */
export function formatDataThrough(latestMonth: string, incomplete = false): string {
  const label = formatMonthLabel(latestMonth)
  if (label === MISSING) return MISSING
  return incomplete ? `Data to ${label} (provisional)` : `Data to ${label}`
}

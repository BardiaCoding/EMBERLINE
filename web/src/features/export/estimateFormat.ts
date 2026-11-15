import type { HotspotEstimateOut } from '@/lib/api'

/**
 * Display of the CSV estimate (requirements 17.9, 17.12). Pure functions, no I/O.
 * The file size is approximate: 2 significant figures, decimal units (B, kB, MB, GB).
 */

const UNITS = ['B', 'kB', 'MB', 'GB'] as const

const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const shortNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })

/** Row count with thousands separators, for example `1,234,567`. */
export function formatRows(rows: number): string {
  return integer.format(rows)
}

/**
 * Bytes rounded to 2 significant figures in decimal units, for example `1,234,567` is
 * `1.2 MB` and `54,000` is `54 kB`. Values below 1000 stay in bytes. Not finite or negative
 * values show `0 B`.
 */
export function formatApproxBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  let unit = Math.max(0, Math.min(Math.floor(Math.log10(bytes) / 3), UNITS.length - 1))
  let value = Number((bytes / 1000 ** unit).toPrecision(2))
  if (value >= 1000 && unit < UNITS.length - 1) {
    // Rounding reached 1000 (for example 999.6 kB): show it in the next unit.
    unit += 1
    value = Number((bytes / 1000 ** unit).toPrecision(2))
  }
  return `${shortNumber.format(value)} ${UNITS[unit] ?? 'GB'}`
}

/**
 * Message shown instead of the "Download" action when the query has more rows than the limit
 * (requirements 17.6, 17.10). It states the count and the limit and asks to narrow the query.
 */
export function overLimitMessage(estimate: HotspotEstimateOut): string {
  return (
    `This search has ${formatRows(estimate.rows)} detections, which is over the limit of ` +
    `${formatRows(estimate.limit)} rows for one download. Narrow the area or the dates, then try again.`
  )
}

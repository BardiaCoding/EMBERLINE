// Baseline period helpers (requirements 10.2, 10.10). Pure functions, no I/O. A baseline is the
// first and last calendar year (inclusive) of the years the median, percentiles and anomalies
// are computed from. It must hold 5 to 30 complete in-record years (the server checks it too).
export const MIN_BASELINE_YEARS = 5
export const MAX_BASELINE_YEARS = 30
export type Baseline = [number, number]
export type YearBounds = { first: number; last: number }
function parseYm(value: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(value)
  return m === null ? null : { year: Number(m[1]), month: Number(m[2]) }
}
/**
 * First and last calendar year with all 12 months in the record and complete, from `/meta`
 * (`record_start`, `latest_complete_month`). Null when no complete year exists.
 */
export function completeYearBounds(
  recordStart: string,
  latestCompleteMonth: string | null,
): YearBounds | null {
  const start = parseYm(recordStart)
  const end = latestCompleteMonth === null ? null : parseYm(latestCompleteMonth)
  if (start === null || end === null) return null
  const first = start.month === 1 ? start.year : start.year + 1
  const last = end.month === 12 ? end.year : end.year - 1
  return first <= last ? { first, last } : null
}
export type BaselineInput = { ok: true; baseline: Baseline } | { ok: false; error: string }
/** Checks the two year fields. The message names the violated limit. */
export function validateBaselineInput(
  firstText: string,
  lastText: string,
  bounds: YearBounds,
): BaselineInput {
  const first = /^\d{4}$/.test(firstText.trim()) ? Number(firstText.trim()) : null
  const last = /^\d{4}$/.test(lastText.trim()) ? Number(lastText.trim()) : null
  if (first === null || last === null) {
    return { ok: false, error: 'Enter the first and last baseline year as four digits.' }
  }
  if (first > last) return { ok: false, error: 'The first year must not be after the last year.' }
  if (first < bounds.first || last > bounds.last) {
    return {
      ok: false,
      error: `Baseline years must be complete years in the record: ${bounds.first} to ${bounds.last}.`,
    }
  }
  const n = last - first + 1
  if (n < MIN_BASELINE_YEARS) {
    return {
      ok: false,
      error: `The baseline period needs at least ${MIN_BASELINE_YEARS} complete years, got ${n}.`,
    }
  }
  if (n > MAX_BASELINE_YEARS) {
    return {
      ok: false,
      error: `The baseline period allows at most ${MAX_BASELINE_YEARS} complete years, got ${n}.`,
    }
  }
  return { ok: true, baseline: [first, last] }
}
/** One-line description of the baseline period for the legend and the cards. */
export function baselineLabel(baseline: Baseline | null): string {
  return baseline === null
    ? 'Baseline period: the full record, complete months only (default).'
    : `Baseline period: ${baseline[0]} to ${baseline[1]} (${baseline[1] - baseline[0] + 1} years).`
}

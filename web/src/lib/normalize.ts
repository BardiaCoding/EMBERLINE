// Per-area normalization for area comparison (requirement 19.5).
// Normalizes counts to per-1000 km² using geodesic area calculation.
import type { CalendarOut, MonthOut } from '@/lib/api'

/**
 * Normalizes a count to per-1000 km².
 *
 * Used when comparing areas of different sizes. The value is:
 * (count / area_km2) * 1000
 *
 * @param count - Harmonized count in cell-days
 * @param area_km2 - Total geodesic area in km² of the selected cells
 * @returns Normalized count as cell-days per 1000 km²
 *
 * Requirements: 19.5
 */
export function normalizeToArea(count: number, area_km2: number): number {
  if (area_km2 <= 0) return 0
  return (count / area_km2) * 1000
}

/**
 * Normalizes all counts in a calendar result to per-1000 km².
 *
 * Creates a new CalendarOut with all harmonized counts normalized.
 * Raw MODIS and VIIRS counts are left unchanged (they represent raw detections,
 * not area-normalized values).
 *
 * @param result - Original calendar result
 * @param area_km2 - Total geodesic area in km²
 * @returns New CalendarOut with normalized harmonized counts
 */
export function normalizeCalendarResult(result: CalendarOut, area_km2: number): CalendarOut {
  if (area_km2 <= 0) {
    // If area is zero or negative, return zero counts
    return {
      ...result,
      months: result.months.map((m) => ({
        ...m,
        harmonized: 0,
      })),
      years: result.years.map((y) => ({
        ...y,
        harmonized: 0,
      })),
      baseline_by_month: result.baseline_by_month.map((b) => ({
        ...b,
        median: 0,
        p10: 0,
        p90: 0,
        mean: 0,
        std: normalizeOrNull(b.std, 0),
      })),
      baseline_year: result.baseline_year
        ? {
            ...result.baseline_year,
            median: 0,
            p10: 0,
            p90: 0,
            mean: 0,
            std: normalizeOrNull(result.baseline_year.std, 0),
          }
        : null,
    }
  }

  return {
    ...result,
    months: result.months.map((m) => normalizeMonth(m, area_km2)),
    years: result.years.map((y) => ({
      ...y,
      harmonized: normalizeToArea(y.harmonized, area_km2),
      // Anomaly remains relative, so we keep it as-is
    })),
    baseline_by_month: result.baseline_by_month.map((b) => ({
      ...b,
      median: normalizeToArea(b.median, area_km2),
      p10: normalizeToArea(b.p10, area_km2),
      p90: normalizeToArea(b.p90, area_km2),
      mean: normalizeToArea(b.mean, area_km2),
      std: normalizeOrNull(b.std, area_km2),
    })),
    baseline_year: result.baseline_year
      ? {
          ...result.baseline_year,
          median: normalizeToArea(result.baseline_year.median, area_km2),
          p10: normalizeToArea(result.baseline_year.p10, area_km2),
          p90: normalizeToArea(result.baseline_year.p90, area_km2),
          mean: normalizeToArea(result.baseline_year.mean, area_km2),
          std: normalizeOrNull(result.baseline_year.std, area_km2),
        }
      : null,
  }
}

/** Like `normalizeToArea`, but null (no value) stays null. */
function normalizeOrNull(count: number | null, area_km2: number): number | null {
  return count === null ? null : normalizeToArea(count, area_km2)
}

/**
 * Normalizes a single month's harmonized count to per-1000 km².
 * Keeps anomaly percentages unchanged (they're already relative).
 */
function normalizeMonth(month: MonthOut, area_km2: number): MonthOut {
  return {
    ...month,
    harmonized: normalizeToArea(month.harmonized, area_km2),
    // Anomaly percentages stay the same (relative values)
    // Absolute anomaly needs to be normalized
    anomaly: month.anomaly
      ? {
          ...month.anomaly,
          absolute: normalizeToArea(month.anomaly.absolute, area_km2),
          // percent stays the same (it's relative)
          // z-score is a ratio of values in the same unit, so it does not change with scale
          // percentile_rank stays the same (relative ranking)
        }
      : month.anomaly,
  }
}

/**
 * Gets the unit label for normalized counts.
 * Used in legends and labels when per-area mode is active.
 */
export function normalizedUnit(): string {
  return 'cell-days per 1000 km² (MODIS-equivalent)'
}

/**
 * Gets the unit label for regular (non-normalized) counts.
 */
export function regularUnit(): string {
  return 'cell-days per month (MODIS-equivalent)'
}

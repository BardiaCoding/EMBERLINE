import type { components } from './api.types'
import { formatCount, UNIT_CELL_DAYS } from './format'

type WatchOut = components['schemas']['WatchOut']

export type WatchBadgeData = {
  level: string
  tooltip: string
}

/**
 * Formats watch data for display in the badge.
 *
 * @param watch - WatchOut data from the API
 * @returns Object with level (short text) and tooltip (full context)
 */
export function formatWatchBadge(watch: WatchOut | null): WatchBadgeData {
  if (!watch || !watch.level) {
    return {
      level: 'Not available',
      tooltip: watch?.reason || 'Watch level not available',
    }
  }

  const level = watch.level

  // Build tooltip with month, count, median, percentile, provisional info
  const parts: string[] = []

  // Period information
  if (watch.period) {
    parts.push(watch.period)
  }

  // Count and median
  if (watch.count !== null) {
    const countText = formatCount(watch.count)
    parts.push(`${countText} ${UNIT_CELL_DAYS}`)

    if (watch.median !== null) {
      const medianText = formatCount(watch.median)
      parts.push(`baseline median ${medianText}`)
    }
  }

  // Percentile
  if (watch.percentile !== null) {
    const percentileText = formatCount(watch.percentile)
    parts.push(`${percentileText}th percentile`)
  }

  // Baseline info
  if (watch.baseline_start !== null && watch.baseline_end !== null && watch.n_years !== null) {
    parts.push(`baseline ${watch.baseline_start} to ${watch.baseline_end} (${watch.n_years} years)`)
  }

  // Provisional information
  if (watch.provisional && watch.provisional_month && watch.provisional_count !== null) {
    const provisionalCountText = formatCount(watch.provisional_count)
    parts.push(
      `Provisional: ${watch.provisional_month} to date ${provisionalCountText} ${UNIT_CELL_DAYS}`,
    )
  }

  // Threshold info for "Above normal"
  if (level === 'Above normal' && watch.threshold !== null) {
    parts.push(`(above ${watch.threshold}th percentile)`)
  }

  // Reason (for "Not available" or other context)
  if (watch.reason && level === 'Not available') {
    parts.push(watch.reason)
  }

  const tooltip = parts.join(', ')

  return {
    level,
    tooltip: tooltip || level,
  }
}

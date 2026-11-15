import type { SeasonOut } from '@/lib/api'
import { formatCount, formatMonthLabel, MISSING, monthName } from '@/lib/format'

// Pure helpers of the season tracker (requirement 21). Counts are cell-days (MODIS-equivalent),
// monthly resolution, months on local standard time (UTC-8). The provisional month is never part
// of a curve: it is stated in text only.

export type SeasonPoint = {
  /** 1 to 12, counted from the season start month. */
  monthOfSeason: number
  /** Calendar month 1 to 12. */
  calendarMonth: number
  label: string
  p10: number | null
  median: number | null
  p90: number | null
  /** Cumulative count of the selected season year, null after its last complete month. */
  selected: number | null
}

/** The 12 points of the chart, the same values as the table. */
export function buildSeasonPoints(season: SeasonOut): SeasonPoint[] {
  const start = season.season_start_month
  return Array.from({ length: 12 }, (_, i) => {
    const calendarMonth = ((start - 1 + i) % 12) + 1
    const env = season.envelope?.[i]
    return {
      monthOfSeason: i + 1,
      calendarMonth,
      label: monthName(calendarMonth),
      p10: env?.p10 ?? null,
      median: env?.median ?? null,
      p90: env?.p90 ?? null,
      selected: season.selected[i] ?? null,
    }
  })
}

/** Season year as text: "2025" for a January start, "2025/26" otherwise. */
export function seasonLabel(year: number, startMonth: number): string {
  return startMonth === 1 ? String(year) : `${year}/${String((year + 1) % 100).padStart(2, '0')}`
}

/** One sentence about the selected season at its last complete month (requirement 21.6). */
export function describeSeasonStatus(season: SeasonOut): string {
  if (season.season_year === null || season.through === null || season.count === null) {
    return season.reason ?? 'No season to show.'
  }
  const name = seasonLabel(season.season_year, season.season_start_month)
  const through = formatMonthLabel(season.through)
  const count = `${formatCount(season.count)} cell-days (MODIS-equivalent)`
  if (season.envelope === null) {
    return `Season ${name} through ${through}: ${count}. No envelope: fewer than 5 comparable season years.`
  }
  const median = `${formatCount(season.median_cumulative)} cell-days`
  if (season.percent_of_median === null) {
    return `Season ${name} through ${through}: ${count}; median for the same point ${median}. Percent of median not available because the median is 0.`
  }
  return `Season ${name} through ${through}: ${count}, ${Math.round(season.percent_of_median)}% of the median ${median} for the same point.`
}

/** Sentence about the provisional month of the season, or null. */
export function describeSeasonProvisional(season: SeasonOut): string | null {
  if (season.provisional_month === null) return null
  const count = season.provisional_count === null ? MISSING : formatCount(season.provisional_count)
  return `${formatMonthLabel(season.provisional_month)} is provisional (${count} cell-days to date). It is not in the curve and is not compared with the baseline.`
}

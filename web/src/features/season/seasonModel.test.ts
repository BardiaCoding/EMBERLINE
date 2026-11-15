import { describe, expect, it } from 'vitest'
import type { SeasonOut } from '@/lib/api'
import { coverage } from '@/lib/binning.fixtures'
import {
  buildSeasonPoints,
  describeSeasonProvisional,
  describeSeasonStatus,
  seasonLabel,
} from './seasonModel'

// Synthetic values. TEST FIXTURE, not NASA data.
function season(extra: Partial<SeasonOut> = {}): SeasonOut {
  return {
    season_start_month: 1,
    season_year: 2026,
    selected: [5, 9, 20],
    through: '2026-03',
    count: 20,
    median_cumulative: 16,
    percent_of_median: 125,
    envelope: Array.from({ length: 12 }, (_, i) => ({
      month_of_season: i + 1,
      calendar_month: i + 1,
      p10: i,
      median: i + 2,
      p90: i + 5,
    })),
    n_envelope_years: 20,
    curves: [],
    provisional_month: '2026-04',
    provisional_count: 3,
    reason: null,
    available_season_years: [2025, 2026],
    coverage: coverage(),
    n_cells: 3,
    notice: null,
    clipped_percent: null,
    ...extra,
  }
}

describe('season model', () => {
  it('builds 12 points and stops the selected curve at the last complete month', () => {
    const points = buildSeasonPoints(season({ season_start_month: 7 }))
    expect(points).toHaveLength(12)
    expect(points[0]?.label).toBe('July')
    expect(points[6]?.label).toBe('January')
    expect(points.map((p) => p.selected)).toEqual([5, 9, 20, ...Array<null>(9).fill(null)])
  })

  it('states the percent of median rounded to a whole number', () => {
    expect(describeSeasonStatus(season({ percent_of_median: 124.6 }))).toContain(
      '125% of the median',
    )
  })

  it('does not state a percent when the median is 0', () => {
    const text = describeSeasonStatus(
      season({ percent_of_median: null, median_cumulative: 0, count: 4 }),
    )
    expect(text).toContain('Percent of median not available')
    expect(text).toContain('4.0')
    expect(text).not.toContain('Infinity')
  })

  it('says there is no envelope with fewer than 5 years, and uses the reason when empty', () => {
    expect(describeSeasonStatus(season({ envelope: null, median_cumulative: null }))).toContain(
      'No envelope',
    )
    expect(
      describeSeasonStatus(season({ season_year: null, through: null, reason: 'No data.' })),
    ).toBe('No data.')
  })

  it('labels the provisional month and the season year', () => {
    expect(describeSeasonProvisional(season())).toContain('April 2026 is provisional')
    expect(describeSeasonProvisional(season({ provisional_month: null }))).toBeNull()
    expect(seasonLabel(2025, 1)).toBe('2025')
    expect(seasonLabel(2025, 7)).toBe('2025/26')
  })
})

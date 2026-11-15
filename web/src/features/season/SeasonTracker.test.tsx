import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import { coverage } from '@/lib/binning.fixtures'
import { QueryProvider } from '@/lib/QueryProvider'
import { server } from '@/test/server'
import { SeasonTracker } from './SeasonTracker'

vi.mock('@/features/charts/EChartCanvas', () => ({
  default: (props: { option: unknown }) => (
    <div role="group" tabIndex={0} aria-label="chart" data-option={JSON.stringify(props.option)} />
  ),
}))

// Synthetic values. TEST FIXTURE, not NASA data.
const body = {
  season_start_month: 1,
  season_year: 2026,
  selected: [5, 9],
  through: '2026-02',
  count: 9,
  median_cumulative: 0,
  percent_of_median: null,
  envelope: Array.from({ length: 12 }, (_, i) => ({
    month_of_season: i + 1,
    calendar_month: i + 1,
    p10: 0,
    median: 0,
    p90: 3,
  })),
  n_envelope_years: 6,
  curves: [],
  provisional_month: '2026-03',
  provisional_count: 2,
  reason: null,
  available_season_years: [2025, 2026],
  coverage: coverage(),
  n_cells: 1,
  notice: null,
  clipped_percent: null,
  area_km2: null,
}

describe('SeasonTracker', () => {
  it('shows the status without a percent when the median is 0, and the provisional month', async () => {
    server.use(http.post('*/api/v1/season', () => HttpResponse.json(body)))
    const { container } = render(
      <QueryProvider>
        <SeasonTracker start="2000-11-01" end="2026-12-31" area="California region" />
      </QueryProvider>,
    )
    expect((await screen.findByTestId('season-status')).textContent).toContain(
      'Percent of median not available',
    )
    expect(screen.getByTestId('season-provisional').textContent).toContain(
      'March 2026 is provisional',
    )
    expect(await axe(container)).toHaveNoViolations()
  })

  it('shows an error state when the request fails', async () => {
    server.use(http.post('*/api/v1/season', () => HttpResponse.json({}, { status: 500 })))
    render(
      <QueryProvider>
        <SeasonTracker start="2000-11-01" end="2026-12-31" area="California region" />
      </QueryProvider>,
    )
    expect(await screen.findByTestId('chart-error')).toBeTruthy()
  })
})

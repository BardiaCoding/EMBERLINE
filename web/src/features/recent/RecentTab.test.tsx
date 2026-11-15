import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { axe } from 'vitest-axe'
import { createQueryClient } from '@/lib/queryClient'
import { server } from '@/test/server'
import RecentTab from './RecentTab'
import { RECENT_TIMEOUT_MS, type RecentOut } from './recentApi'

// Synthetic response, TEST FIXTURE, not NASA data.
function recentOut(overrides: Partial<RecentOut> = {}): RecentOut {
  const counts = [0, 0, 3, 0, 1, 0, 2]
  return {
    window_start: '2026-11-04',
    window_end: '2026-11-10',
    days: counts.map((count, i) => ({ date: `2026-11-${String(4 + i).padStart(2, '0')}`, count })),
    total: 6,
    points: [
      {
        lat: 34.5,
        lon: -118.5,
        satellite: 'SNPP',
        source: 'SP',
        local_date: '2026-11-10',
        acq_datetime_utc: '2026-11-10T20:15:00Z',
        frp: 3,
      },
      {
        lat: 34.7,
        lon: -118.2,
        satellite: 'Aqua',
        source: 'SP',
        local_date: '2026-11-08',
        acq_datetime_utc: '2026-11-08T20:15:00Z',
        frp: null,
      },
    ],
    points_omitted: 0,
    max_points: 5000,
    latest_utc: '2026-11-10T20:15:00Z',
    data_age_days: 1,
    stale_after_days: 3,
    watch: null,
    label: 'raw, not harmonized, not comparable across sensors',
    unit: 'detections (raw)',
    time_convention: 'local standard time, UTC-8',
    ...overrides,
  }
}

function renderTab() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <RecentTab area="California region" />
    </QueryClientProvider>,
  )
}

function reply(body: RecentOut) {
  server.use(http.post('*/api/v1/recent', () => HttpResponse.json(body)))
}

describe('RecentTab', () => {
  it('shows 7 raw bars, the latest detection time and the raw label', async () => {
    reply(recentOut())
    const { container } = renderTab()
    expect(await screen.findAllByTestId('recent-bar')).toHaveLength(7)
    expect(screen.getByTestId('recent-raw-label').textContent).toMatch(/not harmonized/)
    expect(screen.getByTestId('recent-latest').textContent).toContain('2026-11-10 20:15 UTC')
    expect(screen.queryByTestId('recent-stale')).toBeNull()
    expect(screen.queryByTestId('recent-empty')).toBeNull()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('shows the stale notice only above 3 days', async () => {
    reply(recentOut({ data_age_days: 4 }))
    renderTab()
    expect((await screen.findByTestId('recent-stale')).textContent).toContain('4 days')
  })

  it('does not show the stale notice at exactly 3 days', async () => {
    reply(recentOut({ data_age_days: 3 }))
    renderTab()
    await screen.findByTestId('recent-tab')
    expect(screen.queryByTestId('recent-stale')).toBeNull()
  })

  it('shows seven zero bars and a message when there are no detections', async () => {
    reply(
      recentOut({
        days: Array.from({ length: 7 }, (_, i) => ({
          date: `2026-11-0${4 + i}`.slice(0, 10),
          count: 0,
        })),
        total: 0,
        points: [],
      }),
    )
    renderTab()
    expect((await screen.findByTestId('recent-empty')).textContent).toMatch(/No detections/)
    expect(screen.getAllByTestId('recent-bar')).toHaveLength(7)
    expect(screen.queryByTestId('recent-points')).toBeNull()
  })

  it('states how many points are omitted', async () => {
    reply(recentOut({ points_omitted: 10, total: 16 }))
    renderTab()
    expect((await screen.findByTestId('recent-omitted')).textContent).toContain('10 older')
  })

  it('shows an error with a retry and keeps the area when the request fails', async () => {
    server.use(http.post('*/api/v1/recent', () => HttpResponse.json({}, { status: 500 })))
    renderTab()
    expect((await screen.findByTestId('recent-error')).textContent).toMatch(/could not be loaded/)
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy()
  })

  it('times out after 10 seconds', () => {
    expect(RECENT_TIMEOUT_MS).toBe(10_000)
  })

  it('displays the WatchBadge when watch data is present', async () => {
    reply(
      recentOut({
        watch: {
          level: 'Above normal',
          period: 'November 2026',
          count: 125.5,
          median: 50.0,
          percentile: 92.5,
          threshold: 90,
          baseline_start: 2000,
          baseline_end: 2025,
          n_years: 25,
          provisional: false,
          provisional_month: null,
          provisional_count: null,
          reason: null,
        },
      }),
    )
    renderTab()
    await screen.findByTestId('recent-tab')
    // Badge should appear with "Above normal" text
    expect(screen.getByText('Above normal')).toBeTruthy()
  })

  it('displays the WatchBadge with "Not available" when watch is null', async () => {
    reply(recentOut({ watch: null }))
    renderTab()
    await screen.findByTestId('recent-tab')
    // Badge should appear with "Not available" text
    expect(screen.getByText('Not available')).toBeTruthy()
  })
})

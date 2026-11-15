import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'
import { month, result } from '@/lib/binning.fixtures'
import { currentMonth, currentYear, statsResult } from '@/lib/stats.fixtures'
import type { CalendarOut, CalendarRequest, MetaOut } from '@/lib/api'
import { QueryProvider } from '@/lib/QueryProvider'
import { createQueryClient } from '@/lib/queryClient'
import { server } from '@/test/server'
import { App } from './App'
vi.mock('@/features/map/MapCanvas', () => ({
  MapCanvas: ({ label }: { label: string }) => <div role="img" aria-label={label} />,
}))
// Synthetic values. TEST FIXTURE, not NASA data.
const ORIGIN = window.location.origin
const meta: MetaOut = {
  name: 'California region',
  extent: { west: -124.4, south: 32.5, east: -114.0, north: 42.2 },
  record_start: '2000-11',
  first_date: '2000-11-01',
  latest_month: '2012-12',
  latest_month_incomplete: false,
  latest_complete_month: '2012-12',
  latest_detection_local_date: '2012-12-31',
  latest_detection_utc: '2013-01-01T01:00:00Z',
  time_convention: 'local standard time, UTC-8',
  unit: 'cell-days (MODIS-equivalent)',
  watch_threshold: 90,
  limitations: [],
  example_areas: [],
  bounds_available: false,
}
const calendarResult: CalendarOut = result(
  [month(2002, 7, 120.5, { raw_modis: 100, raw_viirs: 0 }), month(2002, 8, 0)],
  [],
)
const stats = statsResult({ current_month: currentMonth(), current_year: currentYear() })
const bodies: CalendarRequest[] = []
const statsBodies: CalendarRequest[] = []
function useApi() {
  server.use(
    http.get(`${ORIGIN}/api/health`, () =>
      HttpResponse.json({ status: 'ok', data_present: true, latest_month: '2012-12' }),
    ),
    http.get(`${ORIGIN}/api/v1/meta`, () => HttpResponse.json(meta)),
    http.post(`${ORIGIN}/api/v1/stats`, async ({ request }) => {
      statsBodies.push((await request.json()) as CalendarRequest)
      return HttpResponse.json(stats)
    }),
    http.post(`${ORIGIN}/api/v1/calendar`, async ({ request }) => {
      const body = (await request.json()) as CalendarRequest
      bodies.push(body)
      // The server rejects any baseline that starts in 2003, as the real one would for a bad period.
      if (body.baseline_years?.[0] === 2003) {
        return HttpResponse.json(
          {
            error: {
              code: 'invalid_baseline_years',
              message: 'Baseline period needs at least 5 complete years, got 4.',
              request_id: 'r1',
            },
          },
          { status: 422 },
        )
      }
      return HttpResponse.json(calendarResult)
    }),
  )
}
function renderApp() {
  return render(
    <QueryProvider client={createQueryClient()}>
      <App />
    </QueryProvider>,
  )
}
function setUrl(search: string) {
  window.history.replaceState(null, '', `/${search}`)
}
async function apply(first: string, last: string) {
  const user = userEvent.setup()
  const a = screen.getByLabelText('First year')
  const b = screen.getByLabelText('Last year')
  await user.clear(a)
  await user.type(a, first)
  await user.clear(b)
  await user.type(b, last)
  await user.click(screen.getByRole('button', { name: 'Apply baseline' }))
}
beforeEach(() => {
  bodies.length = 0
  statsBodies.length = 0
  setUrl('?from=2002-01-01&to=2002-12-31')
  useApi()
})
afterEach(() => {
  setUrl('')
})
describe('Custom baseline period in the App (task 28.1)', () => {
  it('sends the baseline with calendar and stats, writes bl and names it in legend and cards', async () => {
    renderApp()
    await screen.findByRole('region', { name: 'Burning activity calendar' }, { timeout: 10_000 })
    expect(bodies[0]).not.toHaveProperty('baseline_years')
    await apply('2005', '2010')
    await waitFor(() => {
      expect(bodies.at(-1)?.baseline_years).toEqual([2005, 2010])
      expect(statsBodies.at(-1)?.baseline_years).toEqual([2005, 2010])
    })
    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get('bl')).toBe('2005-2010')
    })
    const legend = await screen.findByRole('region', { name: 'Calendar legend' })
    expect(within(legend).getByTestId('legend-baseline').textContent).toMatch(
      /2005 to 2010 \(6 years\)/,
    )
    expect((await screen.findByTestId('cards-baseline')).textContent).toMatch(/2005 to 2010/)
  })
  it('restores the baseline from the page address', async () => {
    setUrl('?from=2002-01-01&to=2002-12-31&bl=2004-2010')
    renderApp()
    await screen.findByRole('region', { name: 'Burning activity calendar' }, { timeout: 10_000 })
    expect(bodies[0]?.baseline_years).toEqual([2004, 2010])
    expect(screen.getByLabelText<HTMLInputElement>('First year').value).toBe('2004')
  })
  it('keeps the previous results and baseline when the server rejects the period', async () => {
    renderApp()
    await screen.findByRole('region', { name: 'Burning activity calendar' }, { timeout: 10_000 })
    await apply('2005', '2010')
    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get('bl')).toBe('2005-2010')
    })
    await apply('2003', '2008')
    const alert = await screen.findByTestId('baseline-error')
    expect(alert.textContent).toMatch(/at least 5 complete years/)
    expect(alert.textContent).toMatch(/previous baseline period is still applied/)
    expect(screen.queryByTestId('error-card')).toBeNull()
    expect(screen.getByRole('region', { name: 'Burning activity calendar' })).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByTestId('baseline-current').textContent).toMatch(/2005 to 2010/)
    })
    expect(new URLSearchParams(window.location.search).get('bl')).toBe('2005-2010')
  })
})

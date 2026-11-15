import { render, screen, waitFor } from '@testing-library/react'
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

// jsdom has no WebGL: the map canvas is replaced by a stub.
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
  latest_month: '2003-12',
  latest_month_incomplete: false,
  latest_complete_month: '2003-12',
  latest_detection_local_date: '2003-12-31',
  latest_detection_utc: '2004-01-01T01:00:00Z',
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
const stats = statsResult({
  summary: {
    total_harmonized: 120.5,
    raw_modis: 100,
    raw_viirs: 0,
    frp_sum_mw: null,
    n_months: 2,
    includes_provisional: false,
  },
  current_month: currentMonth(),
  current_year: currentYear(),
  top_months: [{ year: 2002, month: 7, harmonized: 120.5 }],
  top_years: [{ year: 2002, harmonized: 120.5, n_months: 12 }],
})
const calendarRequests: CalendarRequest[] = []

function useApi(failCalendar: () => boolean) {
  server.use(
    http.post(`${ORIGIN}/api/v1/stats`, () => HttpResponse.json(stats)),
    http.get(`${ORIGIN}/api/health`, () =>
      HttpResponse.json({ status: 'ok', data_present: true, latest_month: '2003-12' }),
    ),
    http.get(`${ORIGIN}/api/v1/meta`, () => HttpResponse.json(meta)),
    http.post(`${ORIGIN}/api/v1/calendar`, async ({ request }) => {
      calendarRequests.push((await request.json()) as CalendarRequest)
      return failCalendar()
        ? HttpResponse.json(
            { error: { code: 'internal_error', message: 'Something broke.', request_id: 'r1' } },
            { status: 500 },
          )
        : HttpResponse.json(calendarResult)
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

beforeEach(() => {
  calendarRequests.length = 0
  setUrl('')
})
afterEach(() => {
  setUrl('')
})

describe('Result states in the App (task 19.9)', () => {
  it('Retry resends the same query as the failed request', async () => {
    let fail = true
    useApi(() => fail)
    setUrl('?from=2002-01-01&to=2002-12-31')
    renderApp()
    await screen.findByTestId('error-card')
    const failed = calendarRequests.length
    expect(failed).toBeGreaterThan(0)
    fail = false
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByRole('region', { name: 'Burning activity calendar' })
    expect(calendarRequests.length).toBeGreaterThan(failed)
    const expected = { geometry: null, start: '2002-01-01', end: '2002-12-31' }
    for (const request of calendarRequests) expect(request).toEqual(expected)
  })

  it('invalid date input sends no request and keeps the previous query, results and URL', async () => {
    useApi(() => false)
    setUrl('?from=2002-01-01&to=2002-12-31')
    renderApp()
    await screen.findByRole('region', { name: 'Burning activity calendar' })
    await waitFor(() => {
      expect(calendarRequests).toHaveLength(1)
    })
    const user = userEvent.setup()
    const start = screen.getByLabelText('Start date')
    await user.clear(start)
    await user.type(start, '2003-02-30')
    await user.click(screen.getByRole('button', { name: 'Apply date range' }))
    expect(start.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0)
    expect(calendarRequests).toHaveLength(1)
    expect(screen.getByRole('region', { name: 'Burning activity calendar' })).toBeTruthy()
    const params = new URLSearchParams(window.location.search)
    expect(params.get('from')).toBe('2002-01-01')
    expect(params.get('to')).toBe('2002-12-31')
  })
})

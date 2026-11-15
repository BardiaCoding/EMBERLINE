import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'
import { axe } from 'vitest-axe'
import { PRODUCT_SHORT_NAME } from '@/components/AppShell'
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
const DEFAULT_START = '2000-11-01'
const DEFAULT_END = '2003-12-31'

const calendarResult: CalendarOut = result(
  [
    month(2002, 7, 120.5, { raw_modis: 100, raw_viirs: 0 }),
    month(2002, 8, 0),
    month(2003, 12, 33, { raw_modis: 30, raw_viirs: 0 }),
  ],
  [],
)

const stats = statsResult({
  summary: {
    total_harmonized: 153.5,
    raw_modis: 130,
    raw_viirs: 0,
    frp_sum_mw: null,
    n_months: 3,
    includes_provisional: false,
  },
  current_month: currentMonth(),
  current_year: currentYear(),
  top_months: [{ year: 2002, month: 7, harmonized: 120.5 }],
  top_years: [{ year: 2002, harmonized: 120.5, n_months: 12 }],
})

const calendarRequests: CalendarRequest[] = []
const statsRequests: CalendarRequest[] = []

function useApi(
  options: {
    health?: number
    calendar?: () => Response | Promise<Response>
    stats?: () => Response | Promise<Response>
  } = {},
) {
  server.use(
    http.post(`${ORIGIN}/api/v1/stats`, async ({ request }) => {
      statsRequests.push((await request.json()) as CalendarRequest)
      return options.stats ? options.stats() : HttpResponse.json(stats)
    }),
    http.get(`${ORIGIN}/api/health`, () =>
      options.health === 503
        ? HttpResponse.json({ status: 'unavailable', data_present: false }, { status: 503 })
        : HttpResponse.json({ status: 'ok', data_present: true, latest_month: '2003-12' }),
    ),
    http.get(`${ORIGIN}/api/v1/meta`, () => HttpResponse.json(meta)),
    http.post(`${ORIGIN}/api/v1/calendar`, async ({ request }) => {
      calendarRequests.push((await request.json()) as CalendarRequest)
      return options.calendar ? options.calendar() : HttpResponse.json(calendarResult)
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
  statsRequests.length = 0
  setUrl('')
})
afterEach(() => {
  setUrl('')
})

describe('App with the API', () => {
  it('shows the cards, the Calendar and the legend for the full region and writes the default range to the URL', async () => {
    useApi()
    renderApp()

    expect(screen.getByRole('heading', { name: PRODUCT_SHORT_NAME })).toBeTruthy()
    expect(screen.getByText('California region')).toBeTruthy()

    const grid = await screen.findByRole('region', { name: 'Burning activity calendar' })
    expect(within(grid).getByRole('gridcell', { name: /^July 2002: 120.5 cell-days/ })).toBeTruthy()
    expect(screen.getByTestId('card-harmonized').textContent).toContain('153.5')
    expect(screen.getByTestId('card-raw-modis').textContent).toContain('130')
    expect(screen.getByRole('region', { name: 'Calendar legend' })).toBeTruthy()
    expect(screen.getByTestId('data-badge').textContent).toBe('Data to December 2003')

    // Full extent: no geometry, the default range.
    expect(calendarRequests).toEqual([{ geometry: null, start: DEFAULT_START, end: DEFAULT_END }])
    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get('from')).toBe(DEFAULT_START)
    })
    expect(new URLSearchParams(window.location.search).get('to')).toBe(DEFAULT_END)
  })

  it('restores the range from the URL, and an applied range updates the URL and the query', async () => {
    useApi()
    setUrl('?from=2002-01-01&to=2002-12-31&keep=1')
    renderApp()

    await screen.findByRole('region', { name: 'Burning activity calendar' })
    expect(calendarRequests[0]).toEqual({
      geometry: null,
      start: '2002-01-01',
      end: '2002-12-31',
    })
    expect(screen.queryByTestId('url-notice')).toBeNull()

    const user = userEvent.setup()
    const start = screen.getByLabelText('Start date')
    const end = screen.getByLabelText('End date')
    await user.clear(start)
    await user.type(start, '2003-01-01')
    await user.clear(end)
    await user.type(end, '2003-12-31')
    await user.click(screen.getByRole('button', { name: 'Apply date range' }))

    await waitFor(() => {
      expect(calendarRequests).toHaveLength(2)
    })
    expect(calendarRequests[1]).toEqual({
      geometry: null,
      start: '2003-01-01',
      end: '2003-12-31',
    })
    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get('from')).toBe('2003-01-01')
    })
    const params = new URLSearchParams(window.location.search)
    expect(params.get('from')).toBe('2003-01-01')
    expect(params.get('to')).toBe('2003-12-31')
    expect(params.get('keep')).toBe('1')
  })

  it('falls back to the default range with a notice when the URL range is invalid', async () => {
    useApi()
    setUrl('?from=2003-12-01&to=2001-01-01')
    renderApp()

    await screen.findByRole('region', { name: 'Burning activity calendar' })
    expect(calendarRequests[0]).toEqual({ geometry: null, start: DEFAULT_START, end: DEFAULT_END })
    expect(screen.getByTestId('url-notice').textContent).toContain('default range')
    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get('from')).toBe(DEFAULT_START)
    })
  })

  it('shows the full-page "Data not available" state when health answers 503', async () => {
    useApi({ health: 503 })
    renderApp()

    expect(await screen.findByRole('heading', { name: 'Data not available' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Burning activity calendar' })).toBeNull()
  })

  it('shows an error card for a failed Calendar request and Retry loads the results', async () => {
    let fail = true
    useApi({
      calendar: () =>
        fail
          ? HttpResponse.json(
              { error: { code: 'internal_error', message: 'Something broke.', request_id: 'r1' } },
              { status: 500 },
            )
          : HttpResponse.json(calendarResult),
    })
    renderApp()

    const card = await screen.findByTestId('error-card')
    expect(card.textContent).toContain('Something broke.')
    expect(screen.getByTestId('updating-label').textContent).toBe('Not updated')
    // The date range stays as entered.
    expect(screen.getByLabelText<HTMLInputElement>('Start date').value).toBe(DEFAULT_START)

    fail = false
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('region', { name: 'Burning activity calendar' })).toBeTruthy()
    expect(screen.queryByTestId('error-card')).toBeNull()
  })

  it('shows the empty state when the area and range hold no cell-days', async () => {
    useApi({ calendar: () => HttpResponse.json(result([month(2002, 7, 0)])) })
    renderApp()

    expect((await screen.findByTestId('empty-state')).textContent).toContain('California region')
    expect(screen.queryByRole('region', { name: 'Burning activity calendar' })).toBeNull()
  })

  it('has no axe violations once results are shown', async () => {
    useApi()
    const { container } = renderApp()
    await screen.findByRole('region', { name: 'Burning activity calendar' })
    expect(await axe(container)).toHaveNoViolations()
  })
})

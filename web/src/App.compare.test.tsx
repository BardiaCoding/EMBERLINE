import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'
import type { CalendarOut, ExampleArea, MetaOut, NormalizeRequest } from '@/lib/api'
import type { AreaGeometry } from '@/lib/areaGeometry'
import { month, result } from '@/lib/binning.fixtures'
import { QueryProvider } from '@/lib/QueryProvider'
import { createQueryClient } from '@/lib/queryClient'
import { statsResult } from '@/lib/stats.fixtures'
import { server } from '@/test/server'
import { App } from './App'

// Comparison mode in the running app (task 28.6; requirements 19.1, 19.4, 19.5). The second
// panel has its own /calendar request, both panels share one colour scale and the settings are
// in the page address. TEST FIXTURE values, not NASA data.
vi.mock('@/features/map/MapCanvas', () => ({
  MapCanvas: ({ label }: { label: string }) => <div role="img" aria-label={label} />,
}))

const ORIGIN = window.location.origin
const SECOND_AREA: AreaGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [-119, 36],
      [-118, 36],
      [-118, 38],
      [-119, 38],
      [-119, 36],
    ],
  ],
}
const EXAMPLES: ExampleArea[] = [
  { name: 'Test area one', description: 'Synthetic.', geometry: SECOND_AREA },
]
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
  example_areas: EXAMPLES,
  bounds_available: false,
}

// Panel 1 (full region): values 10 to 30. Panel 2 (the example area): values 100 to 300.
const small: CalendarOut = {
  ...result([month(2002, 6, 10), month(2002, 7, 20), month(2002, 8, 30)], []),
  area_km2: 100_000,
}
const large: CalendarOut = {
  ...result([month(2002, 6, 100), month(2002, 7, 200), month(2002, 8, 300)], []),
  area_km2: 20_000,
}
type CalendarBody = { geometry: unknown; start: string; end: string }
const calendarBodies: CalendarBody[] = []

function mockApi(): void {
  server.use(
    http.get(`${ORIGIN}/api/health`, () =>
      HttpResponse.json({ status: 'ok', data_present: true, latest_month: '2003-12' }),
    ),
    http.get(`${ORIGIN}/api/v1/meta`, () => HttpResponse.json(meta)),
    http.post(`${ORIGIN}/api/v1/stats`, () => HttpResponse.json(statsResult())),
    http.post(`${ORIGIN}/api/v1/calendar`, async ({ request }) => {
      const body = (await request.json()) as CalendarBody
      calendarBodies.push(body)
      return HttpResponse.json(body.geometry === null ? small : large)
    }),
    http.post(`${ORIGIN}/api/v1/selection/normalize`, async ({ request }) => {
      const body = (await request.json()) as NormalizeRequest
      return HttpResponse.json({
        geometry: body.geometry as AreaGeometry,
        clipped: false,
        clipped_percent: 0,
        n_cells: 7,
        notice: null,
        ignored_features: 0,
      })
    }),
    http.post(`${ORIGIN}/api/v1/map-layer`, () =>
      HttpResponse.json({
        mode: 'points',
        total: 0,
        max_points: 5000,
        points: [],
        cells: [],
        cell_size_deg: 0.1,
        label: 'TEST FIXTURE, not NASA data',
        time_convention: 'local standard time, UTC-8',
        month: null,
      }),
    ),
  )
}

beforeEach(() => {
  calendarBodies.length = 0
  window.sessionStorage.clear()
  window.history.replaceState(null, '', '/')
  mockApi()
})

function renderApp(): void {
  render(
    <QueryProvider client={createQueryClient()}>
      <App />
    </QueryProvider>,
  )
}
const ready = () =>
  screen.findByRole('region', { name: 'Burning activity calendar' }, { timeout: 10_000 })

describe('comparison mode in the app', () => {
  it('shows two panels with one shared scale and keeps the settings in the address', async () => {
    renderApp()
    await ready()
    const user = userEvent.setup()
    // Single view first: one Calendar, no comparison section.
    expect(screen.queryByTestId('comparison')).toBeNull()
    expect(screen.getAllByRole('grid')).toHaveLength(1)

    await user.click(screen.getByLabelText('Compare Areas'))
    // The second panel waits for the full region (no second area chosen yet), then the user
    // picks the example area as the second area (the second "Test area one" button).
    const exampleButtons = await screen.findAllByRole('button', { name: 'Test area one' })
    expect(exampleButtons).toHaveLength(2)
    await user.click(exampleButtons[1] as HTMLElement)

    const comparison = await screen.findByTestId('comparison')
    await waitFor(() => {
      expect(within(comparison).getAllByRole('grid')).toHaveLength(2)
      expect(within(comparison).getAllByText(/Area 2: your second area/).length).toBeGreaterThan(0)
    })
    // Two requests: the full region (geometry null) and the second area (geometry sent).
    expect(calendarBodies.some((b) => b.geometry === null)).toBe(true)
    expect(calendarBodies.some((b) => b.geometry !== null)).toBe(true)

    // One legend for both panels. Panel 1 alone tops out at 30; the union reaches 300.
    await waitFor(() => {
      expect(screen.getByTestId('compare-legend').textContent).toContain('300')
    })
    const legend = screen.getByTestId('compare-legend')
    expect(legend.textContent).toContain('10.0')
    expect(legend.textContent).toContain('both panels')
    expect(within(comparison).getAllByRole('region', { name: 'Calendar legend' })).toHaveLength(1)

    // Per-1000 km2 uses the area from the API: 60 cell-days / 100,000 km2 = 0.6 per 1000 km2.
    await user.click(screen.getByLabelText('Toggle per-area normalization'))
    await waitFor(() => {
      expect(within(comparison).getByText(/per 1000 km²/, { selector: 'p' })).toBeTruthy()
    })
    expect(within(comparison).getByText(/Total: 0\.6 /)).toBeTruthy()
    expect(within(comparison).getByText(/Total: 30\.0 /)).toBeTruthy()

    // The address holds the comparison settings.
    await waitFor(
      () => {
        const params = new URLSearchParams(window.location.search)
        expect(params.get('cmp')).toBe('area')
        expect(params.get('pa')).toBe('1')
        expect(params.get('a2')).toBeTruthy()
      },
      { timeout: 3000 },
    )
  })

  it('compares two date ranges with a second request for the same area', async () => {
    renderApp()
    await ready()
    const user = userEvent.setup()
    await user.click(screen.getByLabelText('Compare Periods'))
    const comparison = await screen.findByTestId('comparison')
    await waitFor(() => {
      expect(within(comparison).getAllByRole('grid')).toHaveLength(2)
    })
    expect(within(comparison).getAllByText(/Period 1:/).length).toBeGreaterThan(0)
    expect(within(comparison).getAllByText(/Period 2:/).length).toBeGreaterThan(0)
    await waitFor(
      () => {
        const params = new URLSearchParams(window.location.search)
        expect(params.get('cmp')).toBe('period')
        expect(params.get('from2')).toBe('2000-11-01')
        expect(params.get('to2')).toBe('2003-12-31')
      },
      { timeout: 3000 },
    )
  })

  it('opens in comparison mode from the address', async () => {
    window.history.replaceState(null, '', '/?cmp=period&from2=2001-01-01&to2=2001-12-31')
    renderApp()
    const comparison = await screen.findByTestId('comparison', {}, { timeout: 10_000 })
    await waitFor(() => {
      expect(within(comparison).getAllByRole('grid')).toHaveLength(2)
    })
    expect(calendarBodies.some((b) => b.start === '2001-01-01' && b.end === '2001-12-31')).toBe(
      true,
    )
  })
})

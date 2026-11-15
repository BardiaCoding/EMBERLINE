import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'
import { axe } from 'vitest-axe'
import { App } from '@/App'
import { MethodsPage } from '@/features/methods/MethodsPage'
import type { CalendarOut, MetaOut } from '@/lib/api'
import { PRODUCT_SHORT_NAME } from '@/components/AppShell'
import { month, result } from '@/lib/binning.fixtures'
import { QueryProvider } from '@/lib/QueryProvider'
import { createQueryClient } from '@/lib/queryClient'
import { currentMonth, currentYear, statsResult } from '@/lib/stats.fixtures'
import { server } from './server'

// Accessibility of the main views (task 19.8, requirements 27.2 and 27.3).
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
  [month(2002, 7, 120.5, { raw_modis: 100, raw_viirs: 0 }), month(2003, 12, 33)],
  [],
)
const stats = statsResult({
  summary: {
    total_harmonized: 153.5,
    raw_modis: 130,
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

function useApi(healthy = true) {
  server.use(
    http.get(`${ORIGIN}/api/health`, () =>
      healthy
        ? HttpResponse.json({ status: 'ok', data_present: true, latest_month: '2003-12' })
        : HttpResponse.json({ status: 'unavailable', data_present: false }, { status: 503 }),
    ),
    http.get(`${ORIGIN}/api/v1/meta`, () => HttpResponse.json(meta)),
    http.post(`${ORIGIN}/api/v1/calendar`, () => HttpResponse.json(calendarResult)),
    http.post(`${ORIGIN}/api/v1/stats`, () => HttpResponse.json(stats)),
  )
}
function renderUi(ui: React.ReactElement) {
  return render(<QueryProvider client={createQueryClient()}>{ui}</QueryProvider>)
}

beforeEach(() => {
  window.history.replaceState(null, '', '/')
})
afterEach(() => {
  window.history.replaceState(null, '', '/')
  document.documentElement.classList.remove('dark')
})

describe('axe on the main views', () => {
  it.each([['light'], ['dark']])('results view, %s theme', async (theme) => {
    if (theme === 'dark') document.documentElement.classList.add('dark')
    useApi()
    const { container } = renderUi(<App />)
    await screen.findByRole('region', { name: 'Burning activity calendar' }, { timeout: 10_000 })
    expect(await axe(container)).toHaveNoViolations()
  })
  it('first view before results arrive', async () => {
    useApi()
    const { container } = renderUi(<App />)
    expect(await axe(container)).toHaveNoViolations()
    await screen.findByRole('region', { name: 'Burning activity calendar' }, { timeout: 10_000 })
  })
  it('unavailable-data view', async () => {
    useApi(false)
    const { container } = renderUi(<App />)
    await screen.findByRole('heading', { name: PRODUCT_SHORT_NAME })
    expect(await axe(container)).toHaveNoViolations()
  })
  it('methodology page', async () => {
    useApi()
    const { container } = renderUi(<MethodsPage />)
    await screen.findByRole('heading', { level: 1 })
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('keyboard operation', () => {
  it('uses no positive tabindex, and Tab moves through the controls without a trap', async () => {
    useApi()
    const user = userEvent.setup()
    const { container } = renderUi(<App />)
    await screen.findByRole('region', { name: 'Burning activity calendar' }, { timeout: 10_000 })
    expect(
      container.querySelectorAll('[tabindex]:not([tabindex="0"]):not([tabindex^="-"])'),
    ).toHaveLength(0)

    const seen = new Set<Element>()
    let leftDocument = 0
    for (let i = 0; i < 40; i++) {
      await user.tab()
      // Focus leaves the page once when it wraps from the last element to the first.
      if (document.activeElement === document.body) leftDocument += 1
      else seen.add(document.activeElement!)
    }
    expect(leftDocument).toBeLessThanOrEqual(1)
    // Focus kept moving to new elements, so nothing held it.
    expect(seen.size).toBeGreaterThan(10)
    // Shift+Tab walks back to the previous element.
    const before = document.activeElement
    await user.tab({ shift: true })
    expect(document.activeElement).not.toBe(before)
  })
})

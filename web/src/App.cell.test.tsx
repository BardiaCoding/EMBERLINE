import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'
import { axe } from 'vitest-axe'
import { anomaly, month, result } from '@/lib/binning.fixtures'
import { currentMonth, currentYear, statsResult } from '@/lib/stats.fixtures'
import type { CalendarOut, MetaOut } from '@/lib/api'
import { QueryProvider } from '@/lib/QueryProvider'
import { createQueryClient } from '@/lib/queryClient'
import { server } from '@/test/server'
import { App } from './App'

// Cell selection in the running app (requirements 15.10, 15.24 to 15.27, 27.9): tap, click or
// keyboard selects a Calendar cell, which opens the Detail_Panel and filters the map layer to that
// month as one action; the same cell again, "Close details", Escape and "Clear filter" undo both.

// jsdom has no WebGL: the map canvas is replaced by a stub. Radix popper needs ResizeObserver.
vi.mock('@/features/map/MapCanvas', () => ({
  MapCanvas: ({ label }: { label: string }) => <div role="img" aria-label={label} />,
}))
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

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
  [
    month(2002, 7, 120.5, { raw_modis: 100, anomaly: anomaly(20.5, 20.5) }),
    month(2002, 8, 30, { raw_modis: 25, anomaly: anomaly(-5, -14) }),
    month(2003, 12, 33, { raw_modis: 30, anomaly: anomaly(3, 10) }),
  ],
  [],
)
const stats = statsResult({
  summary: {
    total_harmonized: 183.5,
    raw_modis: 155,
    raw_viirs: 0,
    frp_sum_mw: null,
    n_months: 3,
    includes_provisional: false,
  },
  current_month: currentMonth(),
  current_year: currentYear(),
})

type MapLayerBody = { start: string; end: string; month?: string | null }
const mapRequests: MapLayerBody[] = []

function mockApi(): void {
  server.use(
    http.post(`${ORIGIN}/api/v1/stats`, () => HttpResponse.json(stats)),
    http.get(`${ORIGIN}/api/health`, () =>
      HttpResponse.json({ status: 'ok', data_present: true, latest_month: '2003-12' }),
    ),
    http.get(`${ORIGIN}/api/v1/meta`, () => HttpResponse.json(meta)),
    http.post(`${ORIGIN}/api/v1/calendar`, () => HttpResponse.json(calendarResult)),
    http.post(`${ORIGIN}/api/v1/map-layer`, async ({ request }) => {
      const body = (await request.json()) as MapLayerBody
      mapRequests.push(body)
      // 7 detections for a month request, 3 for the whole range, so the legend shows which one answered.
      return HttpResponse.json({
        mode: 'points',
        total: body.month ? 7 : 3,
        max_points: 5000,
        points: [
          { lat: 34.5, lon: -118.5, satellite: 'Aqua', local_date: '2002-07-10', frp: null },
        ],
        cells: [],
        cell_size_deg: 0.1,
        label: 'TEST FIXTURE, not NASA data',
        time_convention: 'local standard time, UTC-8',
        month: null,
      })
    }),
  )
}

function setUrl(search: string): void {
  window.history.replaceState(null, '', `/${search}`)
}

async function renderReady(search = ''): Promise<void> {
  mockApi()
  setUrl(search)
  render(
    <QueryProvider client={createQueryClient()}>
      <App />
    </QueryProvider>,
  )
  await screen.findByRole('region', { name: 'Burning activity calendar' }, { timeout: 5000 })
}

function cell(key: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[role="gridcell"][data-key="${key}"]`)
  if (el === null) throw new Error(`No Calendar cell ${key}`)
  return el
}
/** A finger tap: pointerdown, pointerup, then the click the browser adds. */
function tap(el: HTMLElement, kind: 'touch' | 'pen' = 'touch'): void {
  fireEvent.pointerDown(el, { pointerType: kind, clientX: 50, clientY: 50 })
  fireEvent.pointerUp(el, { pointerType: kind, clientX: 50, clientY: 50 })
  fireEvent.click(el)
}
const dialog = (name: string): HTMLElement => screen.getByRole('dialog', { name })
const noDialog = (): void => {
  expect(screen.queryByRole('dialog')).toBeNull()
}
// The results status live region (StatusAnnouncer): the visually hidden polite region.
const status = (): string =>
  document.querySelector('[role="status"][aria-atomic="true"]')?.textContent ?? ''
const urlParam = (name: string): string | null =>
  new URLSearchParams(window.location.search).get(name)
const lastMapRequest = (): MapLayerBody | undefined => mapRequests[mapRequests.length - 1]

beforeEach(() => {
  mapRequests.length = 0
})
afterEach(() => {
  setUrl('')
})

describe('selecting a Calendar cell in the app', () => {
  it('a touch tap opens the Detail_Panel, shows the chip, filters the map to the month and writes cell= to the address', async () => {
    await renderReady()
    noDialog()
    expect(screen.queryByTestId('month-filter-chip')).toBeNull()

    tap(cell('2002-07'))

    const panel = dialog('July 2002')
    expect(within(panel).getByRole('heading', { name: 'July 2002' })).toBeTruthy()
    expect(within(panel).getByRole('button', { name: 'Close details' })).toBeTruthy()
    expect(screen.getByTestId('month-filter-chip').textContent).toContain('Filtered to July 2002')
    expect(cell('2002-07').getAttribute('aria-selected')).toBe('true')
    expect(status()).toBe('Details for July 2002 opened.')
    await waitFor(() => {
      expect(lastMapRequest()?.month).toBe('2002-07')
    })
    await waitFor(() => {
      expect(urlParam('cell')).toBe('2002-07')
    })
  })

  it('a pen tap selects the same way', async () => {
    await renderReady()

    tap(cell('2002-08'), 'pen')

    expect(dialog('August 2002')).toBeTruthy()
  })

  it('a mouse click opens the panel and keeps it open (one click is one selection)', async () => {
    await renderReady()

    await userEvent.setup().click(cell('2002-07'))

    expect(dialog('July 2002')).toBeTruthy()
    expect(screen.getByTestId('month-filter-chip')).toBeTruthy()
  })

  it('a drag of 8 px or more opens nothing', async () => {
    await renderReady()
    const el = cell('2002-07')

    fireEvent.pointerDown(el, { pointerType: 'touch', clientX: 50, clientY: 50 })
    fireEvent.pointerUp(el, { pointerType: 'touch', clientX: 70, clientY: 50 })
    fireEvent.click(el)

    noDialog()
    expect(screen.queryByTestId('month-filter-chip')).toBeNull()
  })

  it('tapping the selected cell again closes the panel and clears the chip and the map month', async () => {
    await renderReady()
    tap(cell('2002-07'))
    await waitFor(() => {
      expect(screen.getByTestId('hotspot-summary').textContent).toContain('7 detections')
    })

    tap(cell('2002-07'))

    noDialog()
    expect(screen.queryByTestId('month-filter-chip')).toBeNull()
    expect(cell('2002-07').getAttribute('aria-selected')).toBe('false')
    expect(status()).toBe('Details closed.')
    await waitFor(() => {
      expect(screen.getByTestId('hotspot-summary').textContent).toContain('3 detections')
    })
    await waitFor(() => {
      expect(urlParam('cell')).toBeNull()
    })
  })

  it('selecting another cell while open switches the one panel, the chip and the map month', async () => {
    await renderReady()
    tap(cell('2002-07'))

    tap(cell('2002-08'))

    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(dialog('August 2002')).toBeTruthy()
    expect(screen.getByTestId('month-filter-chip').textContent).toContain('Filtered to August 2002')
    expect(status()).toBe('Details for August 2002 opened.')
    await waitFor(() => {
      expect(lastMapRequest()?.month).toBe('2002-08')
    })
  })

  it('Enter on a focused cell opens the panel; Escape closes it and returns focus to the cell', async () => {
    await renderReady()
    const user = userEvent.setup()
    act(() => {
      cell('2002-07').focus()
    })

    await user.keyboard('{Enter}')
    expect(dialog('July 2002')).toBeTruthy()

    await user.keyboard('{Escape}')
    noDialog()
    expect(screen.queryByTestId('month-filter-chip')).toBeNull()
    expect(document.activeElement).toBe(cell('2002-07'))
    expect(status()).toBe('Details closed.')
  })

  it('Space on a focused cell opens the panel', async () => {
    await renderReady()
    act(() => {
      cell('2002-08').focus()
    })

    await userEvent.setup().keyboard(' ')

    expect(dialog('August 2002')).toBeTruthy()
  })

  it('"Close details" closes the panel, clears the chip and returns focus to the cell', async () => {
    await renderReady()
    const user = userEvent.setup()
    await user.click(cell('2002-07'))

    await user.click(within(dialog('July 2002')).getByRole('button', { name: 'Close details' }))

    noDialog()
    expect(screen.queryByTestId('month-filter-chip')).toBeNull()
    expect(document.activeElement).toBe(cell('2002-07'))
    expect(status()).toBe('Details closed.')
    await waitFor(() => {
      expect(urlParam('cell')).toBeNull()
    })
  })

  it('"Clear filter" on the chip closes the panel and clears the map month', async () => {
    await renderReady()
    const user = userEvent.setup()
    await user.click(cell('2002-07'))

    await user.click(screen.getByRole('button', { name: 'Clear filter' }))

    noDialog()
    expect(screen.queryByTestId('month-filter-chip')).toBeNull()
    await waitFor(() => {
      expect(screen.getByTestId('hotspot-summary').textContent).toContain('3 detections')
    })
  })

  it('does not close when the user clicks or tabs elsewhere (non-modal, no focus trap)', async () => {
    await renderReady()
    const user = userEvent.setup()
    await user.click(cell('2002-07'))
    const panel = dialog('July 2002')

    await user.click(screen.getByRole('heading', { name: 'Area and dates' }))
    await user.click(screen.getByLabelText('Start date'))
    await user.tab()

    expect(screen.getByRole('dialog', { name: 'July 2002' })).toBe(panel)
    expect(document.activeElement && panel.contains(document.activeElement)).toBe(false)
  })

  it('opens from `cell=` in the page address', async () => {
    await renderReady('?cell=2002-08')

    expect(dialog('August 2002')).toBeTruthy()
    expect(screen.getByTestId('month-filter-chip').textContent).toContain('Filtered to August 2002')
    await waitFor(() => {
      expect(lastMapRequest()?.month).toBe('2002-08')
    })
  })

  it('shows nothing for a `cell=` outside the date range or with no data', async () => {
    await renderReady('?cell=1999-01')
    noDialog()
    expect(screen.queryByTestId('month-filter-chip')).toBeNull()
  })

  it('keeps the address in step after a selection: a later view change is written with cell=', async () => {
    await renderReady()
    const user = userEvent.setup()
    await user.click(cell('2002-07'))
    await waitFor(() => {
      expect(urlParam('cell')).toBe('2002-07')
    })

    await user.click(
      within(screen.getByRole('group', { name: 'Calendar view' })).getByRole('button', {
        name: /anomaly/i,
      }),
    )

    await waitFor(() => {
      expect(urlParam('v')).toBe('anomaly')
    })
    expect(urlParam('cell')).toBe('2002-07')
  })

  it('has no axe violations with the panel closed and with it open', async () => {
    await renderReady()
    expect(await axe(document.body)).toHaveNoViolations()

    await userEvent.setup().click(cell('2002-07'))
    dialog('July 2002')

    // The panel is rendered in a portal, so check the whole document, not a container.
    expect(await axe(document.body)).toHaveNoViolations()
  })
})

describe('the panel text equals the tooltip text (requirements 15.5, 15.24)', () => {
  /** [label, value] of each described field, in order. */
  const fieldsIn = (root: Element): string[][] =>
    Array.from(root.querySelectorAll('[data-field]')).map((f) => [
      f.querySelector('dt')?.textContent ?? '',
      f.querySelector('dd')?.textContent ?? '',
    ])

  it.each([
    ['a complete month', '', '2002-07'],
    // A range that starts on 15 July makes July a whole-month cell.
    ['a whole-month cell', '?from=2002-07-15&to=2003-12-31', '2002-07'],
  ])('for %s', async (_name, search, key) => {
    await renderReady(search)
    const user = userEvent.setup()

    await user.hover(cell(key))
    const tooltip = await screen.findByRole('tooltip')
    const wrapper = tooltip.closest('[data-radix-popper-content-wrapper]')
    expect(wrapper).not.toBeNull()
    const tooltipFields = fieldsIn(wrapper as Element)
    expect(tooltipFields.length).toBeGreaterThan(5)

    await user.click(cell(key))
    const panelFields = fieldsIn(dialog('July 2002'))

    expect(panelFields).toEqual(tooltipFields)
    if (search !== '') {
      expect(
        panelFields.some(
          ([label, value]) => label === 'Status' && (value ?? '').includes('Whole month'),
        ),
      ).toBe(true)
    }
  })
})

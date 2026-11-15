import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { vi } from 'vitest'
import { buildCalendarModel } from '@/lib/binning'
import { month, result } from '@/lib/binning.fixtures'
import {
  RESULTS_ABOVE_CALENDAR_VAR,
  measureAboveCalendar,
  useResultsAboveCalendar,
} from '@/features/results/useResultsAboveCalendar'
import { CalendarGrid } from './CalendarGrid'
import { REGION_SIZE_CLASS, ROW_HEIGHT } from './calendarStyles'

// Example test for the Calendar layout (task 19.18, requirements 26.10 and 26.11). It adds to
// `CalendarGrid.layout.test.tsx` (task 19.17), which covers the region role, name, tabindex,
// overflow, sticky classes, 32 px rows, scroll margins and the basic ResizeObserver update.
//
// jsdom does no layout, so these tests check the classes and styles that produce the layout.
// NOT TESTABLE HERE (manual, real browser): at 1440 x 900 CSS px and 100 % zoom the summary
// cards, the month header row and the 3 newest year rows are visible without page scrolling;
// the sticky header and year column stay fixed while scrolling; no horizontal page scrolling at
// the widths of requirement 26.6. `ResultsPanel` does not exist yet, so the hook is tested
// through a stand-in panel.
// Synthetic test values. TEST FIXTURE, not NASA data.

const observed: Element[] = []
let observerCallbacks: (() => void)[] = []
let disconnects = 0
class ResizeObserverStub {
  constructor(callback: () => void) {
    observerCallbacks.push(callback)
  }
  observe(target: Element): void {
    observed.push(target)
  }
  unobserve(): void {}
  disconnect(): void {
    disconnects += 1
  }
}

beforeEach(() => {
  observed.length = 0
  observerCallbacks = []
  disconnects = 0
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Tailwind spacing class `h-N` or `min-h-N` to rem (N x 0.25 rem). */
function remOf(classes: string, prefix: string): number {
  const match = new RegExp(`(?:^|\\s)${prefix}-(\\d+)(?:\\s|$)`).exec(classes)
  if (match?.[1] === undefined) throw new Error(`no ${prefix}-N class in "${classes}"`)
  return Number(match[1]) * 0.25
}

// Eleven years, one month each, so the newest-first order and the first 3 rows are checkable.
const years = Array.from({ length: 11 }, (_, i) => 2016 + i)
const model = buildCalendarModel(result(years.map((y, i) => month(y, 6, i + 1))), 'counts', {
  range: { start: '2016-01-01', end: '2026-12-31' },
  recordStart: '2000-11',
})

describe('Calendar layout constants', () => {
  it('uses 32 px rows and a minimum height of exactly the header plus 3 year rows', () => {
    const rowRem = remOf(ROW_HEIGHT, 'h')
    expect(rowRem * 16).toBe(32)
    expect(remOf(REGION_SIZE_CLASS, 'min-h')).toBe(4 * rowRem)
  })

  it('limits the region height to the viewport minus the space above it', () => {
    expect(REGION_SIZE_CLASS).toContain(
      `max-h-[calc(100dvh-var(${RESULTS_ABOVE_CALENDAR_VAR},0px))]`,
    )
  })
})

describe('Calendar rows', () => {
  it('lists the newest year directly under the header, the baseline median last', () => {
    render(<CalendarGrid model={model} />)
    const grid = screen.getByRole('grid')
    const rows = within(grid).getAllByRole('row')
    expect(rows).toHaveLength(years.length + 2)
    expect(rows.map((row) => row.getAttribute('aria-rowindex'))).toEqual(
      rows.map((_, i) => String(i + 1)),
    )
    expect(within(rows[0]!).getAllByRole('columnheader').length).toBe(14)
    const labels = rows.slice(1).map((row) => within(row).getByRole('rowheader').textContent)
    expect(labels).toEqual([...years].reverse().map(String).concat('Baseline median'))
    expect(grid.getAttribute('aria-rowcount')).toBe(String(rows.length))
    expect(grid.getAttribute('aria-colcount')).toBe('14')
  })

  it('stacks the corner above the header row and the header row above the year column', () => {
    render(<CalendarGrid model={model} />)
    const grid = screen.getByRole('grid')
    const [headerRow] = within(grid).getAllByRole('row')
    const z = (el: Element | undefined): number => {
      const m = /\bz-(\d+)\b/.exec(el?.className ?? '')
      return m?.[1] === undefined ? 0 : Number(m[1])
    }
    const corner = within(grid).getByRole('columnheader', { name: 'Year' })
    const yearCell = within(grid).getAllByRole('rowheader')[0]
    expect(z(corner)).toBeGreaterThan(z(headerRow))
    expect(z(headerRow)).toBeGreaterThan(z(yearCell))
    expect(z(yearCell)).toBeGreaterThan(0)
  })

  it('keeps the sticky year column opaque, so cells do not show through it', () => {
    render(<CalendarGrid model={model} />)
    const grid = screen.getByRole('grid')
    const [headerRow] = within(grid).getAllByRole('row')
    expect(headerRow?.className).toContain('bg-background')
    expect(within(grid).getByRole('columnheader', { name: 'Year' }).className).toContain(
      'bg-background',
    )
    for (const header of within(grid).getAllByRole('rowheader')) {
      expect(header.className).toContain('bg-background')
    }
  })
})

describe('Calendar width and keyboard access', () => {
  it('scrolls wide content inside the region instead of the page', () => {
    render(<CalendarGrid model={model} />)
    const region = screen.getByRole('region', { name: 'Burning activity calendar' })
    expect(region.className).toContain('overflow-auto')
    const grid = within(region).getByRole('grid')
    // Natural width, at least the region width; month columns at least 36 px (2.25 rem).
    expect(grid.className).toContain('w-max')
    expect(grid.className).toContain('min-w-full')
    const [headerRow] = within(grid).getAllByRole('row')
    expect(headerRow?.className).toContain('minmax(2.25rem,1fr)')
  })

  it('reaches the region with Tab, then one roving cell, and names the region', async () => {
    const user = userEvent.setup()
    render(<CalendarGrid model={model} description="Test area" />)
    const region = screen.getByRole('region', { name: 'Burning activity calendar' })
    await user.tab()
    expect(document.activeElement).toBe(region)
    const tabbable = within(region)
      .getAllByRole('gridcell')
      .filter((cell) => cell.getAttribute('tabindex') === '0')
    expect(tabbable).toHaveLength(1)
    await user.tab()
    expect(document.activeElement).toBe(tabbable[0])
    expect(region.getAttribute('aria-describedby')).toBeTruthy()
  })
})

describe('--results-above-calendar (stand-in panel)', () => {
  function Panel() {
    const above = useRef<HTMLDivElement>(null)
    const panel = useRef<HTMLDivElement>(null)
    useResultsAboveCalendar(above, panel)
    return (
      <div ref={panel} data-testid="panel">
        <div ref={above} data-testid="above" />
      </div>
    )
  }
  const bottomIs = (bottom: number) =>
    vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(() => ({ bottom }) as DOMRect)

  it('observes the element above the Calendar and disconnects on unmount', () => {
    bottomIs(100)
    const { unmount } = render(<Panel />)
    expect(observed).toEqual([screen.getByTestId('above')])
    unmount()
    expect(disconnects).toBe(1)
  })

  it('adds the page scroll offset to the measured bottom edge', () => {
    vi.stubGlobal('scrollY', 120)
    const el = document.createElement('div')
    bottomIs(200.4)
    expect(measureAboveCalendar(el)).toBe(321)
  })

  it('removes the variable on unmount', () => {
    bottomIs(250)
    const { unmount } = render(<Panel />)
    const panel = screen.getByTestId('panel')
    expect(panel.style.getPropertyValue(RESULTS_ABOVE_CALENDAR_VAR)).toBe('250px')
    unmount()
    expect(panel.style.getPropertyValue(RESULTS_ABOVE_CALENDAR_VAR)).toBe('')
  })

  it('also updates on window resize, and works without ResizeObserver', () => {
    vi.unstubAllGlobals()
    vi.stubGlobal('ResizeObserver', undefined)
    let bottom = 180
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ bottom }) as DOMRect,
    )
    render(<Panel />)
    const panel = screen.getByTestId('panel')
    expect(panel.style.getPropertyValue(RESULTS_ABOVE_CALENDAR_VAR)).toBe('180px')
    bottom = 140
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(panel.style.getPropertyValue(RESULTS_ABOVE_CALENDAR_VAR)).toBe('140px')
  })
})

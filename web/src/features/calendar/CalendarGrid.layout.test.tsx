import { act, render, screen, within } from '@testing-library/react'
import { useRef } from 'react'
import { vi } from 'vitest'
import { axe } from 'vitest-axe'
import { buildCalendarModel } from '@/lib/binning'
import { month, result } from '@/lib/binning.fixtures'
import {
  RESULTS_ABOVE_CALENDAR_VAR,
  useResultsAboveCalendar,
} from '@/features/results/useResultsAboveCalendar'
import { CalendarGrid } from './CalendarGrid'

// Layout is not measurable in jsdom, so these tests check the structural attributes, classes
// and styles that produce the layout. The real-browser check at 1440 x 900 stays manual.

let observerCallbacks: (() => void)[] = []
class ResizeObserverStub {
  constructor(callback: () => void) {
    observerCallbacks.push(callback)
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

// Synthetic test values. TEST FIXTURE, not NASA data.
const model = buildCalendarModel(
  result([month(2010, 5, 4), month(2011, 6, 8), month(2012, 7, 15), month(2013, 8, 2)]),
  'counts',
  { range: { start: '2010-01-01', end: '2013-12-31' }, recordStart: '2000-11' },
)

describe('CalendarGrid scroll region', () => {
  it('is a focusable labelled region that scrolls, with a minimum of header plus 3 rows', () => {
    render(<CalendarGrid model={model} />)
    const region = screen.getByRole('region', { name: 'Burning activity calendar' })
    expect(region.getAttribute('tabindex')).toBe('0')
    expect(region.className).toContain('overflow-auto')
    // 4 x 32 px = 8 rem (Tailwind min-h-32).
    expect(region.className).toContain('min-h-32')
    expect(region.className).toContain('--results-above-calendar')
    expect(region.className).toContain('100dvh')
  })

  it('keeps the month headers and the year column sticky', () => {
    render(<CalendarGrid model={model} />)
    const grid = screen.getByRole('grid')
    const [headerRow] = within(grid).getAllByRole('row')
    expect(headerRow?.className).toMatch(/\bsticky\b/)
    expect(headerRow?.className).toMatch(/\btop-0\b/)
    const monthHeader = within(grid).getByRole('columnheader', { name: 'January' })
    expect(monthHeader.className).toMatch(/\bh-8\b/)
    const corner = within(grid).getByRole('columnheader', { name: 'Year' })
    expect(corner.className).toMatch(/\bsticky\b/)
    expect(corner.className).toMatch(/\bleft-0\b/)
    for (const header of within(grid).getAllByRole('rowheader')) {
      expect(header.className).toMatch(/\bsticky\b/)
      expect(header.className).toMatch(/\bleft-0\b/)
    }
  })

  it('gives every row 32 px height and puts the newest year first', () => {
    render(<CalendarGrid model={model} />)
    const grid = screen.getByRole('grid')
    const years = within(grid)
      .getAllByRole('rowheader')
      .map((h) => h.textContent)
    expect(years).toEqual(['2013', '2012', '2011', '2010', 'Baseline median'])
    for (const row of within(grid).getAllByRole('row')) {
      for (const child of Array.from(row.children)) {
        expect(child.className).toMatch(/\bh-8\b/)
      }
    }
  })

  it('sets scroll-margin on cells equal to the sticky header height and year column width', () => {
    render(<CalendarGrid model={model} />)
    const cell = screen.getByRole('gridcell', { name: /^July 2012/ })
    expect(cell.style.scrollMarginTop).toBe('2rem')
    expect(cell.style.scrollMarginLeft).toBe('4.5rem')
  })

  it('has no accessibility violations', async () => {
    const { container } = render(<CalendarGrid model={model} />)
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('useResultsAboveCalendar', () => {
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

  it('sets the variable from the measured bottom edge and updates it from the ResizeObserver', () => {
    observerCallbacks = []
    let bottom = 412.2
    const spy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(() => ({ bottom }) as DOMRect)
    const { unmount } = render(<Panel />)
    const panel = screen.getByTestId('panel')
    expect(panel.style.getPropertyValue(RESULTS_ABOVE_CALENDAR_VAR)).toBe('413px')

    bottom = 300
    act(() => {
      observerCallbacks.forEach((callback) => {
        callback()
      })
    })
    expect(panel.style.getPropertyValue(RESULTS_ABOVE_CALENDAR_VAR)).toBe('300px')

    unmount()
    spy.mockRestore()
  })
})

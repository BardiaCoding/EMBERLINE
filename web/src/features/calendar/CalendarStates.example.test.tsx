import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { buildCalendarModel } from '@/lib/binning'
import { anomaly, month, result } from '@/lib/binning.fixtures'
import { MISSING, monthName } from '@/lib/format'
import { CalendarGrid } from './CalendarGrid'
import { CalendarTable } from './CalendarTable'

// Radix popper measures with ResizeObserver, which jsdom does not have.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

// Synthetic test values with awkward rounding. TEST FIXTURE, not NASA data.
const months = [
  month(2011, 12, 0.04),
  month(2012, 1, 12.45, { anomaly: anomaly(2.35, 10.1, { zscore: 0.5 }) }),
  month(2012, 2, 1234.56),
  month(2012, 3, 3),
  month(2012, 4, 250.44, { provisional: true }),
]
const model = buildCalendarModel(result(months, ['2012-04']), 'counts', {
  range: { start: '2011-12-15', end: '2012-06-30' },
  recordStart: '2000-11',
  latestMonth: '2012-04',
})

describe('Calendar keyboard navigation (task 19.9, requirement 27.2)', () => {
  it('moves the single tab stop to the cell that has focus, in one grid tab sequence', async () => {
    const user = userEvent.setup()
    render(<CalendarGrid model={model} />)
    const region = screen.getByRole('region', { name: 'Burning activity calendar' })
    const tabbable = () =>
      within(region)
        .getAllByRole('gridcell')
        .filter((cell) => cell.getAttribute('tabindex') === '0')
    expect(tabbable()).toHaveLength(1)
    const march = screen.getByRole('gridcell', { name: /^March 2012: 3\.0 cell-days/ })
    act(() => {
      march.focus()
    })
    expect(document.activeElement).toBe(march)
    expect(tabbable()).toEqual([march])
    // Shift+Tab leaves the grid for the region, Tab comes back to the same cell.
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(region)
    await user.tab()
    expect(document.activeElement).toBe(march)
  })
})

describe('Calendar table values equal the grid values (task 19.9, requirement 15.8)', () => {
  it('shows the same month, count and baseline median at the same rounding as each grid cell', () => {
    const { container } = render(
      <>
        <CalendarGrid model={model} />
        <CalendarTable model={model} />
      </>,
    )
    const table = container.querySelector('table')
    expect(table).not.toBeNull()
    const cells = screen
      .getAllByRole('gridcell', { name: /^[A-Z][a-z]+ \d{4}: [\d,.]+ cell-days/ })
      .filter((cell) => cell.hasAttribute('data-key'))
    expect(cells).toHaveLength(5)
    for (const cell of cells) {
      const key = cell.getAttribute('data-key') ?? ''
      const row = table?.querySelector(`tr[data-key="${key}"]`)
      expect(row, key).not.toBeNull()
      const gridCount = /: ([\d,.]+) cell-days/.exec(cell.getAttribute('aria-label') ?? '')?.[1]
      const [year, , count, , , , , , baseline] = Array.from(row?.querySelectorAll('th, td') ?? [])
      expect(count?.textContent).toBe(gridCount)
      expect(year?.textContent).toBe(key.slice(0, 4))
      expect(row?.textContent).toContain(monthName(Number(key.slice(5))))
      const gridBaseline = screen.getByRole('gridcell', {
        name: new RegExp(`^Baseline median for ${monthName(Number(key.slice(5)))}:`),
      })
      const text = gridBaseline.getAttribute('aria-label') ?? ''
      if (text.includes('not available')) expect(baseline?.textContent).toBe(MISSING)
      else expect(text).toContain(`${baseline?.textContent ?? '?'} cell-days`)
    }
  })

  it('lists exactly the grid cells that hold data', () => {
    const { container } = render(
      <>
        <CalendarGrid model={model} />
        <CalendarTable model={model} />
      </>,
    )
    const gridKeys = screen
      .getAllByRole('gridcell')
      .filter((c) => c.hasAttribute('data-key') && c.getAttribute('data-state') !== 'no_data')
      .map((c) => c.getAttribute('data-key'))
      .sort()
    const tableKeys = Array.from(container.querySelectorAll('tbody tr'))
      .map((r) => r.getAttribute('data-key'))
      .sort()
    expect(tableKeys).toEqual(gridKeys)
  })
})

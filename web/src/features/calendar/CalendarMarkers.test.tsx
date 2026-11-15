import { act, render, screen, within } from '@testing-library/react'
import { vi } from 'vitest'
import { buildCalendarModel, type CalendarModel } from '@/lib/binning'
import { month, result } from '@/lib/binning.fixtures'
import { CalendarGrid } from './CalendarGrid'
import { CalendarLegend } from './CalendarLegend'
import { CalendarTable } from './CalendarTable'

// Radix popper measures with ResizeObserver, which jsdom does not have.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

// Synthetic test values. TEST FIXTURE, not NASA data.
// 2011-12: whole month only (the range starts on the 15th).
// 2012-01: switchover only. 2012-02: provisional only. 2012-03: latest month only.
const separate = buildCalendarModel(
  result(
    [
      month(2011, 12, 4),
      month(2012, 1, 12.5),
      month(2012, 2, 7, { provisional: true }),
      month(2012, 3, 30),
    ],
    ['2012-02'],
  ),
  'counts',
  {
    range: { start: '2011-12-15', end: '2012-03-31' },
    recordStart: '2000-11',
    latestMonth: '2012-03',
  },
)

// One month that is all four at once.
const combined = buildCalendarModel(
  result([month(2012, 1, 9, { provisional: true })], ['2012-01']),
  'counts',
  { range: { start: '2012-01-10', end: '2012-01-20' }, recordStart: '2000-11' },
)

const plain = buildCalendarModel(result([month(2020, 5, 3), month(2020, 6, 5)]), 'counts', {
  range: { start: '2020-05-01', end: '2020-06-30' },
  recordStart: '2000-11',
  latestMonth: '2020-12',
})

const MARKERS = ['whole-month', 'provisional'] as const

function cellOf(key: string): HTMLElement {
  const found = screen.getAllByRole('gridcell').find((el) => el.getAttribute('data-key') === key)
  if (found === undefined) throw new Error(`no cell ${key}`)
  return found
}

function markersOf(cell: HTMLElement): string[] {
  return MARKERS.filter((m) => cell.querySelector(`[data-marker="${m}"]`) !== null)
}

function legendItems(model: CalendarModel): string[] {
  const { unmount } = render(<CalendarLegend model={model} />)
  const items = within(screen.getByRole('list', { name: 'Cell patterns and markers' }))
    .getAllByRole('listitem')
    .map((li) => li.textContent)
  unmount()
  return items
}

describe('Calendar month markers (19.21)', () => {
  it('draws a different marker for each state, on that state only', () => {
    render(<CalendarGrid model={separate} />)
    const whole = cellOf('2011-12')
    expect(markersOf(whole)).toEqual(['whole-month'])
    expect(whole.className).not.toContain('inset_0_0_0_2px')
    expect(whole.className).not.toContain('border-l-[4px]')
    expect(whole.className).not.toContain('border-dashed')

    const switchover = cellOf('2012-01')
    expect(markersOf(switchover)).toEqual([])
    expect(switchover.className).toContain('border-l-[4px]')
    expect(switchover.className).not.toContain('inset_0_0_0_2px')

    const provisional = cellOf('2012-02')
    expect(markersOf(provisional)).toEqual(['provisional'])
    expect(provisional.className).toContain('border-dashed')
    expect(provisional.className).not.toContain('inset_0_0_0_2px')

    const latest = cellOf('2012-03')
    expect(markersOf(latest)).toEqual([])
    expect(latest.className).toContain('inset_0_0_0_2px')
    expect(latest.className).not.toContain('border-dashed')
  })

  it('uses a top-left triangle for the whole month and a bottom-right circle for provisional', () => {
    render(<CalendarGrid model={combined} />)
    const cell = cellOf('2012-01')
    const triangle = cell.querySelector<HTMLElement>('[data-marker="whole-month"]')
    const circle = cell.querySelector<HTMLElement>('[data-marker="provisional"]')
    expect(triangle?.className).toContain('top-0')
    expect(triangle?.className).toContain('left-0')
    expect(triangle?.style.clipPath).toContain('polygon')
    expect(circle?.className).toContain('bottom-0.5')
    expect(circle?.className).toContain('right-0.5')
    expect(circle?.className).toContain('rounded-full')
    // Decorative: the same facts are in the accessible name.
    expect(triangle?.getAttribute('aria-hidden')).toBe('true')
    expect(circle?.getAttribute('aria-hidden')).toBe('true')
  })

  it('combines every marker on one cell and keeps the provisional cell without a colour fill', () => {
    render(<CalendarGrid model={combined} />)
    const cell = cellOf('2012-01')
    expect(markersOf(cell)).toEqual(['whole-month', 'provisional'])
    expect(cell.className).toContain('border-dashed')
    expect(cell.className).toContain('inset_0_0_0_2px')
    expect(cell.className).toContain('border-l-[4px]')
    expect(cell.getAttribute('data-class')).toBeNull()
    expect(cell.getAttribute('style') ?? '').not.toContain('background-color: rgb')
    const name = cell.getAttribute('aria-label') ?? ''
    expect(name).toContain('provisional, count to date')
    expect(name).toContain('whole month')
    expect(name).toContain('latest month')
    expect(name).toContain('switchover month')
  })

  it('names each state in the cell accessible name, so no state depends on colour', () => {
    render(<CalendarGrid model={separate} />)
    expect(cellOf('2011-12').getAttribute('aria-label')).toContain('whole month')
    expect(cellOf('2012-01').getAttribute('aria-label')).toContain('switchover month')
    expect(cellOf('2012-02').getAttribute('aria-label')).toContain('provisional')
    expect(cellOf('2012-03').getAttribute('aria-label')).toContain('latest month')
    expect(cellOf('2012-03').getAttribute('aria-label')).not.toContain('provisional')
  })

  it('has a legend entry for each marker that is shown, with its shape', () => {
    const items = legendItems(separate)
    expect(items.some((t) => /^Hatched/.test(t))).toBe(true)
    expect(items.some((t) => /Thick left edge: January 2012/.test(t))).toBe(true)
    expect(items.some((t) => /^Triangle in the top-left corner: whole month/.test(t))).toBe(true)
    expect(items.some((t) => /^Ring just inside the cell edge: latest month/.test(t))).toBe(true)
    expect(
      items.some((t) =>
        /^Dashed border and circle in the bottom-right corner: provisional/.test(t),
      ),
    ).toBe(true)
  })

  it('lists the provisional entry only while a provisional month is displayed', () => {
    const items = legendItems(plain)
    expect(items).toHaveLength(1) // only the hatch entry
    expect(items.some((t) => /provisional/i.test(t))).toBe(false)
    expect(items.some((t) => /Triangle|Ring|Thick left edge/.test(t))).toBe(false)
    // Same data, but the provisional month is outside the Date_Range: no entry.
    const outside = buildCalendarModel(
      result([month(2020, 5, 3), month(2020, 6, 5, { provisional: true })], ['2020-06']),
      'counts',
      { range: { start: '2020-05-01', end: '2020-05-31' }, recordStart: '2000-11' },
    )
    expect(legendItems(outside).some((t) => /provisional/i.test(t))).toBe(false)
  })

  it('draws the legend samples with the same shapes as the cells', () => {
    render(<CalendarLegend model={combined} />)
    const list = screen.getByRole('list', { name: 'Cell patterns and markers' })
    expect(list.querySelector('[data-marker="whole-month"]')).not.toBeNull()
    expect(list.querySelector('[data-marker="provisional"]')).not.toBeNull()
    expect(list.innerHTML).toContain('inset_0_0_0_2px')
    expect(list.innerHTML).toContain('border-l-[4px]')
  })

  it('shows a Status line for each state in the tooltip', async () => {
    render(<CalendarGrid model={separate} />)
    const expected: [string, string][] = [
      ['2011-12', 'Whole month'],
      ['2012-01', 'Switchover (native to calibrated)'],
      ['2012-02', 'Provisional'],
      ['2012-03', 'Latest month'],
    ]
    for (const [key, word] of expected) {
      act(() => {
        cellOf(key).focus()
      })
      const tip = await screen.findByRole('tooltip')
      const status = tip.querySelector('[data-field="status"]')
      expect(status?.textContent).toContain(word)
      act(() => {
        cellOf(key).blur()
      })
    }
  })

  it('lists every state in the tooltip of a cell that has all of them', async () => {
    render(<CalendarGrid model={combined} />)
    act(() => {
      cellOf('2012-01').focus()
    })
    const tip = await screen.findByRole('tooltip')
    const status = tip.querySelector('[data-field="status"]')?.textContent ?? ''
    for (const word of ['Provisional', 'Whole month', 'Latest month', 'Switchover']) {
      expect(status).toContain(word)
    }
    expect(tip.textContent).not.toContain('Percent difference') // provisional: no anomaly
  })

  it('has a Status column with the status word of each state, and Complete otherwise', () => {
    const first = render(<CalendarTable model={separate} />)
    const table = screen.getByRole('table')
    const header = within(table).getAllByRole('columnheader')
    expect(header[header.length - 1]?.textContent).toBe('Status')
    const status = (key: string): string => {
      const row = table.querySelector(`tr[data-key="${key}"]`)
      return row?.querySelector('td:last-child')?.textContent ?? ''
    }
    expect(status('2011-12')).toBe('Whole month')
    expect(status('2012-01')).toBe('Switchover (native to calibrated)')
    expect(status('2012-02')).toBe('Provisional')
    expect(status('2012-03')).toBe('Latest month')

    first.unmount()
    render(<CalendarTable model={plain} />)
    const plainRow = screen.getByRole('table').querySelector('tr[data-key="2020-05"]')
    expect(plainRow?.querySelector('td:last-child')?.textContent).toBe('Complete')
  })

  it('lists all states in the Status column of a cell that has them all', () => {
    render(<CalendarTable model={combined} />)
    const row = screen.getByRole('table').querySelector('tr[data-key="2012-01"]')
    expect(row?.querySelector('td:last-child')?.textContent).toBe(
      'Provisional, Whole month, Latest month, Switchover (native to calibrated)',
    )
  })

  it('takes the latest and provisional months from the API values, not the browser clock', () => {
    vi.useFakeTimers()
    try {
      for (const now of ['2001-03-05T00:00:00Z', '2035-11-20T00:00:00Z']) {
        vi.setSystemTime(new Date(now))
        const model = buildCalendarModel(
          result([month(2012, 2, 7, { provisional: true }), month(2012, 3, 30)], ['2012-02']),
          'counts',
          {
            range: { start: '2012-01-01', end: '2012-12-31' },
            recordStart: '2000-11',
            latestMonth: '2012-03',
          },
        )
        const cells = model.rows.flatMap((r) => r.cells)
        expect(cells.filter((c) => c.latest).map((c) => c.key)).toEqual(['2012-03'])
        expect(cells.filter((c) => c.provisional).map((c) => c.key)).toEqual(['2012-02'])
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('marks no month as latest or provisional when the API reports none', () => {
    const cells = plain.rows.flatMap((r) => r.cells)
    expect(cells.some((c) => c.latest || c.provisional)).toBe(false)
  })
})

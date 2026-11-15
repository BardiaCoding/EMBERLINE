import { render, screen, within } from '@testing-library/react'
import { buildCalendarModel, type CalendarView } from '@/lib/binning'
import { month, result } from '@/lib/binning.fixtures'
import { CalendarLegend } from './CalendarLegend'

// Synthetic test values. TEST FIXTURE, not NASA data.
const UNIT = 'cell-days per month (MODIS-equivalent)'
const SENTENCE =
  'Colours are set from the cells shown here only. They cannot be compared between different areas or date ranges.'

function monthsOf(values: number[], year = 2015) {
  return values.map((v, i) => month(year + Math.floor(i / 12), (i % 12) + 1, v))
}

function classItems() {
  return within(screen.getByRole('list', { name: 'Colour classes' })).getAllByRole('listitem')
}

describe('CalendarLegend relative-colours statement and bin edges (19.19)', () => {
  const values = [0, 0, 1.2, 3.4, 5.6, 8.1, 13.7, 20.2, 31.5, 55.9, 90.3, 140.8, 250.4, 400.1]

  it('shows the sentence in the counts view only', () => {
    for (const view of ['counts', 'anomaly', 'diff'] as CalendarView[]) {
      const { unmount } = render(
        <CalendarLegend model={buildCalendarModel(result(monthsOf(values)), view)} />,
      )
      if (view === 'counts') expect(screen.getByText(SENTENCE)).toBeTruthy()
      else expect(screen.queryByText(/Colours are set from the cells shown here only/)).toBeNull()
      unmount()
    }
  })

  it('lists every class with its edge range from model.bins and the unit', () => {
    const model = buildCalendarModel(result(monthsOf(values)), 'counts')
    render(<CalendarLegend model={model} />)
    const items = classItems()
    expect(items).toHaveLength(model.bins.length)
    expect(model.bins.length).toBeGreaterThan(2)
    model.bins.forEach((bin, i) => {
      expect(items[i]?.textContent).toContain(bin.label)
      expect(items[i]?.textContent).toContain(UNIT)
    })
    // Edges are the 1-decimal values of the data table.
    const edgeTexts = model.edges.map((e) => e.toFixed(1))
    for (const text of edgeTexts) {
      expect(classItems().some((li) => li.textContent.includes(text))).toBe(true)
    }
    expect(model.unit).toBe(UNIT)
  })

  it('updates the edges when the query changes', () => {
    const first = buildCalendarModel(result(monthsOf(values)), 'counts')
    const second = buildCalendarModel(result(monthsOf(values.map((v) => v * 2 + 1))), 'counts')
    const { rerender } = render(<CalendarLegend model={first} />)
    const before = classItems().map((li) => li.textContent)
    rerender(<CalendarLegend model={second} />)
    const after = classItems().map((li) => li.textContent)
    expect(after).not.toEqual(before)
    second.bins.forEach((bin, i) => {
      expect(after[i]).toContain(bin.label)
    })
  })

  it('lists no empty class when edges collapse', () => {
    const model = buildCalendarModel(result(monthsOf([0, 4, 4, 4, 4, 4, 4, 9])), 'counts')
    render(<CalendarLegend model={model} />)
    const items = classItems()
    expect(items).toHaveLength(model.bins.length)
    expect(model.bins.length).toBeLessThan(8)
    expect(model.bins.every((b) => b.kind === 'zero' || b.cells > 0)).toBe(true)
    const labels = items.map((li) => li.textContent)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('lists only the zero class when every displayed month is 0', () => {
    const model = buildCalendarModel(result(monthsOf([0, 0, 0])), 'counts')
    render(<CalendarLegend model={model} />)
    expect(classItems()).toHaveLength(1)
    expect(classItems()[0]?.textContent).toContain('0')
  })
})

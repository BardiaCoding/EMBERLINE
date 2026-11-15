import { render, screen, within } from '@testing-library/react'
import { buildCalendarModel } from '@/lib/binning'
import { month, result } from '@/lib/binning.fixtures'
import { formatCount } from '@/lib/format'
import { CalendarLegend } from './CalendarLegend'

// Example test for the counts-view legend (task 19.20), complementing CalendarLegend.test.tsx:
// the edge texts are rebuilt independently with `formatCount` from `format.ts`.
// Synthetic test values. TEST FIXTURE, not NASA data.

function monthsOf(values: number[]) {
  return values.map((v, i) => month(2015 + Math.floor(i / 12), (i % 12) + 1, v))
}

function classTexts(): string[] {
  const list = screen.getByRole('list', { name: 'Colour classes' })
  return within(list)
    .getAllByRole('listitem')
    .map((li) => li.textContent)
}

describe('CalendarLegend counts-view edges (19.20)', () => {
  // Includes values of 1,000 or more, so the thousands separator of format.ts is exercised.
  const values = [0, 0, 1.24, 3.46, 5.65, 8.14, 13.7, 20.2, 31.55, 55.95, 190.3, 1234.56, 2500.04]

  it('shows each class edge range as format.ts rounds the model.bins edges', () => {
    const model = buildCalendarModel(result(monthsOf(values)), 'counts')
    render(<CalendarLegend model={model} />)
    const texts = classTexts()
    expect(texts).toHaveLength(model.bins.length)
    const unit = 'cell-days per month (MODIS-equivalent)'
    model.bins.forEach((bin, i) => {
      if (bin.kind === 'zero') {
        expect(texts[i]).toContain('0')
        return
      }
      const lower = formatCount(bin.lower)
      const expected =
        bin.upper !== null
          ? `${lower} to under ${formatCount(bin.upper)}`
          : `${lower} to ${formatCount(bin.max)}`
      expect(texts[i]).toContain(`${expected} ${unit}`)
    })
    // The inner edges of the model are the class boundaries shown, with a thousands separator.
    for (const edge of model.edges) {
      expect(texts.some((t) => t.includes(formatCount(edge)))).toBe(true)
    }
    expect(texts.join(' ')).toContain('2,500.0')
  })

  it('changes the shown edges when the data of the query change', () => {
    const first = buildCalendarModel(result(monthsOf(values)), 'counts')
    const second = buildCalendarModel(result(monthsOf(values.map((v) => v + 7))), 'counts')
    expect(second.edges).not.toEqual(first.edges)
    const { rerender } = render(<CalendarLegend model={first} />)
    const before = classTexts().join('|')
    rerender(<CalendarLegend model={second} />)
    const after = classTexts().join('|')
    expect(after).not.toBe(before)
    for (const edge of second.edges) expect(after).toContain(formatCount(edge))
  })

  it('shows one class per distinct edge range and no empty class when edges collapse', () => {
    const model = buildCalendarModel(result(monthsOf([0, 4, 4, 4, 4, 4, 4, 9])), 'counts')
    render(<CalendarLegend model={model} />)
    const texts = classTexts()
    // The zero class plus one non-zero class for each gap between the surviving edges.
    expect(texts).toHaveLength(model.edges.length + 2)
    expect(model.edges.length).toBeLessThan(6)
    expect(new Set(texts).size).toBe(texts.length)
    for (const bin of model.bins) {
      if (bin.kind === 'range') expect(bin.cells).toBeGreaterThan(0)
    }
  })
})

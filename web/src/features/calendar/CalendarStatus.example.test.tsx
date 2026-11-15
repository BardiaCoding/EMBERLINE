import { act, render, screen, within } from '@testing-library/react'
import { vi } from 'vitest'
import { buildCalendarModel, type CalendarModel } from '@/lib/binning'
import { month, result } from '@/lib/binning.fixtures'
import { CalendarGrid } from './CalendarGrid'
import { CalendarLegend } from './CalendarLegend'

// Example test for the month status markers (task 19.22), complementing CalendarMarkers.test.tsx
// (19.21): each state alone gives exactly its own marker, legend entry and tooltip word, and the
// legend lists a separate entry for each state when one displayed Calendar has all of them.
// Synthetic test values. TEST FIXTURE, not NASA data.

// Radix popper measures with ResizeObserver, which jsdom does not have.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

const RECORD_START = '2000-11'

type State = 'whole' | 'switchover' | 'latest' | 'provisional'

// One model per state, in which only that state applies to the cell under test.
const alone: Record<State, { model: CalendarModel; key: string; word: string; legend: RegExp }> = {
  whole: {
    model: buildCalendarModel(result([month(2015, 5, 4)]), 'counts', {
      range: { start: '2015-05-15', end: '2015-05-31' },
      recordStart: RECORD_START,
    }),
    key: '2015-05',
    word: 'Whole month',
    legend: /^Triangle in the top-left corner: whole month/,
  },
  switchover: {
    model: buildCalendarModel(result([month(2012, 1, 12.5)]), 'counts', {
      range: { start: '2012-01-01', end: '2012-01-31' },
      recordStart: RECORD_START,
    }),
    key: '2012-01',
    word: 'Switchover (native to calibrated)',
    legend: /^Thick left edge: January 2012/,
  },
  latest: {
    model: buildCalendarModel(result([month(2015, 5, 4)]), 'counts', {
      range: { start: '2015-05-01', end: '2015-05-31' },
      recordStart: RECORD_START,
      latestMonth: '2015-05',
    }),
    key: '2015-05',
    word: 'Latest month',
    legend: /^Ring just inside the cell edge: latest month/,
  },
  provisional: {
    model: buildCalendarModel(
      result([month(2015, 5, 4, { provisional: true })], ['2015-05']),
      'counts',
      {
        range: { start: '2015-05-01', end: '2015-05-31' },
        recordStart: RECORD_START,
        // Without this, the last provisional month doubles as the latest month.
        latestMonth: '2015-06',
      },
    ),
    key: '2015-05',
    word: 'Provisional',
    legend: /^Dashed border and circle in the bottom-right corner: provisional/,
  },
}

const STATES = Object.keys(alone) as State[]

// One displayed Calendar with every state: 2011-12 whole month (range starts on the 15th),
// 2012-01 switchover, 2012-02 provisional, 2012-03 latest month.
const all = buildCalendarModel(
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
    recordStart: RECORD_START,
    latestMonth: '2012-03',
  },
)

function legendTexts(model: CalendarModel): string[] {
  const { unmount } = render(<CalendarLegend model={model} />)
  const items = within(screen.getByRole('list', { name: 'Cell patterns and markers' }))
    .getAllByRole('listitem')
    .map((li) => li.textContent)
  unmount()
  return items
}

function cellOf(key: string): HTMLElement {
  const found = screen.getAllByRole('gridcell').find((el) => el.getAttribute('data-key') === key)
  if (found === undefined) throw new Error(`no cell ${key}`)
  return found
}

describe('Calendar month status markers, one state at a time (19.22)', () => {
  it.each(STATES)('%s: the legend has its entry and none of the other state entries', (state) => {
    const items = legendTexts(alone[state].model)
    // Hatch entry plus exactly this state's entry.
    expect(items).toHaveLength(2)
    expect(items.filter((t) => alone[state].legend.test(t))).toHaveLength(1)
    for (const other of STATES.filter((s) => s !== state)) {
      expect(items.some((t) => alone[other].legend.test(t))).toBe(false)
    }
  })

  it.each(STATES)('%s: the tooltip Status line holds only its own word', async (state) => {
    const { model, key, word } = alone[state]
    render(<CalendarGrid model={model} />)
    act(() => {
      cellOf(key).focus()
    })
    const tip = await screen.findByRole('tooltip')
    expect(tip.querySelector('[data-field="status"]')?.textContent).toContain(word)
    for (const other of STATES.filter((s) => s !== state)) {
      expect(tip.querySelector('[data-field="status"]')?.textContent).not.toContain(
        alone[other].word,
      )
    }
  })

  it('lists one separate legend entry for each state when all are displayed', () => {
    const items = legendTexts(all)
    expect(items).toHaveLength(5) // hatch + the four states
    for (const state of STATES) {
      expect(items.filter((t) => alone[state].legend.test(t))).toHaveLength(1)
    }
    expect(new Set(items).size).toBe(items.length)
  })
})

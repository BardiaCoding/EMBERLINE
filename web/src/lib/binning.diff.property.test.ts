// Feature: harmonized-fire-calendar, Property 46: Month-to-month difference
// Validates: Requirements 15.3
// Inputs are synthetic (TEST FIXTURE, not NASA data).
import * as fc from 'fast-check'
import type { MonthOut } from '@/lib/api'
import { calendarResult, calendarResultWithGaps, type CalendarScenario } from '@/test/arbitraries'
import { buildCalendarModel, type CalendarCell } from './binning'

const RUNS = { numRuns: 200 }

const keyOf = (year: number, month: number): string =>
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`

/** The previous month's key; January uses the December of the previous year. */
const previousKeyOf = (year: number, month: number): string =>
  month === 1 ? keyOf(year - 1, 12) : keyOf(year, month - 1)

/**
 * The series shown by the Calendar, read straight from the API result and the query options:
 * month key to the API month, for months inside the record, the latest month and the Date_Range.
 */
function displayedSeries({ result, options }: CalendarScenario): Map<string, MonthOut> {
  const { range, recordStart, latestMonth } = options
  const startMonth = range.start.slice(0, 7)
  const endMonth = range.end.slice(0, 7)
  const series = new Map<string, MonthOut>()
  for (const m of result.months) {
    const key = keyOf(m.year, m.month)
    if (key >= startMonth && key <= endMonth && key >= recordStart && key <= latestMonth) {
      series.set(key, m)
    }
  }
  return series
}

const isProvisional = ({ result }: CalendarScenario, m: MonthOut): boolean =>
  m.provisional || result.provisional_months.includes(keyOf(m.year, m.month))

/** x[y, m] - x[y, m-1], or null when either month is not displayed (or is provisional). */
function expectedDiff(
  scenario: CalendarScenario,
  series: Map<string, MonthOut>,
  cell: CalendarCell,
): number | null {
  const current = series.get(keyOf(cell.year, cell.month))
  const previous = series.get(previousKeyOf(cell.year, cell.month))
  if (current === undefined || previous === undefined) return null
  if (isProvisional(scenario, current) || isProvisional(scenario, previous)) return null
  return current.harmonized - previous.harmonized
}

function expectDiffs(scenario: CalendarScenario): void {
  const series = displayedSeries(scenario)
  const { result, options } = scenario
  const model = buildCalendarModel(result, 'diff', options)
  for (const cell of model.rows.flatMap((r) => r.cells)) {
    const expected = expectedDiff(scenario, series, cell)
    if (expected === null) {
      expect(cell.diff).toBeNull()
    } else {
      expect(cell.diff).toBeCloseTo(expected, 9)
    }
    // A difference is never invented for a month without data, and a month whose
    // previous month has no data is shown with the no-data pattern, not as 0.
    if (cell.state === 'no_data') expect(cell.diff).toBeNull()
    if (cell.diff === null && !cell.provisional) expect(cell.hatched).toBe(true)
    if (cell.diff !== null) {
      expect(cell.hatched).toBe(false)
      expect(cell.classIndex).not.toBeNull()
    }
  }
}

describe('Property 46: Month-to-month difference', () => {
  it('equals x[y, m] - x[y, m-1], with January using the previous December, null without a previous month', () => {
    fc.assert(
      fc.property(calendarResult(), (scenario) => {
        expectDiffs(scenario)
      }),
      RUNS,
    )
  })

  it('is null when the previous month has no data, over results with missing months', () => {
    fc.assert(
      fc.property(calendarResultWithGaps(), (scenario) => {
        expectDiffs(scenario)
      }),
      RUNS,
    )
  })

  it('does not depend on the view', () => {
    fc.assert(
      fc.property(calendarResultWithGaps(), ({ result, options }) => {
        const diffs = (view: 'counts' | 'anomaly' | 'diff'): (number | null)[] =>
          buildCalendarModel(result, view, options)
            .rows.flatMap((r) => r.cells)
            .map((c) => c.diff)
        expect(diffs('counts')).toEqual(diffs('diff'))
        expect(diffs('anomaly')).toEqual(diffs('diff'))
      }),
      RUNS,
    )
  })
})

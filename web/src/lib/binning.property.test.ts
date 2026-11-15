// Feature: harmonized-fire-calendar, Property 44: Calendar grid shape and no-data cells
// Validates: Requirements 15.1, 15.6, 15.7, 15.12
// Inputs are synthetic (TEST FIXTURE, not NASA data).
import * as fc from 'fast-check'
import { calendarResult, daysInMonthOf } from '@/test/arbitraries'
import { buildCalendarModel } from './binning'

const RUNS = { numRuns: 200 }

const monthKey = (year: number, month: number): string =>
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`

describe('Property 44: Calendar grid shape and no-data cells', () => {
  it('has one row per year of the Date_Range, 12 columns, and no_data exactly outside the record or range', () => {
    fc.assert(
      fc.property(calendarResult(), ({ result, options }) => {
        const model = buildCalendarModel(result, 'counts', options)
        const { range, recordStart, latestMonth } = options
        const startMonth = range.start.slice(0, 7)
        const endMonth = range.end.slice(0, 7)
        const startYear = Number(range.start.slice(0, 4))
        const endYear = Number(range.end.slice(0, 4))

        // One row per year, first to last year of the range, newest first.
        expect(model.rows.map((r) => r.year)).toEqual(
          Array.from({ length: endYear - startYear + 1 }, (_, i) => endYear - i),
        )
        expect(model.baselineMedians).toHaveLength(12)

        let anyNoData = false
        for (const row of model.rows) {
          expect(row.cells).toHaveLength(12)
          row.cells.forEach((cell, i) => {
            const key = monthKey(row.year, i + 1)
            expect([cell.year, cell.month, cell.key]).toEqual([row.year, i + 1, key])

            const outside =
              key < recordStart || key > latestMonth || key < startMonth || key > endMonth
            expect(cell.state === 'no_data').toBe(outside)
            anyNoData ||= outside

            const given = result.months.find((m) => m.year === row.year && m.month === i + 1)
            if (outside) {
              expect(cell.value).toBeNull()
              expect(cell.data).toBeNull()
              expect(cell.classIndex).toBeNull()
              expect(cell.colour).toBeNull()
            } else {
              // Zero cells are distinct from no-data cells: a count of 0 keeps its value.
              expect(given).toBeDefined()
              expect(cell.value).toBe(given?.harmonized)
              expect(cell.state).toBe(given?.harmonized === 0 ? 'zero' : 'value')
              if (given?.harmonized === 0 && !cell.provisional) expect(cell.classIndex).toBe(0)
            }
          })
        }
        expect(model.hasNoData).toBe(anyNoData)
      }),
      RUNS,
    )
  })

  it('marks whole-month only on displayed months where the range starts or ends partway', () => {
    fc.assert(
      fc.property(calendarResult(), ({ result, options }) => {
        const model = buildCalendarModel(result, 'counts', options)
        const { range } = options
        const startMonth = range.start.slice(0, 7)
        const endMonth = range.end.slice(0, 7)
        const endDays = daysInMonthOf(Number(endMonth.slice(0, 4)), Number(endMonth.slice(5, 7)))
        const startPartial = range.start.slice(8, 10) !== '01'
        const endPartial = Number(range.end.slice(8, 10)) !== endDays

        let any = false
        for (const cell of model.rows.flatMap((r) => r.cells)) {
          const expected =
            cell.state !== 'no_data' &&
            ((cell.key === startMonth && startPartial) || (cell.key === endMonth && endPartial))
          expect(cell.wholeMonth).toBe(expected)
          any ||= expected
        }
        expect(model.hasWholeMonth).toBe(any)
      }),
      RUNS,
    )
  })

  it('makes each year total the sum of its displayed months, and null when none is displayed', () => {
    fc.assert(
      fc.property(calendarResult(), ({ result, options }) => {
        const model = buildCalendarModel(result, 'counts', options)
        let grand = 0
        for (const row of model.rows) {
          const shown = row.cells.flatMap((c) => (c.value === null ? [] : [c.value]))
          if (shown.length === 0) {
            expect(row.total).toBeNull()
          } else {
            expect(row.total).toBeCloseTo(
              shown.reduce((s, v) => s + v, 0),
              6,
            )
          }
          grand += row.total ?? 0
        }
        expect(model.total).toBeCloseTo(grand, 6)
      }),
      RUNS,
    )
  })
})

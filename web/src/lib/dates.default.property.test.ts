// Feature: harmonized-fire-calendar, Property 51: Default Date_Range
// Validates: Requirements 14.8, 14.9
import fc from 'fast-check'
import { defaultDateRange } from './dates'

const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

/** Real dates between 2000-11-01 and 2035-12-31, as `YYYY-MM-DD`. */
const realDate: fc.Arbitrary<string> = fc
  .date({
    min: new Date('2000-11-01T00:00:00Z'),
    max: new Date('2035-12-31T00:00:00Z'),
    noInvalidDate: true,
  })
  .map((d) => iso(d.getTime()))

/** A first date F and a latest date L with F on or before L. */
const orderedPair: fc.Arbitrary<[string, string]> = fc
  .tuple(realDate, realDate)
  .map(([a, b]): [string, string] => (a <= b ? [a, b] : [b, a]))

/** Independent expectation: January 1 of the year of `latest` minus 10, or `first` when later. */
function expectedStart(first: string, latest: string): string {
  const tenYearsBack = `${String(Number(latest.slice(0, 4)) - 10).padStart(4, '0')}-01-01`
  return tenYearsBack < first ? first : tenYearsBack
}

describe('Property 51: default Date_Range', () => {
  it('ends with the latest date and starts on January 1 of Y - 10, or on the first date when that is later', () => {
    fc.assert(
      fc.property(orderedPair, ([first, latest]) => {
        const range = defaultDateRange(first, latest)
        expect(range.end).toBe(latest)
        expect(range.start).toBe(expectedStart(first, latest))
      }),
    )
  })

  it('never starts before the first date and never after the end', () => {
    fc.assert(
      fc.property(orderedPair, ([first, latest]) => {
        const range = defaultDateRange(first, latest)
        expect(range.start >= first).toBe(true)
        expect(range.start <= range.end).toBe(true)
      }),
    )
  })

  it('starts on January 1 of Y - 10 when the record is longer than that, else on the first date', () => {
    fc.assert(
      fc.property(orderedPair, ([first, latest]) => {
        const range = defaultDateRange(first, latest)
        const tenYearsBack = `${Number(latest.slice(0, 4)) - 10}-01-01`
        if (first <= tenYearsBack) {
          expect(range.start).toBe(tenYearsBack)
        } else {
          expect(range.start).toBe(first)
        }
      }),
    )
  })

  it('reads a YYYY-MM latest value as the last day of that month and a YYYY-MM first as its first day', () => {
    fc.assert(
      fc.property(orderedPair, ([first, later]) => {
        const latestMonth = later.slice(0, 7)
        const firstMonth = first.slice(0, 7)
        const monthEnd = iso(
          Date.UTC(Number(latestMonth.slice(0, 4)), Number(latestMonth.slice(5, 7)), 0),
        )
        const range = defaultDateRange(firstMonth, latestMonth)
        expect(range.end).toBe(monthEnd)
        expect(range.start).toBe(expectedStart(`${firstMonth}-01`, monthEnd))
      }),
    )
  })
})

// Feature: harmonized-fire-calendar, Property 47: Date presets and validation
// Validates: Requirements 14.2, 14.3, 14.7
import fc from 'fast-check'
import {
  availableRecord,
  CALENDAR_PRESETS,
  EXACT_PRESETS,
  presetRange,
  validateDateRange,
  wholeMonthNote,
  type DateRecord,
} from './dates'

const DAY_MS = 86_400_000
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10)
const ms = (date: string): number => Date.parse(`${date}T00:00:00Z`)

/** Real dates between 2000-11-01 and 2030-12-31, as `YYYY-MM-DD`. */
const realDate = fc
  .date({
    min: new Date('2000-11-01T00:00:00Z'),
    max: new Date('2030-12-31T00:00:00Z'),
    noInvalidDate: true,
  })
  .map((d) => iso(d.getTime()))

type Scenario = { record: DateRecord; latestMonth: string }

/** A record start and a latest month that is the same as or later than the start's month. */
const scenario: fc.Arbitrary<Scenario> = fc
  .tuple(realDate, realDate)
  .map(([a, b]): [string, string] => (a <= b ? [a, b] : [b, a]))
  .map(([first, later]) => {
    const latestMonth = later.slice(0, 7)
    return { record: availableRecord(first, latestMonth), latestMonth }
  })

/** Independent last day of a `YYYY-MM` month. */
function monthEnd(month: string): string {
  const y = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  return iso(Date.UTC(y, m, 0))
}

/** First day of the month `back` months before `month` (`YYYY-MM`). */
function monthStartBefore(month: string, back: number): string {
  const idx = Number(month.slice(0, 4)) * 12 + (Number(month.slice(5, 7)) - 1) - back
  return iso(Date.UTC(Math.floor(idx / 12), idx % 12, 1))
}

const maxIso = (a: string, b: string): string => (a > b ? a : b)

/** Dates that look like dates but do not exist. */
const nonexistentDate: fc.Arbitrary<string> = fc.oneof(
  fc.integer({ min: 2000, max: 2030 }).chain((y) =>
    fc.oneof(
      fc.constantFrom(30, 31).map((d) => `${y}-02-${d}`),
      fc.constantFrom('04', '06', '09', '11').map((m) => `${y}-${m}-31`),
      fc.constant(`${y}-13-01`),
      fc.constant(`${y}-00-10`),
      fc.constant(`${y}-05-00`),
      fc.constant(`${y}-05-32`),
    ),
  ),
  fc
    .constantFrom(2001, 2002, 2003, 2005, 2006, 2007, 2009, 2010, 2011, 2013, 2014, 2015, 2100)
    .map((y) => `${y}-02-29`),
)

/** Day offset inside the record (0 = first day). */
const spanDays = (record: DateRecord): number => (ms(record.last) - ms(record.first)) / DAY_MS

describe('Property 47: date presets', () => {
  it('calendar presets end at the latest month and start no earlier than the record start', () => {
    fc.assert(
      fc.property(scenario, ({ record, latestMonth }) => {
        const end = monthEnd(latestMonth)
        expect(record.last).toBe(end)
        for (const id of CALENDAR_PRESETS) {
          const range = presetRange(id, record)
          expect(range).not.toBeNull()
          expect(range!.end).toBe(end)
          expect(range!.start >= record.first).toBe(true)
          expect(range!.start <= range!.end).toBe(true)
        }
        expect(presetRange('full-record', record)).toEqual({ start: record.first, end })
        expect(presetRange('this-year', record)!.start).toBe(
          maxIso(record.first, `${latestMonth.slice(0, 4)}-01-01`),
        )
        expect(presetRange('last-5-years', record)!.start).toBe(
          maxIso(record.first, monthStartBefore(latestMonth, 59)),
        )
      }),
    )
  })

  it('calendar presets span whole months when the record starts on a month boundary', () => {
    fc.assert(
      fc.property(scenario, ({ record }) => {
        const aligned: DateRecord = { first: `${record.first.slice(0, 7)}-01`, last: record.last }
        for (const id of CALENDAR_PRESETS) {
          expect(wholeMonthNote(presetRange(id, aligned)!)).toBeNull()
        }
      }),
    )
  })

  it('day presets end at the latest detection date and never start before the record start', () => {
    fc.assert(
      fc.property(scenario, fc.nat(400), ({ record }, back) => {
        const latest = iso(ms(record.last) - back * DAY_MS)
        fc.pre(latest >= record.first)
        for (const [id, length] of [
          ['last-7-days', 7],
          ['last-30-days', 30],
        ] as const) {
          const range = presetRange(id, record, latest)!
          expect(range.end).toBe(latest)
          expect(range.start >= record.first).toBe(true)
          expect(range.start <= range.end).toBe(true)
          expect(range.start).toBe(maxIso(record.first, iso(ms(latest) - (length - 1) * DAY_MS)))
          expect(presetRange(id, record, null)).toBeNull()
        }
        expect(EXACT_PRESETS).toEqual(['last-7-days', 'last-30-days'])
      }),
    )
  })
})

describe('Property 47: date validation', () => {
  it('accepts any ordered pair of real dates inside the record', () => {
    fc.assert(
      fc.property(scenario, fc.nat(), fc.nat(), ({ record }, x, y) => {
        const span = spanDays(record)
        const a = iso(ms(record.first) + (x % (span + 1)) * DAY_MS)
        const b = iso(ms(record.first) + (y % (span + 1)) * DAY_MS)
        const [start, end] = a <= b ? [a, b] : [b, a]
        expect(validateDateRange(start, end, record)).toEqual({ ok: true, range: { start, end } })
      }),
    )
  })

  it('rejects a start after the end and marks both fields', () => {
    fc.assert(
      fc.property(scenario, fc.nat(), fc.nat(), ({ record }, x, y) => {
        const span = spanDays(record)
        fc.pre(span >= 1)
        const i = x % (span + 1)
        const j = y % (span + 1)
        fc.pre(i !== j)
        const [lo, hi] = i < j ? [i, j] : [j, i]
        const start = iso(ms(record.first) + hi * DAY_MS)
        const end = iso(ms(record.first) + lo * DAY_MS)
        const result = validateDateRange(start, end, record)
        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.errors.start).toBeDefined()
          expect(result.errors.end).toBeDefined()
        }
      }),
    )
  })

  it('rejects a date outside the record and marks only that field, naming the record bounds', () => {
    fc.assert(
      fc.property(
        scenario,
        fc.integer({ min: 1, max: 5000 }),
        fc.boolean(),
        fc.boolean(),
        ({ record }, offset, before, onStart) => {
          const outside = before
            ? iso(ms(record.first) - offset * DAY_MS)
            : iso(ms(record.last) + offset * DAY_MS)
          const result = onStart
            ? validateDateRange(outside, record.last, record)
            : validateDateRange(record.first, outside, record)
          expect(result.ok).toBe(false)
          if (!result.ok) {
            const marked = onStart ? result.errors.start : result.errors.end
            const other = onStart ? result.errors.end : result.errors.start
            expect(marked).toBeDefined()
            expect(marked).toContain(record.first)
            expect(marked).toContain(record.last)
            expect(other).toBeUndefined()
          }
        },
      ),
    )
  })

  it('rejects a date that does not exist and marks only that field', () => {
    fc.assert(
      fc.property(scenario, nonexistentDate, fc.boolean(), ({ record }, bad, onStart) => {
        const result = onStart
          ? validateDateRange(bad, record.last, record)
          : validateDateRange(record.first, bad, record)
        expect(result.ok).toBe(false)
        if (!result.ok) {
          const marked = onStart ? result.errors.start : result.errors.end
          const other = onStart ? result.errors.end : result.errors.start
          expect(marked).toBeDefined()
          expect(marked).toContain('not a real calendar date')
          expect(other).toBeUndefined()
        }
      }),
    )
  })

  it('marks both fields when both are invalid', () => {
    fc.assert(
      fc.property(scenario, nonexistentDate, nonexistentDate, ({ record }, a, b) => {
        const result = validateDateRange(a, b, record)
        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.errors.start).toBeDefined()
          expect(result.errors.end).toBeDefined()
        }
      }),
    )
  })
})

import fc from 'fast-check'
import {
  addDays,
  availableRecord,
  defaultDateRange,
  lastDayOfMonth,
  presetRange,
  validateDateRange,
  wholeMonthNote,
} from './dates'

const record = availableRecord('2000-11-01', '2026-11')

describe('availableRecord', () => {
  it('ends on the last day of the latest month', () => {
    expect(record).toEqual({ first: '2000-11-01', last: '2026-11-30' })
    expect(lastDayOfMonth('2024-02')).toBe('2024-02-29')
    expect(lastDayOfMonth('2023-02')).toBe('2023-02-28')
  })
})

describe('defaultDateRange', () => {
  it('starts in January ten years before the latest year and ends at the latest date', () => {
    expect(defaultDateRange('2000-11-01', '2026-11-30')).toEqual({
      start: '2016-01-01',
      end: '2026-11-30',
    })
  })
  it('never starts before the record', () => {
    expect(defaultDateRange('2020-03-01', '2026-11-30').start).toBe('2020-03-01')
  })
  it('keeps the same date when the record starts exactly on January 1 of Y - 10', () => {
    expect(defaultDateRange('2016-01-01', '2026-11-30')).toEqual({
      start: '2016-01-01',
      end: '2026-11-30',
    })
  })
  it('clamps to the first date when it falls inside year Y - 10, and handles a one-month record', () => {
    expect(defaultDateRange('2016-06-15', '2026-03-31').start).toBe('2016-06-15')
    expect(defaultDateRange('2026-03-01', '2026-03-31')).toEqual({
      start: '2026-03-01',
      end: '2026-03-31',
    })
  })
  it('is derived from the latest date, not from the browser clock', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2040-05-05T00:00:00Z'))
      expect(defaultDateRange('2000-11-01', '2026-11-30')).toEqual({
        start: '2016-01-01',
        end: '2026-11-30',
      })
    } finally {
      vi.useRealTimers()
    }
  })
  it('reads year-month values as month boundaries', () => {
    expect(defaultDateRange('2000-11', '2026-11')).toEqual({
      start: '2016-01-01',
      end: '2026-11-30',
    })
  })
})

describe('presetRange', () => {
  it('this year starts in January of the latest year', () => {
    expect(presetRange('this-year', record)).toEqual({ start: '2026-01-01', end: '2026-11-30' })
  })
  it('last 5 years is the 60 months ending with the latest month', () => {
    expect(presetRange('last-5-years', record)).toEqual({ start: '2021-12-01', end: '2026-11-30' })
  })
  it('full record spans the whole record', () => {
    expect(presetRange('full-record', record)).toEqual({ start: '2000-11-01', end: '2026-11-30' })
  })
  it('clamps a start before the record to the first date', () => {
    const short = availableRecord('2024-05-01', '2025-02')
    expect(presetRange('last-5-years', short)?.start).toBe('2024-05-01')
    expect(presetRange('this-year', availableRecord('2025-03-01', '2025-08'))?.start).toBe(
      '2025-03-01',
    )
  })
  it('last 7 and 30 days count local dates inclusive, ending on the latest detection date', () => {
    expect(presetRange('last-7-days', record, '2026-11-10')).toEqual({
      start: '2026-11-04',
      end: '2026-11-10',
    })
    expect(presetRange('last-30-days', record, '2026-11-10')).toEqual({
      start: '2026-10-12',
      end: '2026-11-10',
    })
  })
  it('gives no day preset when the latest detection date is unknown', () => {
    expect(presetRange('last-7-days', record, null)).toBeNull()
    expect(presetRange('last-30-days', record, '2026-02-30')).toBeNull()
  })
})

describe('validateDateRange', () => {
  it('accepts a valid range and trims input', () => {
    expect(validateDateRange(' 2020-08-15 ', '2021-01-31', record)).toEqual({
      ok: true,
      range: { start: '2020-08-15', end: '2021-01-31' },
    })
  })
  it('accepts a one-day range', () => {
    expect(validateDateRange('2020-08-15', '2020-08-15', record).ok).toBe(true)
  })
  it('marks a date that is not real, and states the record', () => {
    const result = validateDateRange('2021-02-29', '2021-03-01', record)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.start).toMatch(/not a real calendar date/)
      expect(result.errors.start).toContain('2000-11-01 to 2026-11-30')
      expect(result.errors.start).toContain('local standard time, UTC-8')
      expect(result.errors.end).toBeUndefined()
    }
  })
  it('marks dates outside the record', () => {
    const result = validateDateRange('2000-10-31', '2026-12-01', record)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.start).toMatch(/outside the available record/)
      expect(result.errors.end).toMatch(/outside the available record/)
    }
  })
  it('marks both fields when the start is after the end', () => {
    const result = validateDateRange('2021-05-02', '2021-05-01', record)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.start).toMatch(/after end date/)
      expect(result.errors.end).toMatch(/after end date/)
    }
  })
  it.each(['', '2020-8-1', '20200801', 'abc', '2020-13-01'])('rejects %j', (text) => {
    expect(validateDateRange(text, '2021-01-01', record).ok).toBe(false)
  })
})

describe('wholeMonthNote', () => {
  it('is null for whole months', () => {
    expect(wholeMonthNote({ start: '2020-01-01', end: '2020-12-31' })).toBeNull()
    expect(wholeMonthNote({ start: '2024-02-01', end: '2024-02-29' })).toBeNull()
  })
  it('names a mid-month start', () => {
    expect(wholeMonthNote({ start: '2020-08-15', end: '2020-12-31' })).toMatch(
      /whole of August 2020/,
    )
  })
  it('names a mid-month end, and both ends together', () => {
    expect(wholeMonthNote({ start: '2020-01-01', end: '2020-12-30' })).toMatch(
      /whole of December 2020/,
    )
    expect(wholeMonthNote({ start: '2020-08-15', end: '2020-10-10' })).toMatch(
      /August 2020 and October 2020/,
    )
  })
  it('names a month once when start and end share it', () => {
    expect(wholeMonthNote({ start: '2020-08-05', end: '2020-08-10' })).toMatch(
      /whole of August 2020\./,
    )
  })
  it('is null for dates that are not real', () => {
    expect(wholeMonthNote({ start: '2020-02-30', end: '2020-03-01' })).toBeNull()
  })
})

// Quick property checks. The full Property 47 and 51 tests are tasks 11.4 and 19.16.
const monthArb = fc
  .tuple(fc.integer({ min: 1990, max: 2060 }), fc.integer({ min: 1, max: 12 }))
  .map(([y, m]) => `${y}-${String(m).padStart(2, '0')}`)

describe('presets stay inside the record', () => {
  it('every calendar preset is valid and ends with the latest month', () => {
    fc.assert(
      fc.property(monthArb, fc.integer({ min: 0, max: 400 }), (latestMonth, monthsBefore) => {
        const y = Number(latestMonth.slice(0, 4))
        const m = Number(latestMonth.slice(5, 7))
        const idx = y * 12 + (m - 1) - monthsBefore
        const first = `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-01`
        const rec = availableRecord(first, latestMonth)
        for (const id of ['this-year', 'last-5-years', 'full-record'] as const) {
          const range = presetRange(id, rec)
          expect(range).not.toBeNull()
          expect(range?.end).toBe(rec.last)
          expect(range!.start >= rec.first).toBe(true)
          expect(validateDateRange(range!.start, range!.end, rec).ok).toBe(true)
        }
      }),
    )
  })
  it('addDays moves by exactly the number of days', () => {
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
})

import fc from 'fast-check'
import {
  formatCount,
  formatCountWithUnit,
  formatDataThrough,
  formatDate,
  formatDateLabelled,
  formatDateRange,
  formatFrp,
  formatMonth,
  formatMonthLabel,
  formatPercent,
  formatPercentDifference,
  formatSignedCount,
  formatUtcTimestamp,
  isRealDate,
  MISSING,
  NO_TYPICAL_FIRES,
  UNIT_CELL_DAYS,
} from './format'

const ONE_DECIMAL = /^-?\d{1,3}(,\d{3})*\.\d$/
const unparse = (s: string): number => Number(s.replaceAll(',', ''))

describe('count and percent formatting', () => {
  it('formats counts to one decimal with separators', () => {
    expect(formatCount(0)).toBe('0.0')
    expect(formatCount(12)).toBe('12.0')
    expect(formatCount(1234.56)).toBe('1,234.6')
    expect(formatCount(-3.25)).toBe('-3.3')
  })

  it('shows a small negative value as 0.0, not -0.0', () => {
    expect(formatCount(-0.01)).toBe('0.0')
    expect(formatSignedCount(-0.01)).toBe('0.0')
  })

  it('shows a dash for missing and non-finite values', () => {
    for (const v of [null, undefined, Number.NaN, Infinity, -Infinity]) {
      expect(formatCount(v)).toBe(MISSING)
      expect(formatPercent(v)).toBe(MISSING)
      expect(formatFrp(v)).toBe(MISSING)
    }
  })

  it('adds the unit', () => {
    expect(formatCountWithUnit(5)).toBe(`5.0 ${UNIT_CELL_DAYS}`)
    expect(UNIT_CELL_DAYS).toBe('cell-days (MODIS-equivalent)')
    expect(formatFrp(2500.04)).toBe('2,500.0 MW')
  })

  it('signs differences explicitly', () => {
    expect(formatSignedCount(12)).toBe('+12.0')
    expect(formatSignedCount(-3.5)).toBe('-3.5')
    expect(formatPercentDifference(12.34)).toBe('+12.3%')
    expect(formatPercentDifference(-50)).toBe('-50.0%')
  })

  it('never shows infinity for a percent difference with median 0', () => {
    expect(formatPercentDifference(null)).toBe(NO_TYPICAL_FIRES)
    expect(formatPercentDifference(Infinity)).toBe(MISSING)
  })

  it('formatCount gives one decimal and stays within half a tenth of the input', () => {
    fc.assert(
      fc.property(fc.double({ min: -1e12, max: 1e12, noNaN: true }), (x) => {
        const s = formatCount(x)
        expect(s).toMatch(ONE_DECIMAL)
        expect(Math.abs(unparse(s) - x)).toBeLessThanOrEqual(0.05000001)
        expect(s).not.toBe('-0.0')
      }),
    )
  })

  it('formatPercent keeps one decimal and a percent sign', () => {
    fc.assert(
      fc.property(fc.double({ min: -1e6, max: 1e6, noNaN: true }), (x) => {
        const s = formatPercent(x)
        expect(s.endsWith('%')).toBe(true)
        expect(s.slice(0, -1)).toMatch(ONE_DECIMAL)
      }),
    )
  })

  it('no input, finite or not, produces NaN or Infinity text', () => {
    fc.assert(
      fc.property(fc.double(), (x) => {
        for (const s of [formatCount(x), formatPercent(x), formatPercentDifference(x)]) {
          expect(s).not.toMatch(/NaN|Infinity/)
        }
      }),
    )
  })
})

describe('date and month formatting', () => {
  it('labels dates with the time convention', () => {
    expect(formatDateLabelled('2020-08-15')).toBe('2020-08-15 (local standard time, UTC-8)')
    expect(formatDateRange('2020-01-01', '2020-12-31')).toBe(
      '2020-01-01 to 2020-12-31 (local standard time, UTC-8)',
    )
  })

  it('rejects dates that are not real', () => {
    for (const bad of ['2021-02-29', '2020-13-01', '2020-00-10', '2020-4-1', 'x', '']) {
      expect(isRealDate(bad)).toBe(false)
      expect(formatDate(bad)).toBe(MISSING)
      expect(formatDateLabelled(bad)).toBe(MISSING)
    }
    expect(isRealDate('2020-02-29')).toBe(true)
    expect(formatDateRange('2020-01-01', '2020-02-30')).toBe(MISSING)
  })

  it('formats months and the header badge', () => {
    expect(formatMonth(2000, 11)).toBe('November 2000')
    expect(formatMonthLabel('2026-11')).toBe('November 2026')
    expect(formatMonthLabel('2026-13')).toBe(MISSING)
    expect(formatMonth(2020, 0)).toBe(MISSING)
    expect(formatDataThrough('2026-11')).toBe('Data to November 2026')
    expect(formatDataThrough('2026-11', true)).toBe('Data to November 2026 (provisional)')
    expect(formatDataThrough('nope')).toBe(MISSING)
  })

  it('formats a UTC instant and labels it UTC', () => {
    expect(formatUtcTimestamp('2026-11-14T18:32:05Z')).toBe('2026-11-14 18:32 UTC')
    expect(formatUtcTimestamp('not a date')).toBe(MISSING)
  })

  it('every real calendar date round-trips through formatDate', () => {
    fc.assert(
      fc.property(
        fc.date({
          min: new Date('1990-01-01T00:00:00Z'),
          max: new Date('2040-12-31T00:00:00Z'),
          noInvalidDate: true,
        }),
        (d) => {
          const iso = d.toISOString().slice(0, 10)
          expect(isRealDate(iso)).toBe(true)
          expect(formatDate(iso)).toBe(iso)
        },
      ),
    )
  })
})

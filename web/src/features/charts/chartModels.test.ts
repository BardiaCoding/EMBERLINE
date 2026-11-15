import { describe, expect, it } from 'vitest'
import { anomaly, month, result } from '@/lib/binning.fixtures'
import { seasonalPoint, yearRow } from '@/lib/stats.fixtures'
import {
  buildAnomalySeries,
  buildSeasonalModel,
  buildYearlyBars,
  calendarTotal,
  defaultSelectedYear,
  describeChart,
  peakMonth,
  sumBars,
  yearLabel,
  yearsOf,
} from './chartModels'

// Synthetic values. TEST FIXTURE, not NASA data.

describe('buildYearlyBars', () => {
  const years = [
    yearRow(2013, 90.5),
    yearRow(2011, 10, { n_months: 2 }),
    yearRow(2012, 120),
    yearRow(2014, 15.25, { n_months: 3, provisional: true }),
  ]

  it('orders bars oldest first and marks partial and provisional years in the label', () => {
    const model = buildYearlyBars({ years, baseline_year: null })
    expect(model.bars.map((b) => b.label)).toEqual([
      '2011 (2 mo.)',
      '2012',
      '2013',
      '2014 (provisional)',
    ])
    expect(model.bars.map((b) => [b.partial, b.provisional])).toEqual([
      [true, false],
      [false, false],
      [false, false],
      [false, true],
    ])
  })

  it('has a baseline median only when baseline years exist', () => {
    expect(buildYearlyBars({ years, baseline_year: null }).baselineMedian).toBeNull()
    expect(
      buildYearlyBars({ years, baseline_year: { median: 80, n_years: 0 } }).baselineMedian,
    ).toBeNull()
    expect(
      buildYearlyBars({ years, baseline_year: { median: 80, n_years: 12 } }).baselineMedian,
    ).toBe(80)
  })

  it('sums the bars to the total of the years (requirement 16.10)', () => {
    const model = buildYearlyBars({ years, baseline_year: null })
    expect(sumBars(model.bars)).toBe(235.8)
    expect(calendarTotal({ years })).toBe(235.8)
  })

  it('labels a full year with its number only', () => {
    expect(yearLabel(2020, false, 12)).toBe('2020')
    expect(yearLabel(2020, false, null)).toBe('2020')
  })
})

describe('buildAnomalySeries', () => {
  const months = [
    month(2002, 8, 30, { anomaly: anomaly(20, 200) }),
    month(2002, 7, 8, { anomaly: anomaly(-4.04, -33.3) }),
    month(2002, 9, 5, { provisional: true }),
    month(2002, 10, 4),
  ]
  const baseline = [
    { month: 7, mean: 12, n_years: 20 },
    { month: 8, mean: 17.25, n_years: 20 },
    { month: 9, mean: 99, n_years: 20 },
    { month: 10, mean: 5, n_years: 0 },
  ]

  it('gives absolute anomalies against the median and the mean, in month order', () => {
    const points = buildAnomalySeries({ months, baseline_by_month: baseline })
    expect(points.map((p) => p.key)).toEqual(['2002-07', '2002-08', '2002-09', '2002-10'])
    expect(points[0]).toMatchObject({ label: 'Jul 2002', vsMedian: -4, vsMean: -4 })
    expect(points[1]).toMatchObject({ vsMedian: 20, vsMean: 12.8 })
  })

  it('leaves the provisional month and a month without baseline as gaps', () => {
    const points = buildAnomalySeries({ months, baseline_by_month: baseline })
    expect(points[2]).toMatchObject({ provisional: true, vsMedian: null, vsMean: null })
    expect(points[3]).toMatchObject({ vsMedian: null, vsMean: null })
  })
})

describe('seasonal profile', () => {
  const profile = [seasonalPoint(1, 10), seasonalPoint(7, 40)]
  const months = [month(2003, 1, 12), month(2003, 7, 55, { provisional: true }), month(2002, 1, 3)]

  it('has 12 points with the selected year overlaid and the provisional month flagged', () => {
    const model = buildSeasonalModel(profile, months, 2003)
    expect(model.points).toHaveLength(12)
    expect(model.points[0]).toMatchObject({ label: 'Jan', median: 10, selected: 12 })
    expect(model.points[6]).toMatchObject({ median: 40, selected: 55, selectedProvisional: true })
    // A month without a baseline row or without data has null values.
    expect(model.points[1]).toMatchObject({ median: null, p10: null, selected: null })
  })

  it('defaults to the end year, or the newest year when the end year is not in the result', () => {
    expect(yearsOf(months)).toEqual([2002, 2003])
    expect(defaultSelectedYear('2002-12-31', [2002, 2003])).toBe(2002)
    expect(defaultSelectedYear('2030-01-31', [2002, 2003])).toBe(2003)
    expect(defaultSelectedYear('2030-01-31', [])).toBeNull()
  })
})

describe('peakMonth and describeChart', () => {
  it('picks the highest complete month, the earlier one on a tie, and skips the provisional month', () => {
    const months = [
      month(2002, 8, 50),
      month(2002, 7, 50),
      month(2003, 1, 500, { provisional: true }),
      month(2003, 2, 0),
    ]
    expect(peakMonth(months)).toEqual({ year: 2002, month: 7, harmonized: 50 })
    expect(peakMonth([month(2003, 2, 0)])).toBeNull()
  })

  it('states variable, unit, area, range, time convention, total and highest month', () => {
    const text = describeChart({
      variable: 'Bar chart',
      area: 'California region',
      start: '2002-01-01',
      end: '2003-12-31',
      total: 1234.5,
      peak: { year: 2002, month: 7, harmonized: 120.5 },
      notes: ['A note.'],
    })
    expect(text).toContain('Bar chart.')
    expect(text).toContain('cell-days (MODIS-equivalent)')
    expect(text).toContain('Area: California region.')
    expect(text).toContain('2002-01-01 to 2003-12-31 (local standard time, UTC-8)')
    expect(text).toContain('Total harmonized count: 1,234.5 cell-days (MODIS-equivalent)')
    expect(text).toContain('Highest month: July 2002 with 120.5')
    expect(text).toContain('A note.')
    expect(
      describeChart({ variable: 'v', area: 'a', start: 's', end: 'e', total: 0, peak: null }),
    ).toContain('Highest month: none')
  })
})

describe('result helper', () => {
  it('builds a result whose seasonal baseline has 12 months', () => {
    expect(result([]).baseline_by_month).toHaveLength(12)
  })
})

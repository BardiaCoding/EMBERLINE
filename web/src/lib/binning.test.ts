import type { MonthOut } from '@/lib/api'
import {
  ANOMALY_EDGES,
  buildCalendarModel,
  cellAriaLabel,
  cellStatuses,
  classifyAnomaly,
  classifyByEdges,
  classifyCount,
  compactCount,
  countEdges,
  describeCell,
  diffEdges,
  diffLimitOf,
  quantileType7,
  textToneFor,
  type CalendarCell,
  type CalendarModel,
} from './binning'
import { anomaly, month, result } from './binning.fixtures'
import { BLUE_ORANGE_DIVERGING, BLUE_ORANGE_NEUTRAL_INDEX } from '@/styles/palettes'

function cellOf(model: CalendarModel, year: number, m: number): CalendarCell {
  const cell = model.rows.find((r) => r.year === year)?.cells[m - 1]
  if (cell === undefined) throw new Error(`no cell ${year}-${m}`)
  return cell
}

/** Every month of 2019 and 2020, values 1..24 (so no zero, no duplicates). */
function twoYears(): MonthOut[] {
  const out: MonthOut[] = []
  let v = 1
  for (const y of [2019, 2020]) for (let m = 1; m <= 12; m += 1) out.push(month(y, m, v++))
  return out
}

describe('quantileType7 and countEdges', () => {
  it('interpolates linearly between order statistics', () => {
    expect(quantileType7([1, 2, 3, 4, 5], 0.5)).toBe(3)
    expect(quantileType7([1, 2, 3, 4, 5], 0.25)).toBe(2)
    expect(quantileType7([10, 20], 0.5)).toBe(15)
    expect(quantileType7([7], 0.9)).toBe(7)
  })

  it('gives 6 ascending edges for 7 classes of distinct values', () => {
    const values = Array.from({ length: 70 }, (_, i) => i + 1)
    const edges = countEdges(values)
    expect(edges).toHaveLength(6)
    expect(edges).toEqual([...edges].sort((a, b) => a - b))
    expect(edges[2]).toBe(30.6)
  })

  it('collapses duplicate edges and drops edges that give an empty class', () => {
    expect(countEdges([5, 5, 5, 5])).toEqual([])
    expect(countEdges([])).toEqual([])
    expect(countEdges([1, 2, 2, 2, 2, 2, 2, 2, 2, 3])).toEqual([2])
  })

  it('classifies zero as 0 and never gives a larger value a lower class', () => {
    const edges = [10, 20, 30]
    expect(classifyCount(0, edges)).toBe(0)
    expect(classifyCount(0.1, edges)).toBe(1)
    expect(classifyCount(10, edges)).toBe(2)
    expect(classifyCount(29.9, edges)).toBe(3)
    expect(classifyCount(500, edges)).toBe(4)
  })
})

describe('buildCalendarModel (counts)', () => {
  const range = { start: '2019-01-01', end: '2020-12-31' }

  it('has one row per year of the range, newest first, with 12 month cells', () => {
    const model = buildCalendarModel(result(twoYears()), 'counts', { range })
    expect(model.rows.map((r) => r.year)).toEqual([2020, 2019])
    for (const row of model.rows) {
      expect(row.cells.map((c) => c.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    }
    expect(model.view).toBe('counts')
    expect(model.unit).toContain('cell-days')
    expect(model.timeConvention).toBe('local standard time, UTC-8')
  })

  it('derives the range from the months present when none is given', () => {
    const model = buildCalendarModel(result([month(2018, 5, 3), month(2019, 2, 4)]))
    expect(model.rows.map((r) => r.year)).toEqual([2019, 2018])
    expect(cellOf(model, 2018, 4).state).toBe('no_data')
    expect(cellOf(model, 2018, 5).state).toBe('value')
  })

  it('returns no rows for an empty result without a range', () => {
    const model = buildCalendarModel(result([]))
    expect(model.rows).toEqual([])
    expect(model.peak).toBeNull()
    expect(model.total).toBe(0)
  })

  it('marks months outside the range, before the record and after the latest month as no_data', () => {
    const months = [month(2000, 11, 5), month(2000, 12, 6), month(2001, 1, 7), month(2001, 2, 8)]
    const model = buildCalendarModel(result(months), 'counts', {
      range: { start: '2000-01-01', end: '2001-12-31' },
      recordStart: '2000-11',
      latestMonth: '2001-01',
    })
    expect(cellOf(model, 2000, 10).state).toBe('no_data') // before record start
    expect(cellOf(model, 2000, 11).state).toBe('value')
    expect(cellOf(model, 2001, 1).state).toBe('value')
    expect(cellOf(model, 2001, 2).state).toBe('no_data') // after the latest month
    expect(cellOf(model, 2001, 6).state).toBe('no_data') // not in the result
    expect(cellOf(model, 2000, 10).value).toBeNull()
    expect(cellOf(model, 2000, 10).colour).toBeNull()
    expect(model.hasNoData).toBe(true)
  })

  it('treats months outside a narrower Date_Range as no_data even when the result has them', () => {
    const model = buildCalendarModel(result(twoYears()), 'counts', {
      range: { start: '2019-03-01', end: '2020-02-29' },
    })
    expect(cellOf(model, 2019, 2).state).toBe('no_data')
    expect(cellOf(model, 2019, 3).state).toBe('value')
    expect(cellOf(model, 2020, 2).state).toBe('value')
    expect(cellOf(model, 2020, 3).state).toBe('no_data')
  })

  it('keeps zero distinct from no_data: zero is class 0, no_data has no class', () => {
    const model = buildCalendarModel(
      result([month(2020, 1, 0), month(2020, 2, 4), month(2020, 3, 9)]),
      'counts',
      { range: { start: '2020-01-01', end: '2020-04-30' } },
    )
    const zero = cellOf(model, 2020, 1)
    const none = cellOf(model, 2020, 4)
    expect(zero.state).toBe('zero')
    expect(zero.value).toBe(0)
    expect(zero.classIndex).toBe(0)
    expect(zero.colour).toBe(model.bins[0]?.colour)
    expect(none.state).toBe('no_data')
    expect(none.classIndex).toBeNull()
    expect(none.colour).toBeNull()
  })

  it('uses class 0 for zero and up to 7 classes for non-zero values, colours ascending', () => {
    const model = buildCalendarModel(result(twoYears()), 'counts', { range })
    expect(model.bins.map((b) => b.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(model.bins[0]?.kind).toBe('zero')
    expect(model.edges).toHaveLength(6)
    expect(new Set(model.bins.map((b) => b.colour)).size).toBe(8)
    expect(model.bins.reduce((s, b) => s + b.cells, 0)).toBe(24)
    // A larger count never gets a lower class.
    const cells = model.rows.flatMap((r) => r.cells).sort((a, b) => (a.value ?? 0) - (b.value ?? 0))
    const classes = cells.map((c) => c.classIndex ?? -1)
    expect(classes).toEqual([...classes].sort((a, b) => a - b))
    expect(model.bins[7]?.max).toBe(24)
    expect(model.bins[1]?.lower).toBe(1)
  })

  it('has fewer classes when edges collapse', () => {
    const model = buildCalendarModel(
      result([month(2020, 1, 5), month(2020, 2, 5), month(2020, 3, 5)]),
      'counts',
      { range: { start: '2020-01-01', end: '2020-12-31' } },
    )
    expect(model.edges).toEqual([])
    expect(model.bins).toHaveLength(2)
    expect(cellOf(model, 2020, 1).classIndex).toBe(1)
  })

  it('gives the provisional month no colour class and leaves it out of the edges', () => {
    const base = twoYears().slice(0, 23) // 2019-01 .. 2020-11, values 1..23
    const without = buildCalendarModel(result(base), 'counts', { range })
    const withProvisional = buildCalendarModel(
      result([...base, month(2020, 12, 99999, { provisional: true })], ['2020-12']),
      'counts',
      { range, latestMonth: '2020-12' },
    )
    const p = cellOf(withProvisional, 2020, 12)
    expect(p.provisional).toBe(true)
    expect(p.state).toBe('value')
    expect(p.value).toBe(99999)
    expect(p.classIndex).toBeNull()
    expect(p.colour).toBeNull()
    expect(withProvisional.edges).toEqual(without.edges)
    expect(withProvisional.bins.at(-1)?.max).toBe(without.bins.at(-1)?.max)
    expect(withProvisional.hasProvisional).toBe(true)
    expect(withProvisional.peak?.value).not.toBe(99999)
    expect(cellStatuses(p)).toContain('Provisional')
    expect(cellAriaLabel(p)).toContain('provisional')
  })

  it('treats a month in provisional_months as provisional even if its own flag is false', () => {
    const model = buildCalendarModel(result([month(2020, 1, 3)], ['2020-01']), 'counts')
    expect(cellOf(model, 2020, 1).provisional).toBe(true)
  })

  it('sets year totals to the sum of the displayed months and counts only displayed months', () => {
    const model = buildCalendarModel(result(twoYears()), 'counts', {
      range: { start: '2019-01-01', end: '2020-06-30' },
    })
    const y2019 = model.rows.find((r) => r.year === 2019)
    const y2020 = model.rows.find((r) => r.year === 2020)
    expect(y2019?.total).toBe(78) // 1..12
    expect(y2020?.total).toBe(13 + 14 + 15 + 16 + 17 + 18)
    expect(model.total).toBe(78 + 93)
  })

  it('has a null total for a year with no displayed month', () => {
    const model = buildCalendarModel(result([month(2020, 1, 4)]), 'counts', {
      range: { start: '2019-01-01', end: '2020-12-31' },
    })
    expect(model.rows.find((r) => r.year === 2019)?.total).toBeNull()
  })

  it('marks only the partial months at the ends of a Date_Range as whole-month', () => {
    const model = buildCalendarModel(result(twoYears()), 'counts', {
      range: { start: '2019-03-15', end: '2020-08-10' },
    })
    const marked = model.rows.flatMap((r) => r.cells.filter((c) => c.wholeMonth).map((c) => c.key))
    expect(marked).toEqual(['2020-08', '2019-03'])
    expect(model.hasWholeMonth).toBe(true)
    const whole = buildCalendarModel(result(twoYears()), 'counts', { range })
    expect(whole.hasWholeMonth).toBe(false)
  })

  it('marks the latest month and the 2012-01 switchover month when displayed', () => {
    const months = [month(2011, 12, 3), month(2012, 1, 4), month(2012, 2, 5)]
    const model = buildCalendarModel(result(months), 'counts', {
      range: { start: '2011-01-01', end: '2012-12-31' },
      latestMonth: '2012-02',
    })
    expect(cellOf(model, 2012, 1).switchover).toBe(true)
    expect(cellOf(model, 2011, 12).switchover).toBe(false)
    expect(cellOf(model, 2012, 2).latest).toBe(true)
    expect(cellOf(model, 2012, 1).latest).toBe(false)
    expect(model.hasSwitchover).toBe(true)
    // The latest month outside the range is not marked.
    const earlier = buildCalendarModel(result(months), 'counts', {
      range: { start: '2011-01-01', end: '2012-01-31' },
      latestMonth: '2012-02',
    })
    expect(earlier.hasLatest).toBe(false)
  })

  it('carries the baseline median of each calendar month', () => {
    const model = buildCalendarModel(result(twoYears()), 'counts', { range })
    expect(model.baselineMedians).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21])
    expect(cellOf(model, 2020, 3).baselineMedian).toBe(12)
  })

  it('reports the peak month', () => {
    const model = buildCalendarModel(result(twoYears()), 'counts', { range })
    expect(model.peak).toEqual({ year: 2020, month: 12, value: 24 })
  })
})

describe('text helpers', () => {
  it('picks a readable text tone', () => {
    expect(textToneFor(buildCalendarModel(result(twoYears())).bins[0]?.colour ?? '')).toBe('light')
    const top = buildCalendarModel(result(twoYears())).bins.at(-1)?.colour ?? ''
    expect(textToneFor(top)).toBe('dark')
  })

  it('writes compact counts', () => {
    expect(compactCount(0)).toBe('0')
    expect(compactCount(4.25)).toBe('4.3')
    expect(compactCount(1234.5)).toBe('1,235')
    expect(compactCount(25_000)).toBe('25k')
  })

  it('names a no-data cell and a value cell', () => {
    const model = buildCalendarModel(result([month(2020, 2, 12.5)]), 'counts', {
      range: { start: '2020-01-01', end: '2020-02-29' },
    })
    expect(cellAriaLabel(cellOf(model, 2020, 1))).toBe('January 2020: no data')
    expect(cellAriaLabel(cellOf(model, 2020, 2))).toBe(
      'February 2020: 12.5 cell-days (MODIS-equivalent)',
    )
  })
})

// Synthetic test values below. TEST FIXTURE, not NASA data.
const RANGE = { start: '2019-11-01', end: '2020-06-30' }
const OPTIONS = { range: RANGE, recordStart: '2000-11', latestMonth: '2020-06' }

describe('anomaly view', () => {
  it('has 9 fixed percent bins, the neutral bin [-10, +10) holds zero', () => {
    expect(ANOMALY_EDGES).toEqual([-75, -50, -25, -10, 10, 25, 50, 100])
    const table: [number, number][] = [
      [-100, 0],
      [-75.1, 0],
      [-75, 1],
      [-50, 2],
      [-25, 3],
      [-10, 4],
      [0, 4],
      [9.9, 4],
      [10, 5],
      [25, 6],
      [50, 7],
      [99.9, 7],
      [100, 8],
      [5000, 8],
    ]
    for (const [percent, index] of table) expect(classifyAnomaly(percent, 1)).toBe(index)
    expect(BLUE_ORANGE_NEUTRAL_INDEX).toBe(4)
  })

  it('puts a month with baseline median 0 in the top bin when count > 0 and the neutral bin when 0', () => {
    expect(classifyAnomaly(null, 3)).toBe(8)
    expect(classifyAnomaly(null, 0)).toBe(4)
  })

  it('colours each cell by the bin of its percent difference and writes the sign in the cell', () => {
    const months = [
      month(2020, 1, 20, { anomaly: anomaly(10, 100) }),
      month(2020, 2, 4, { anomaly: anomaly(-6, -60) }),
      month(2020, 3, 11, { anomaly: anomaly(0.4, 3.6) }),
      month(2020, 4, 7, { anomaly: anomaly(7, null) }),
      month(2020, 5, 0, { anomaly: anomaly(0, null) }),
      month(2020, 6, 80, { provisional: true }),
    ]
    const model = buildCalendarModel(result(months, ['2020-06']), 'anomaly', OPTIONS)
    expect(model.view).toBe('anomaly')
    expect(model.unit).toBe('percent')
    expect(model.bins).toHaveLength(9)
    expect(model.bins.map((b) => b.colour)).toEqual([...BLUE_ORANGE_DIVERGING])
    expect(model.bins.map((b) => b.label)).toEqual([
      'below -75%',
      '-75% to under -50%',
      '-50% to under -25%',
      '-25% to under -10%',
      '-10% to under +10%',
      '+10% to under +25%',
      '+25% to under +50%',
      '+50% to under +100%',
      '+100% and above',
    ])
    expect(model.bins[4]?.neutral).toBe(true)
    expect(model.bins.filter((b) => b.neutral)).toHaveLength(1)

    const jan = cellOf(model, 2020, 1)
    expect([jan.classIndex, jan.face]).toEqual([8, '+100%'])
    const feb = cellOf(model, 2020, 2)
    expect([feb.classIndex, feb.face]).toEqual([1, '-60%'])
    expect(cellOf(model, 2020, 3).classIndex).toBe(4)
    // Median 0: no percent, so the face is the signed absolute difference.
    const apr = cellOf(model, 2020, 4)
    expect([apr.classIndex, apr.face]).toEqual([8, '+7.0'])
    const may = cellOf(model, 2020, 5)
    expect([may.classIndex, may.face]).toEqual([4, '0'])
    // Provisional month: no class, no fill, only its count to date.
    const jun = cellOf(model, 2020, 6)
    expect([jun.classIndex, jun.colour, jun.face]).toEqual([null, null, '80'])
    expect(model.bins.reduce((n, b) => n + b.cells, 0)).toBe(5)
  })

  it('names the percent or the no-typical-fires text in the cell label, never infinity', () => {
    const months = [
      month(2020, 1, 20, { anomaly: anomaly(10, 100) }),
      month(2020, 4, 7, { anomaly: anomaly(7, null) }),
    ]
    const model = buildCalendarModel(result(months), 'anomaly', OPTIONS)
    expect(cellAriaLabel(cellOf(model, 2020, 1), 'anomaly')).toContain(
      '+100.0% from the baseline median',
    )
    const label = cellAriaLabel(cellOf(model, 2020, 4), 'anomaly')
    expect(label).toContain('no typical fires in this month')
    expect(label).toContain('+7.0')
    expect(label).not.toMatch(/infinity|\bNaN\b/i)
  })
})

describe('month-to-month difference view', () => {
  it('has 8 symmetric edges whose middle bin contains zero', () => {
    const edges = diffEdges(18)
    expect(edges).toHaveLength(8)
    expect(edges).toEqual([-14, -10, -6, -2, 2, 6, 10, 14])
    edges.forEach((e, i) => {
      expect(e).toBe(-(edges[7 - i] ?? NaN))
    })
    expect(classifyByEdges(0, edges)).toBe(4)
    expect(classifyByEdges(-1000, edges)).toBe(0)
    expect(classifyByEdges(1000, edges)).toBe(8)
  })

  it('takes the limit at the 95th percentile of the absolute differences', () => {
    expect(diffLimitOf([])).toBe(0)
    expect(diffLimitOf([-10, 4, 0])).toBeCloseTo(9.4, 10)
    const values = Array.from({ length: 21 }, (_, i) => i - 10)
    expect(diffLimitOf(values)).toBe(10)
  })

  it('computes x[y,m] - x[y,m-1], January from the previous December, and hatches a month without a previous one', () => {
    const months = [
      month(2019, 11, 10),
      month(2019, 12, 30),
      month(2020, 1, 25),
      month(2020, 2, 25),
      month(2020, 3, 70),
      // 2020-04 missing from the result, so May has no previous month with data.
      month(2020, 5, 40),
    ]
    const model = buildCalendarModel(result(months), 'diff', OPTIONS)
    expect(model.view).toBe('diff')
    expect(cellOf(model, 2019, 11).diff).toBeNull() // October 2019 is outside the Date_Range
    expect(cellOf(model, 2019, 11).hatched).toBe(true)
    expect(cellOf(model, 2019, 12).diff).toBe(20)
    expect(cellOf(model, 2020, 1).diff).toBe(-5) // December of the previous year
    expect(cellOf(model, 2020, 2).diff).toBe(0)
    expect(cellOf(model, 2020, 3).diff).toBe(45)
    const may = cellOf(model, 2020, 5)
    expect(may.diff).toBeNull()
    expect(may.hatched).toBe(true)
    expect(may.classIndex).toBeNull()
    expect(may.colour).toBeNull()
    expect(may.face).toBeNull()
    expect(may.state).toBe('value') // the month itself has data; only the difference is missing
    expect(cellOf(model, 2020, 1).face).toBe('-5.0')
    expect(cellOf(model, 2020, 2).face).toBe('0')
    expect(cellOf(model, 2020, 3).face).toBe('+45')
  })

  it('sets symmetric limits, colours zero with the neutral class and leaves out the provisional month', () => {
    const months = [
      month(2019, 12, 0),
      month(2020, 1, 20),
      month(2020, 2, 0),
      month(2020, 3, 0),
      month(2020, 4, 10),
      month(2020, 5, 500, { provisional: true }),
    ]
    const model = buildCalendarModel(result(months, ['2020-05']), 'diff', {
      ...OPTIONS,
      latestMonth: '2020-05',
    })
    expect(model.unit).toContain('change from the previous month')
    expect(model.bins).toHaveLength(9)
    expect(model.edges).toHaveLength(8)
    expect(model.edges[3]).toBeCloseTo(-(model.edges[4] ?? NaN), 12)
    const limit = model.diffLimit ?? 0
    expect(limit).toBeGreaterThan(0)
    // The provisional 500 is not in the limit: |diffs| are 20, 20, 0, 10.
    expect(limit).toBeLessThanOrEqual(20)
    const neutral = BLUE_ORANGE_DIVERGING[BLUE_ORANGE_NEUTRAL_INDEX]
    expect(cellOf(model, 2020, 3).colour).toBe(neutral)
    expect(cellOf(model, 2020, 1).classIndex).toBe(8)
    expect(cellOf(model, 2020, 2).classIndex).toBe(0)
    const may = cellOf(model, 2020, 5)
    expect([may.classIndex, may.colour, may.diff, may.hatched, may.face]).toEqual([
      null,
      null,
      null,
      false,
      '500',
    ])
  })

  it('uses one neutral class when every displayed difference is 0', () => {
    const model = buildCalendarModel(
      result([month(2020, 1, 5), month(2020, 2, 5), month(2020, 3, 5)]),
      'diff',
      OPTIONS,
    )
    expect(model.bins).toHaveLength(1)
    expect(model.bins[0]?.neutral).toBe(true)
    expect(cellOf(model, 2020, 3).classIndex).toBe(0)
  })
})

describe('describeCell', () => {
  const months = [
    month(2020, 1, 20, { anomaly: anomaly(10, 100, { zscore: 1.234 }) }),
    month(2020, 2, 7, { anomaly: anomaly(7, null, { zscore: null }) }),
    month(2020, 3, 9, { lower_bound: 5, upper_bound: 12.5, anomaly: anomaly(1, 11) }),
    month(2020, 4, 9, { lower_bound: 5, upper_bound: null, anomaly: anomaly(1, 11) }),
    month(2020, 5, 50, { provisional: true }),
  ]
  const model = buildCalendarModel(result(months, ['2020-05']), 'counts', {
    ...OPTIONS,
    latestMonth: '2020-05',
  })
  const fields = (m: number): Record<string, string> =>
    Object.fromEntries(
      describeCell(model, cellOf(model, 2020, m)).fields.map((f) => [f.key, f.value]),
    )

  it('lists month, count, source flag, model, provenance, baseline median and the anomaly', () => {
    const d = describeCell(model, cellOf(model, 2020, 1))
    expect(d.title).toBe('January 2020')
    const f = fields(1)
    expect(f.harmonized).toBe('20.0 cell-days (MODIS-equivalent)')
    expect(f.source_flag).toBe('calibrated')
    expect(f.calib_model).toBe('quantile_map')
    expect(f.provenance).toBe('TEST FIXTURE')
    expect(f.baseline_median).toBe('10.0 cell-days (MODIS-equivalent)')
    expect(f.absolute).toBe('+10.0 cell-days (MODIS-equivalent)')
    expect(f.percent).toBe('+100.0%')
    expect(f.zscore).toBe('+1.23')
    expect(f.percentile_rank).toBe('60.0')
    expect(f.status).toBe('Complete')
  })

  it('shows no typical fires with the absolute difference and percentile rank when the median is 0', () => {
    const f = fields(2)
    expect(f.percent).toBe('no typical fires in this month')
    expect(f.absolute).toBe('+7.0 cell-days (MODIS-equivalent)')
    expect(f.percentile_rank).toBe('60.0')
    expect(f.zscore).toBe('\u2014')
    expect(describeCell(model, cellOf(model, 2020, 2)).text).not.toMatch(/infinity|\bNaN\b/i)
  })

  it('shows the interval line only when both bounds are non-null', () => {
    expect(fields(3).interval).toBe('5.0 to 12.5 cell-days (MODIS-equivalent)')
    expect(fields(4)).not.toHaveProperty('interval')
    expect(fields(1)).not.toHaveProperty('interval')
  })

  it('states the provisional month and gives it no anomaly fields', () => {
    const f = fields(5)
    expect(f.status).toMatch(/^Provisional/)
    for (const key of ['absolute', 'percent', 'zscore', 'percentile_rank']) {
      expect(f).not.toHaveProperty(key)
    }
    expect(f.harmonized).toBe('50.0 cell-days (MODIS-equivalent)')
  })

  it('says no data for a cell without data', () => {
    const d = describeCell(model, cellOf(model, 2019, 11))
    expect(d.hasData).toBe(false)
    expect(d.fields.map((f) => f.key)).toEqual(['month', 'status'])
  })
})

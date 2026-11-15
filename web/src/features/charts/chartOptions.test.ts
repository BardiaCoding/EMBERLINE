import type { EChartsCoreOption } from 'echarts/core'
import { describe, expect, it } from 'vitest'
import { anomaly, month } from '@/lib/binning.fixtures'
import { seasonalPoint, yearRow } from '@/lib/stats.fixtures'
import { CHART_COLOURS_DARK, CHART_COLOURS_LIGHT } from '@/styles/palettes'
import {
  buildAnomalySeries,
  buildSeasonalModel,
  buildYearlyBars,
  type YearlyBarsModel,
} from './chartModels'
import {
  ANOMALY_MEAN_NAME,
  ANOMALY_MEDIAN_NAME,
  anomalyOption,
  COMPLETE_YEAR_NAME,
  describeAnomalyPoint,
  describeSeasonalPoint,
  describeYearlyBar,
  INCOMPLETE_YEAR_NAME,
  seasonalOption,
  SEASONAL_MEDIAN_NAME,
  YEARLY_BASELINE_NAME,
  yearlyBarsOption,
} from './chartOptions'

// Synthetic values. TEST FIXTURE, not NASA data.
type Series = {
  name: string
  type: string
  data: (number | null)[]
  lineStyle?: { type?: string }
  itemStyle?: { borderType?: string; borderColor?: string }
  symbol?: string
}
const seriesOf = (option: EChartsCoreOption): Series[] =>
  (option as unknown as { series: Series[] }).series
const legendOf = (option: EChartsCoreOption): string[] =>
  (option as unknown as { legend: { data: string[] } }).legend.data

const model: YearlyBarsModel = buildYearlyBars({
  years: [
    yearRow(2012, 100),
    yearRow(2013, 80.5),
    yearRow(2014, 20, { n_months: 3, provisional: true }),
  ],
  baseline_year: { median: 90, n_years: 12 },
})

describe('yearlyBarsOption', () => {
  it('draws a provisional year as a dashed bar in its own series, never as a complete bar', () => {
    const option = yearlyBarsOption(model, CHART_COLOURS_LIGHT)
    const [complete, incomplete] = seriesOf(option)
    expect(complete?.name).toBe(COMPLETE_YEAR_NAME)
    expect(complete?.data).toEqual([100, 80.5, null])
    expect(incomplete?.name).toBe(INCOMPLETE_YEAR_NAME)
    expect(incomplete?.data).toEqual([null, null, 20])
    expect(incomplete?.itemStyle?.borderType).toBe('dashed')
    expect(legendOf(option)).toContain(INCOMPLETE_YEAR_NAME)
  })

  it('adds a dashed baseline median line only when there is a baseline', () => {
    const line = seriesOf(yearlyBarsOption(model, CHART_COLOURS_LIGHT)).find(
      (s) => s.name === YEARLY_BASELINE_NAME,
    )
    expect(line?.type).toBe('line')
    expect(line?.data).toEqual([90, 90, 90])
    expect(line?.lineStyle?.type).toBe('dashed')
    const none = yearlyBarsOption({ ...model, baselineMedian: null }, CHART_COLOURS_LIGHT)
    expect(legendOf(none)).not.toContain(YEARLY_BASELINE_NAME)
  })

  it('has no provisional series or legend entry when every year is complete', () => {
    const complete = buildYearlyBars({ years: [yearRow(2012, 1)], baseline_year: null })
    const option = yearlyBarsOption(complete, CHART_COLOURS_LIGHT)
    expect(seriesOf(option)).toHaveLength(1)
    expect(legendOf(option)).toEqual([COMPLETE_YEAR_NAME])
  })

  it('states the unit on the value axis and uses only palette colours', () => {
    const json = JSON.stringify(yearlyBarsOption(model, CHART_COLOURS_DARK))
    expect(json).toContain('cell-days (MODIS-equivalent)')
    const colours = json.match(/#[0-9a-fA-F]{6}\b/g) ?? []
    const allowed = new Set(Object.values(CHART_COLOURS_DARK))
    for (const colour of colours) expect(allowed.has(colour)).toBe(true)
  })

  it('has a tooltip and point text with the status of the bar', () => {
    const [first, , third] = model.bars
    expect(describeYearlyBar(first!, 90)).toContain('Baseline yearly median: 90.0')
    expect(describeYearlyBar(third!, 90)).toContain('provisional: count to date')
    expect(describeYearlyBar(third!, 90)).not.toContain('Baseline yearly median')
    const option = yearlyBarsOption(model, CHART_COLOURS_LIGHT) as {
      tooltip: { formatter: (p: unknown) => string }
    }
    expect(option.tooltip.formatter([{ dataIndex: 1 }])).toContain('2013: 80.5')
    expect(option.tooltip.formatter([])).toBe('')
  })
})

describe('seasonalOption', () => {
  const profile = Array.from({ length: 12 }, (_, i) => seasonalPoint(i + 1, 10 + i))
  const months = [month(2003, 1, 12), month(2003, 2, 7, { provisional: true })]

  it('stacks an invisible 10th percentile base under the band, then median and selected year', () => {
    const option = seasonalOption(buildSeasonalModel(profile, months, 2003), CHART_COLOURS_LIGHT)
    const series = seriesOf(option)
    expect(series.map((s) => s.name)).toEqual([
      'p10',
      '10th to 90th percentile range',
      SEASONAL_MEDIAN_NAME,
      'Year 2003',
      'February 2003 to date (provisional)',
    ])
    expect(series[0]?.data[0]).toBe(1)
    expect(series[1]?.data[0]).toBe(49)
    expect(series[2]?.data[0]).toBe(10)
    // The line of the year skips the provisional month, which is its own hollow triangle.
    expect(series[3]?.data.slice(0, 3)).toEqual([12, null, null])
    expect(series[4]?.type).toBe('scatter')
    expect(series[4]?.symbol).toBe('triangle')
    expect(series[4]?.data[1]).toBe(7)
    expect(legendOf(option)).not.toContain('p10')
  })

  it('has no provisional series when the selected year has no provisional month', () => {
    const option = seasonalOption(
      buildSeasonalModel(profile, [month(2003, 1, 12)], 2003),
      CHART_COLOURS_LIGHT,
    )
    expect(seriesOf(option)).toHaveLength(4)
  })

  it('describes a point with baseline and selected-year values', () => {
    const point = buildSeasonalModel(profile, months, 2003).points[1]!
    const text = describeSeasonalPoint(point, 2003)
    expect(text).toContain('February')
    expect(text).toContain('7.0 to date (provisional, not a full month)')
    expect(describeSeasonalPoint(buildSeasonalModel([], [], 2003).points[0]!, 2003)).toContain(
      'no baseline',
    )
  })
})

describe('anomalyOption', () => {
  const points = buildAnomalySeries({
    months: [
      month(2002, 7, 8, { anomaly: anomaly(-4, -33.3) }),
      month(2002, 8, 30, { anomaly: anomaly(20, 200) }),
      month(2002, 9, 5, { provisional: true }),
    ],
    baseline_by_month: [
      { month: 7, mean: 12, n_years: 20 },
      { month: 8, mean: 17, n_years: 20 },
      { month: 9, mean: 17, n_years: 20 },
    ],
  })

  it('has two labelled series that differ by line style and marker, with a zero line', () => {
    const option = anomalyOption(points, CHART_COLOURS_LIGHT)
    const [median, mean] = seriesOf(option)
    expect(median?.name).toBe(ANOMALY_MEDIAN_NAME)
    expect(mean?.name).toBe(ANOMALY_MEAN_NAME)
    expect(median?.lineStyle?.type).toBe('solid')
    expect(mean?.lineStyle?.type).toBe('dashed')
    expect(median?.symbol).not.toBe(mean?.symbol)
    expect(median?.data).toEqual([-4, 20, null])
    expect(mean?.data).toEqual([-4, 13, null])
    expect(JSON.stringify(median)).toContain('"yAxis":0')
  })

  it('shows signed values in the point text and says the provisional month has no anomaly', () => {
    expect(describeAnomalyPoint(points[1]!)).toContain('against baseline median +20.0')
    expect(describeAnomalyPoint(points[0]!)).toContain('against baseline median -4.0')
    expect(describeAnomalyPoint(points[2]!)).toContain('provisional')
    expect(describeAnomalyPoint(points[2]!)).toContain('no anomaly')
  })
})

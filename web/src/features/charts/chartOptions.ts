import type { EChartsCoreOption } from 'echarts/core'
import { formatCount, formatMonth, monthName, UNIT_CELL_DAYS } from '@/lib/format'
import type { ChartColours } from '@/styles/palettes'
import {
  signedOrDash,
  type AnomalyPoint,
  type SeasonalModel,
  type SeasonalPoint,
  type YearlyBar,
  type YearlyBarsModel,
} from './chartModels'

// ECharts options for the three charts (design.md section 11.5). Pure functions of the chart
// models and the colour set, so they can be tested without a canvas. Each series differs by
// more than colour (line style, marker shape, border or label), requirement 27.4. Counts are
// cell-days (MODIS-equivalent). All colours come from `styles/palettes.ts`.

export const YEARLY_BASELINE_NAME = 'Baseline yearly median'
export const COMPLETE_YEAR_NAME = 'Complete year'
export const INCOMPLETE_YEAR_NAME = 'Provisional or partial year (count to date)'
export const SEASONAL_BAND_NAME = '10th to 90th percentile range'
export const SEASONAL_MEDIAN_NAME = 'Baseline median'
export const ANOMALY_MEDIAN_NAME = 'Anomaly against baseline median'
export const ANOMALY_MEAN_NAME = 'Anomaly against baseline mean'

const count = (value: number): string => `${formatCount(value)} ${UNIT_CELL_DAYS}`

// --- point descriptions: tooltip, keyboard stepping and table share these ------------------

export function describeYearlyBar(bar: YearlyBar, baselineMedian: number | null): string {
  const status = bar.provisional
    ? ' (provisional: count to date, not a full year)'
    : bar.partial
      ? ` (partial year: ${bar.nMonths ?? '?'} months in the range)`
      : ''
  const baseline =
    baselineMedian === null || bar.provisional || bar.partial
      ? ''
      : `. Baseline yearly median: ${count(baselineMedian)}`
  return `${bar.year}: ${count(bar.harmonized)}${status}${baseline}`
}

export function describeSeasonalPoint(point: SeasonalPoint, year: number): string {
  const name = monthName(point.month)
  const baseline =
    point.median === null
      ? 'no baseline'
      : `baseline median ${formatCount(point.median)}, 10th to 90th percentile ${formatCount(point.p10)} to ${formatCount(point.p90)}`
  let selected: string
  if (point.selected === null) selected = `${year}: no data`
  else if (point.selectedProvisional) {
    selected = `${year}: ${formatCount(point.selected)} to date (provisional, not a full month)`
  } else selected = `${year}: ${formatCount(point.selected)}`
  return `${name}: ${baseline}; ${selected} (${UNIT_CELL_DAYS})`
}

export function describeAnomalyPoint(point: AnomalyPoint): string {
  const month = formatMonth(point.year, point.month)
  if (point.provisional) {
    return `${month}: ${formatCount(point.harmonized)} to date (provisional), no anomaly`
  }
  return `${month}: ${count(point.harmonized)}; against baseline median ${signedOrDash(point.vsMedian)}; against baseline mean ${signedOrDash(point.vsMean)}`
}

// --- shared pieces --------------------------------------------------------------------------

function base(c: ChartColours, unit: string, legend: string[]): EChartsCoreOption {
  return {
    animation: false,
    textStyle: { color: c.text },
    grid: { left: 8, right: 16, top: 64, bottom: 8, containLabel: true },
    legend: {
      data: legend,
      top: 0,
      left: 0,
      itemWidth: 28,
      itemHeight: 12,
      textStyle: { color: c.text },
    },
    tooltip: {
      trigger: 'axis',
      confine: true,
      backgroundColor: c.tooltipBackground,
      borderColor: c.axis,
      textStyle: { color: c.text },
    },
    yAxis: {
      type: 'value',
      name: unit,
      nameLocation: 'end',
      nameTextStyle: { color: c.mutedText, align: 'left' },
      axisLabel: { color: c.mutedText },
      axisLine: { show: true, lineStyle: { color: c.axis } },
      splitLine: { lineStyle: { color: c.grid } },
    },
  }
}

function categoryAxis(c: ChartColours, labels: string[]): Record<string, unknown> {
  return {
    type: 'category',
    data: labels,
    axisLabel: { color: c.mutedText, hideOverlap: true },
    axisLine: { lineStyle: { color: c.axis } },
    axisTick: { lineStyle: { color: c.axis } },
  }
}

/** Index of the first axis item of a tooltip `params` value, or -1. */
function firstIndex(params: unknown): number {
  const first = Array.isArray(params) ? (params[0] as unknown) : params
  if (typeof first === 'object' && first !== null && 'dataIndex' in first) {
    const index = first.dataIndex
    return typeof index === 'number' ? index : -1
  }
  return -1
}

// --- yearly bars ----------------------------------------------------------------------------

export function yearlyBarsOption(model: YearlyBarsModel, c: ChartColours): EChartsCoreOption {
  const { bars, baselineMedian } = model
  const incomplete = bars.some((b) => b.provisional || b.partial)
  const names = [COMPLETE_YEAR_NAME]
  const series: unknown[] = [
    {
      name: COMPLETE_YEAR_NAME,
      type: 'bar',
      stack: 'total',
      barMaxWidth: 40,
      data: bars.map((b) => (b.provisional || b.partial ? null : b.harmonized)),
      itemStyle: { color: c.primary },
    },
  ]
  if (incomplete) {
    names.push(INCOMPLETE_YEAR_NAME)
    // A dashed outline and a light fill: a provisional or partial year differs by pattern, not
    // only by colour, and it is never drawn like a full year.
    series.push({
      name: INCOMPLETE_YEAR_NAME,
      type: 'bar',
      stack: 'total',
      barMaxWidth: 40,
      data: bars.map((b) => (b.provisional || b.partial ? b.harmonized : null)),
      itemStyle: {
        color: c.provisionalFill,
        borderColor: c.primary,
        borderWidth: 2,
        borderType: 'dashed',
      },
    })
  }
  if (baselineMedian !== null) {
    names.push(YEARLY_BASELINE_NAME)
    series.push({
      name: YEARLY_BASELINE_NAME,
      type: 'line',
      symbol: 'none',
      z: 5,
      data: bars.map(() => baselineMedian),
      lineStyle: { color: c.secondary, width: 2, type: 'dashed' },
      itemStyle: { color: c.secondary },
    })
  }
  const common = base(c, UNIT_CELL_DAYS, names)
  return {
    ...common,
    xAxis: categoryAxis(
      c,
      bars.map((b) => b.label),
    ),
    series,
    tooltip: {
      ...(common.tooltip as Record<string, unknown>),
      axisPointer: { type: 'shadow' },
      formatter: (params: unknown): string => {
        const bar = bars[firstIndex(params)]
        return bar === undefined ? '' : describeYearlyBar(bar, baselineMedian)
      },
    },
  }
}

// --- seasonal profile -----------------------------------------------------------------------

export function seasonalOption(model: SeasonalModel, c: ChartColours): EChartsCoreOption {
  const { points, year } = model
  const yearName = `Year ${year}`
  const provisionalIndex = points.findIndex((p) => p.selectedProvisional)
  const provisionalName = `${provisionalIndex >= 0 ? monthName(points[provisionalIndex]?.month ?? 0) : ''} ${year} to date (provisional)`
  const names = [SEASONAL_BAND_NAME, SEASONAL_MEDIAN_NAME, yearName]
  const series: unknown[] = [
    {
      // Invisible base of the stacked band: the 10th percentile.
      name: 'p10',
      type: 'line',
      stack: 'band',
      symbol: 'none',
      silent: true,
      lineStyle: { opacity: 0 },
      tooltip: { show: false },
      data: points.map((p) => (p.p10 === null || p.p90 === null ? null : p.p10)),
    },
    {
      name: SEASONAL_BAND_NAME,
      type: 'line',
      stack: 'band',
      symbol: 'none',
      silent: true,
      lineStyle: { opacity: 0 },
      areaStyle: { color: c.band, opacity: 0.3 },
      data: points.map((p) =>
        p.p10 === null || p.p90 === null ? null : Math.max(0, p.p90 - p.p10),
      ),
    },
    {
      name: SEASONAL_MEDIAN_NAME,
      type: 'line',
      symbol: 'circle',
      symbolSize: 6,
      lineStyle: { color: c.primary, width: 2, type: 'solid' },
      itemStyle: { color: c.primary },
      data: points.map((p) => p.median),
    },
    {
      name: yearName,
      type: 'line',
      symbol: 'diamond',
      symbolSize: 10,
      z: 4,
      lineStyle: { color: c.secondary, width: 3, type: 'dashed' },
      itemStyle: { color: c.secondary },
      // The provisional month is not part of the line: it is drawn on its own below.
      data: points.map((p) => (p.selectedProvisional ? null : p.selected)),
    },
  ]
  if (provisionalIndex >= 0) {
    names.push(provisionalName)
    series.push({
      name: provisionalName,
      type: 'scatter',
      symbol: 'triangle',
      symbolSize: 14,
      z: 5,
      itemStyle: {
        color: c.provisionalFill,
        borderColor: c.secondary,
        borderWidth: 2,
      },
      data: points.map((p) => (p.selectedProvisional ? p.selected : null)),
    })
  }
  const common = base(c, UNIT_CELL_DAYS, names)
  return {
    ...common,
    xAxis: categoryAxis(
      c,
      points.map((p) => p.label),
    ),
    series,
    tooltip: {
      ...(common.tooltip as Record<string, unknown>),
      axisPointer: { type: 'line' },
      formatter: (params: unknown): string => {
        const point = points[firstIndex(params)]
        return point === undefined ? '' : describeSeasonalPoint(point, year)
      },
    },
  }
}

// --- anomaly series -------------------------------------------------------------------------

const signedAxisLabel = (value: number): string => (value > 0 ? `+${value}` : String(value))

export function anomalyOption(points: readonly AnomalyPoint[], c: ChartColours): EChartsCoreOption {
  const names = [ANOMALY_MEDIAN_NAME, ANOMALY_MEAN_NAME]
  // Markers show on every point of a short series. A long series (many months) shows lines
  // only, and the tooltip, the keyboard and the table give the values.
  const showSymbol = points.length <= 60
  const common = base(c, `Anomaly, ${UNIT_CELL_DAYS}`, names)
  return {
    ...common,
    xAxis: categoryAxis(
      c,
      points.map((p) => p.label),
    ),
    yAxis: {
      ...(common.yAxis as Record<string, unknown>),
      axisLabel: { color: c.mutedText, formatter: signedAxisLabel },
    },
    series: [
      {
        name: ANOMALY_MEDIAN_NAME,
        type: 'line',
        symbol: 'circle',
        symbolSize: 6,
        showSymbol,
        lineStyle: { color: c.primary, width: 2, type: 'solid' },
        itemStyle: { color: c.primary },
        data: points.map((p) => p.vsMedian),
        markLine: {
          silent: true,
          symbol: 'none',
          label: { show: false },
          lineStyle: { color: c.axis, width: 1, type: 'solid' },
          data: [{ yAxis: 0 }],
        },
      },
      {
        name: ANOMALY_MEAN_NAME,
        type: 'line',
        symbol: 'diamond',
        symbolSize: 8,
        showSymbol,
        lineStyle: { color: c.secondary, width: 2, type: 'dashed' },
        itemStyle: { color: c.secondary },
        data: points.map((p) => p.vsMean),
      },
    ],
    tooltip: {
      ...(common.tooltip as Record<string, unknown>),
      axisPointer: { type: 'line' },
      formatter: (params: unknown): string => {
        const point = points[firstIndex(params)]
        return point === undefined ? '' : describeAnomalyPoint(point)
      },
    },
  }
}

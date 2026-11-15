import type { EChartsCoreOption } from 'echarts/core'
import { formatCount, UNIT_CELL_DAYS } from '@/lib/format'
import type { ChartColours } from '@/styles/palettes'
import type { SeasonPoint } from './seasonModel'

const BAND_NAME = '10th to 90th percentile range'
const MEDIAN_NAME = 'Median cumulative'

export function describePoint(p: SeasonPoint, name: string): string {
  const envelope =
    p.median === null
      ? 'no envelope'
      : `median ${formatCount(p.median)}, 10th to 90th percentile ${formatCount(p.p10)} to ${formatCount(p.p90)}`
  const selected = p.selected === null ? 'no complete month yet' : formatCount(p.selected)
  return `Month ${p.monthOfSeason} (${p.label}): ${envelope}; season ${name}: ${selected} (${UNIT_CELL_DAYS}, cumulative)`
}

/** ECharts option: cumulative curve over the p10 to p90 band and the median curve. */
export function seasonOption(
  points: readonly SeasonPoint[],
  seasonName: string,
  c: ChartColours,
): EChartsCoreOption {
  const hasEnvelope = points.some((p) => p.median !== null)
  const names = [...(hasEnvelope ? [BAND_NAME, MEDIAN_NAME] : []), `Season ${seasonName}`]
  const series: unknown[] = []
  if (hasEnvelope) {
    series.push(
      {
        name: 'p10',
        type: 'line',
        stack: 'band',
        symbol: 'none',
        silent: true,
        lineStyle: { opacity: 0 },
        tooltip: { show: false },
        data: points.map((p) => p.p10),
      },
      {
        name: BAND_NAME,
        type: 'line',
        stack: 'band',
        symbol: 'none',
        silent: true,
        lineStyle: { opacity: 0 },
        areaStyle: { color: c.band, opacity: 0.3 },
        data: points.map((p) => (p.p10 === null || p.p90 === null ? null : p.p90 - p.p10)),
      },
      {
        name: MEDIAN_NAME,
        type: 'line',
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { color: c.primary, width: 2, type: 'solid' },
        itemStyle: { color: c.primary },
        data: points.map((p) => p.median),
      },
    )
  }
  series.push({
    name: `Season ${seasonName}`,
    type: 'line',
    symbol: 'diamond',
    symbolSize: 10,
    z: 4,
    lineStyle: { color: c.secondary, width: 3, type: 'dashed' },
    itemStyle: { color: c.secondary },
    data: points.map((p) => p.selected),
  })
  return {
    animation: false,
    textStyle: { color: c.text },
    grid: { left: 8, right: 16, top: 64, bottom: 8, containLabel: true },
    legend: {
      data: names,
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
      formatter: (params: unknown): string => {
        const first = Array.isArray(params) ? (params[0] as { dataIndex?: number }) : undefined
        const point = points[first?.dataIndex ?? -1]
        return point === undefined ? '' : describePoint(point, seasonName)
      },
    },
    xAxis: {
      type: 'category',
      data: points.map((p) => p.label),
      axisLabel: { color: c.mutedText, hideOverlap: true },
      axisLine: { lineStyle: { color: c.axis } },
      axisTick: { lineStyle: { color: c.axis } },
    },
    yAxis: {
      type: 'value',
      name: `${UNIT_CELL_DAYS}, cumulative`,
      nameLocation: 'end',
      nameTextStyle: { color: c.mutedText, align: 'left' },
      axisLabel: { color: c.mutedText },
      axisLine: { show: true, lineStyle: { color: c.axis } },
      splitLine: { lineStyle: { color: c.grid } },
    },
    series,
  }
}

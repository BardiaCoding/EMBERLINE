import type { ECharts } from 'echarts/core'
import { useCallback, useMemo, useRef } from 'react'
import { describeQuery, type ExportMeta } from '@/lib/exportChart'
import type { DateRange } from '@/lib/dates'

type ExportInfo = { title: string; unit: string; area: string; range: DateRange }

/**
 * Connects a chart to the `ChartFrame` download menu (task 25.3): pass `onChart` to `EChart`
 * and `exportSource` to `ChartFrame`. The image states the title, unit, area, Date_Range and
 * the FIRMS citation.
 */
export function useChartExport({ title, unit, area, range }: ExportInfo) {
  const chartRef = useRef<ECharts | null>(null)
  const onChart = useCallback((chart: ECharts | null) => {
    chartRef.current = chart
  }, [])
  const exportSource = useMemo(
    () => ({
      target: { kind: 'chart' as const, getChart: () => chartRef.current },
      meta: {
        title,
        unit,
        area,
        range: { start: range.start, end: range.end },
      } satisfies ExportMeta,
    }),
    [title, unit, area, range.start, range.end],
  )
  return { onChart, exportSource, queryDescription: describeQuery(area, range) }
}

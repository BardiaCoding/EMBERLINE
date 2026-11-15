import { BarChart, LineChart, ScatterChart } from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
} from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import type { EChartProps } from './EChart'

// This module is the only importer of ECharts. It is loaded on demand (`React.lazy` in
// `EChart.tsx`), so ECharts stays out of the initial bundle (requirement 28.2, design G12).
// Only the chart types and components the app uses are registered (tree-shaking).
echarts.use([
  BarChart,
  LineChart,
  ScatterChart,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  CanvasRenderer,
])

/**
 * An ECharts canvas in a focusable group. Left and right arrow keys step through the points,
 * Home and End jump to the first and last, Escape clears the tooltip (design.md section 11.8,
 * requirement 27.2). The point text is announced through a polite live region. Tab always
 * leaves the chart, so there is no keyboard trap.
 */
export default function EChartCanvas({
  option,
  height = 280,
  pointLabels = [],
  titleId,
  summaryId,
  onChart,
}: EChartProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)
  const index = useRef(-1)
  const [announcement, setAnnouncement] = useState('')
  const hintId = `${useId()}-hint`

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return undefined
    const chart = echarts.init(host, undefined, { renderer: 'canvas' })
    chartRef.current = chart
    onChart?.(chart)
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            chart.resize()
          })
    observer?.observe(host)
    return () => {
      observer?.disconnect()
      onChart?.(null)
      chart.dispose()
      chartRef.current = null
    }
    // The chart is created once. `onChart` is read at that moment only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true })
    index.current = -1
  }, [option])

  const step = (next: number): void => {
    const last = pointLabels.length - 1
    if (last < 0) return
    const clamped = Math.min(last, Math.max(0, next))
    index.current = clamped
    setAnnouncement(pointLabels[clamped] ?? '')
    chartRef.current?.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: clamped })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    switch (event.key) {
      case 'ArrowRight':
        step(index.current + 1)
        break
      case 'ArrowLeft':
        step(index.current < 0 ? 0 : index.current - 1)
        break
      case 'Home':
        step(0)
        break
      case 'End':
        step(pointLabels.length - 1)
        break
      case 'Escape':
        index.current = -1
        setAnnouncement('')
        chartRef.current?.dispatchAction({ type: 'hideTip' })
        break
      default:
        return
    }
    event.preventDefault()
  }

  return (
    <div
      role="group"
      tabIndex={0}
      aria-labelledby={titleId}
      aria-describedby={summaryId === undefined ? hintId : `${summaryId} ${hintId}`}
      className="rounded-md"
      onKeyDown={onKeyDown}
      onBlur={() => {
        index.current = -1
        chartRef.current?.dispatchAction({ type: 'hideTip' })
      }}
      data-testid="chart-canvas"
    >
      <span id={hintId} className="sr-only">
        Use the left and right arrow keys to step through the points, Home and End to jump to the
        first and last.
      </span>
      <div ref={hostRef} aria-hidden="true" style={{ height }} />
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  )
}

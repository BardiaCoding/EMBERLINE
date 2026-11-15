import type { ECharts, EChartsCoreOption } from 'echarts/core'
import { lazy, Suspense } from 'react'
import { useChartFrameIds } from '@/components/chartFrameContext'

// The ECharts code is a separate chunk, loaded when the first chart is shown.
const EChartCanvas = lazy(() => import('./EChartCanvas'))

export type EChartProps = {
  /** ECharts option, built by `chartOptions.ts`. A new object redraws the chart. */
  option: EChartsCoreOption
  /** Height in CSS px. Default 280. */
  height?: number
  /**
   * One sentence per point of the first series, in order. The arrow keys step through them,
   * and the active one is announced to assistive technology.
   */
  pointLabels?: readonly string[]
  /** Id of the chart title. Filled from the enclosing `ChartFrame`. */
  titleId?: string
  /** Id of the text summary. Filled from the enclosing `ChartFrame`. */
  summaryId?: string
  /** Called with the chart instance once it exists, and with null when it is disposed (export, task 25.3). */
  onChart?: (chart: ECharts | null) => void
}

/** Lazy-loaded ECharts chart. Place it inside a `ChartFrame`, which names and describes it. */
export function EChart(props: Omit<EChartProps, 'titleId' | 'summaryId'>) {
  const ids = useChartFrameIds()
  return (
    <Suspense
      fallback={
        <div
          style={{ height: props.height ?? 280 }}
          className="flex items-center text-sm text-muted-foreground"
          data-testid="chart-chunk-loading"
        >
          Loading chart…
        </div>
      }
    >
      <EChartCanvas {...props} titleId={ids?.titleId} summaryId={ids?.summaryId} />
    </Suspense>
  )
}

import { useMemo } from 'react'
import { ChartFrame } from '@/components/ChartFrame'
import { useChartExport } from './useChartExport'
import { formatCount, formatMonthLabel, TIME_CONVENTION, UNIT_CELL_DAYS } from '@/lib/format'
import {
  buildAnomalySeries,
  calendarTotal,
  describeChart,
  peakMonth,
  signedOrDash,
} from './chartModels'
import { anomalyOption, describeAnomalyPoint } from './chartOptions'
import { ChartTable } from './ChartTable'
import type { ChartQuery, StatsSlot } from './chartTypes'
import { EChart } from './EChart'
import { useChartColours } from './useChartColours'

type AnomalySeriesChartProps = ChartQuery & { stats: StatsSlot }

/**
 * Monthly anomaly series (requirement 16.4): for every month of the Date_Range, the absolute
 * anomaly against the baseline median (solid line, circles) and against the baseline mean
 * (dashed line, diamonds) of the same calendar month. Values carry a + or - sign in the tooltip,
 * the keyboard text and the table. The provisional month has no anomaly and shows a gap.
 */
export function AnomalySeriesChart({ calendar, range, area, stats }: AnomalySeriesChartProps) {
  const colours = useChartColours()
  const chartExport = useChartExport({
    title: 'Monthly anomaly',
    unit: `Difference from the baseline, ${UNIT_CELL_DAYS}, ${TIME_CONVENTION}`,
    area: area,
    range: range,
  })
  const points = useMemo(() => buildAnomalySeries(calendar), [calendar])
  const option = useMemo(() => anomalyOption(points, colours), [points, colours])
  const pointLabels = useMemo(() => points.map(describeAnomalyPoint), [points])
  const provisional = calendar.provisional_months.map(formatMonthLabel)
  const notes = [
    'Anomaly is the harmonized count minus the baseline value of the same calendar month; positive is more fires than the baseline.',
    ...(provisional.length > 0
      ? [`The provisional month ${provisional.join(', ')} has no anomaly.`]
      : []),
  ]
  const summary = describeChart({
    variable: 'Line chart of the monthly anomaly against the baseline median and the baseline mean',
    area,
    start: range.start,
    end: range.end,
    total: stats.data?.summary.total_harmonized ?? calendarTotal(calendar),
    peak: peakMonth(calendar.months),
    notes,
  })
  const rows = points.map((p) => [
    p.label,
    formatCount(p.harmonized),
    signedOrDash(p.vsMedian),
    signedOrDash(p.vsMean),
    p.provisional ? 'Provisional (count to date, no anomaly)' : 'Complete month',
  ])
  return (
    <ChartFrame
      exportSource={chartExport.exportSource}
      title="Monthly anomaly"
      unit={`Difference from the baseline, ${UNIT_CELL_DAYS}, ${TIME_CONVENTION}`}
      summary={summary}
      state={points.length === 0 ? 'empty' : 'ready'}
      testId="chart-anomaly"
      table={
        <ChartTable
          caption={`Monthly anomaly against the baseline median and the baseline mean, ${UNIT_CELL_DAYS}. ${notes.join(' ')}`}
          columns={[
            'Month',
            `Harmonized count (${UNIT_CELL_DAYS})`,
            'Against baseline median',
            'Against baseline mean',
            'Status',
          ]}
          rows={rows}
        />
      }
    >
      <EChart onChart={chartExport.onChart} option={option} pointLabels={pointLabels} />
    </ChartFrame>
  )
}

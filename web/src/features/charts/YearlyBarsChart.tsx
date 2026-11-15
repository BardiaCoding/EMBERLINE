import { useMemo } from 'react'
import { ChartFrame } from '@/components/ChartFrame'
import { useChartExport } from './useChartExport'
import { formatCount, formatMonthLabel, TIME_CONVENTION, UNIT_CELL_DAYS } from '@/lib/format'
import { buildYearlyBars, describeChart, peakMonth, sumBars } from './chartModels'
import { describeYearlyBar, yearlyBarsOption } from './chartOptions'
import { ChartTable } from './ChartTable'
import type { ChartQuery, StatsSlot } from './chartTypes'
import { EChart } from './EChart'
import { useChartColours } from './useChartColours'

type YearlyBarsChartProps = ChartQuery & { stats: StatsSlot }

/**
 * Yearly bars (requirement 16.2): one bar per calendar year of the Date_Range, a reference
 * line at the baseline yearly median, and a year that holds the provisional month drawn with
 * a dashed outline, a light fill, "(provisional)" in its label and its own legend entry.
 */
export function YearlyBarsChart({ calendar, range, area, stats }: YearlyBarsChartProps) {
  const colours = useChartColours()
  const chartExport = useChartExport({
    title: 'Harmonized count by year',
    unit: `${UNIT_CELL_DAYS}, ${TIME_CONVENTION}`,
    area: area,
    range: range,
  })
  const model = useMemo(() => buildYearlyBars(calendar), [calendar])
  const option = useMemo(() => yearlyBarsOption(model, colours), [model, colours])
  const pointLabels = useMemo(
    () => model.bars.map((b) => describeYearlyBar(b, model.baselineMedian)),
    [model],
  )
  const provisional = calendar.provisional_months.map(formatMonthLabel)
  const notes = [
    ...(provisional.length > 0
      ? [
          `The year with the provisional month ${provisional.join(', ')} is a count to date and is not a full year.`,
        ]
      : []),
    ...(model.baselineMedian === null
      ? ['No baseline yearly median is available.']
      : [`Baseline yearly median: ${formatCount(model.baselineMedian)} ${UNIT_CELL_DAYS}.`]),
  ]
  const summary = describeChart({
    variable: 'Bar chart of the harmonized count for each calendar year',
    area,
    start: range.start,
    end: range.end,
    total: stats.data?.summary.total_harmonized ?? sumBars(model.bars),

    peak: peakMonth(calendar.months),
    notes,
  })
  const rows = model.bars.map((b) => [
    String(b.year),
    formatCount(b.harmonized),
    b.nMonths === null ? '\u2014' : String(b.nMonths),
    b.provisional ? 'Provisional (count to date)' : b.partial ? 'Partial year' : 'Complete year',
  ])
  return (
    <ChartFrame
      exportSource={chartExport.exportSource}
      title="Harmonized count by year"
      unit={`${UNIT_CELL_DAYS}, ${TIME_CONVENTION}`}
      summary={summary}
      state={model.bars.length === 0 ? 'empty' : 'ready'}
      testId="chart-yearly"
      table={
        <ChartTable
          caption={`Harmonized count by year, ${UNIT_CELL_DAYS}. ${notes.join(' ')}`}
          columns={['Year', `Harmonized count (${UNIT_CELL_DAYS})`, 'Months in range', 'Status']}
          rows={rows}
        />
      }
    >
      <EChart onChart={chartExport.onChart} option={option} pointLabels={pointLabels} />
    </ChartFrame>
  )
}

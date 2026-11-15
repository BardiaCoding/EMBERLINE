import { useId, useMemo, useState } from 'react'
import { ChartFrame } from '@/components/ChartFrame'
import { useChartExport } from './useChartExport'
import {
  formatCount,
  formatMonthLabel,
  MISSING,
  monthName,
  TIME_CONVENTION,
  UNIT_CELL_DAYS,
} from '@/lib/format'
import {
  buildSeasonalModel,
  calendarTotal,
  defaultSelectedYear,
  describeChart,
  peakMonth,
  yearsOf,
} from './chartModels'
import { describeSeasonalPoint, seasonalOption } from './chartOptions'
import { ChartTable } from './ChartTable'
import type { ChartQuery, StatsSlot } from './chartTypes'
import { EChart } from './EChart'
import { useChartColours } from './useChartColours'

type SeasonalProfileChartProps = ChartQuery & { stats: StatsSlot }

/**
 * Seasonal profile (requirement 16.3): 12 points, January to December, with the baseline
 * median (solid line, circles), the 10th to 90th percentile band, and the monthly counts of
 * one selected year (dashed line, diamonds). The year defaults to the year that contains the
 * end of the Date_Range and can be any year of the result. A provisional month of the selected
 * year is a separate hollow triangle labelled "to date", never a point of the full-month line.
 */
export function SeasonalProfileChart({ calendar, range, area, stats }: SeasonalProfileChartProps) {
  const colours = useChartColours()
  const chartExport = useChartExport({
    title: 'Seasonal profile',
    unit: `${UNIT_CELL_DAYS} per month, ${TIME_CONVENTION}`,
    area: area,
    range: range,
  })
  const selectId = useId()
  const years = useMemo(() => yearsOf(calendar.months), [calendar.months])
  const [chosen, setChosen] = useState<number | null>(null)
  // A choice that is not in the new result (after the Query changes) falls back to the default.
  const year =
    chosen !== null && years.includes(chosen) ? chosen : defaultSelectedYear(range.end, years)
  const profile = stats.data?.seasonal_profile
  const model = useMemo(
    () =>
      profile === undefined || year === null
        ? null
        : buildSeasonalModel(profile, calendar.months, year),
    [profile, calendar.months, year],
  )
  const option = useMemo(
    () => (model === null ? null : seasonalOption(model, colours)),
    [model, colours],
  )
  const pointLabels = useMemo(
    () => (model === null ? [] : model.points.map((p) => describeSeasonalPoint(p, model.year))),
    [model],
  )

  let state: 'ready' | 'loading' | 'error' | 'empty' = 'ready'
  if (year === null) state = 'empty'
  else if (stats.isError && model === null) state = 'error'
  else if (model === null) state = 'loading'

  const provisional = calendar.provisional_months.map(formatMonthLabel)
  const notes = [
    ...(model === null ? [] : [`Selected year: ${model.year}.`]),
    ...(provisional.length > 0
      ? [`The provisional month ${provisional.join(', ')} is a count to date, not a full month.`]
      : []),
  ]
  const summary = describeChart({
    variable:
      'Line chart of the baseline median and 10th to 90th percentile range for each calendar month, with one year overlaid',
    area,
    start: range.start,
    end: range.end,
    total: stats.data?.summary.total_harmonized ?? calendarTotal(calendar),
    peak: peakMonth(calendar.months),
    notes,
  })
  const rows =
    model === null
      ? []
      : model.points.map((p) => [
          monthName(p.month),
          p.median === null ? MISSING : formatCount(p.median),
          p.p10 === null ? MISSING : formatCount(p.p10),
          p.p90 === null ? MISSING : formatCount(p.p90),
          p.selected === null ? MISSING : formatCount(p.selected),
          p.selectedProvisional
            ? 'Provisional (count to date)'
            : p.selected === null
              ? 'No data in the range'
              : 'Complete month',
        ])

  return (
    <ChartFrame
      exportSource={chartExport.exportSource}
      title="Seasonal profile"
      unit={`${UNIT_CELL_DAYS} per month, ${TIME_CONVENTION}`}
      summary={summary}
      state={state}
      error={stats.error}
      onRetry={stats.onRetry}
      testId="chart-seasonal"
      controls={
        <div className="flex items-center gap-2 text-sm">
          <label htmlFor={selectId} className="font-medium">
            Year shown over the baseline
          </label>
          <select
            id={selectId}
            className="min-h-8 rounded-md border border-input bg-background px-2"
            value={year ?? ''}
            onChange={(event) => {
              setChosen(Number(event.target.value))
            }}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      }
      table={
        <ChartTable
          caption={`Seasonal profile: baseline median, 10th and 90th percentile and the selected year, ${UNIT_CELL_DAYS}. ${notes.join(' ')}`}
          columns={[
            'Month',
            'Baseline median',
            'Baseline 10th percentile',
            'Baseline 90th percentile',
            `Year ${model?.year ?? ''}`,
            'Status',
          ]}
          rows={rows}
        />
      }
    >
      {option === null ? null : (
        <EChart onChart={chartExport.onChart} option={option} pointLabels={pointLabels} />
      )}
    </ChartFrame>
  )
}

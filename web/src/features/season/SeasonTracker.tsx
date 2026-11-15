import { useId, useMemo, useState } from 'react'
import { ChartFrame } from '@/components/ChartFrame'
import { useChartExport } from '@/features/charts/useChartExport'
import { ChartTable } from '@/features/charts/ChartTable'
import { EChart } from '@/features/charts/EChart'
import { useChartColours } from '@/features/charts/useChartColours'
import type { ApiGeometry } from '@/lib/api'
import { formatCount, MISSING, monthName, TIME_CONVENTION, UNIT_CELL_DAYS } from '@/lib/format'
import { useSeasonQuery } from '@/lib/queries'
import {
  buildSeasonPoints,
  describeSeasonProvisional,
  describeSeasonStatus,
  seasonLabel,
} from './seasonModel'
import { describePoint, seasonOption } from './seasonOption'

export type SeasonTrackerProps = {
  /** Selection_Area as GeoJSON, null or undefined for the full region. */
  geometry?: ApiGeometry | null
  start: string
  end: string
  /** Optional baseline period (first and last year). */
  baselineYears?: [number, number] | null
  /** Name of the area, for the text summary. */
  area: string
}

/**
 * Season tracker (requirement 21): the cumulative curve of one season year over the 10th to
 * 90th percentile envelope and the median curve, monthly. Start month and season year can be
 * changed. The in-progress season stops at the latest complete month and the provisional month
 * is stated in text. Percent of median is a dash when the median is 0.
 */
export function SeasonTracker({
  geometry = null,
  start,
  end,
  baselineYears = null,
  area,
}: SeasonTrackerProps) {
  const colours = useChartColours()
  const chartExport = useChartExport({
    title: 'Season tracker',
    unit: `Cumulative ${UNIT_CELL_DAYS}, monthly, ${TIME_CONVENTION}`,
    area: area,
    range: { start, end },
  })
  const startId = useId()
  const yearId = useId()
  const [startMonth, setStartMonth] = useState(1)
  const [year, setYear] = useState<number | null>(null)
  const query = useSeasonQuery({
    geometry,
    start,
    end,
    baseline_years: baselineYears,
    season_start_month: startMonth,
    season_year: year,
  })
  const season = query.data
  const points = useMemo(() => (season === undefined ? [] : buildSeasonPoints(season)), [season])
  const seasonName =
    season?.season_year == null ? '' : seasonLabel(season.season_year, season.season_start_month)
  const option = useMemo(
    () => (season?.season_year == null ? null : seasonOption(points, seasonName, colours)),
    [season, points, seasonName, colours],
  )
  let state: 'ready' | 'loading' | 'error' | 'empty' = 'ready'
  if (query.isError && season === undefined) state = 'error'
  else if (season === undefined) state = 'loading'
  else if (season.season_year === null) state = 'empty'

  const status = season === undefined ? '' : describeSeasonStatus(season)
  const provisional = season === undefined ? null : describeSeasonProvisional(season)
  const summary =
    `Cumulative line chart of the burning activity of one season year against the median and 10th to 90th percentile range. ${area}. ${status} ${provisional ?? ''}`.trim()

  const rows = points.map((p) => [
    `${p.monthOfSeason} (${p.label})`,
    p.median === null ? MISSING : formatCount(p.median),
    p.p10 === null ? MISSING : formatCount(p.p10),
    p.p90 === null ? MISSING : formatCount(p.p90),
    p.selected === null ? MISSING : formatCount(p.selected),
  ])

  return (
    <ChartFrame
      exportSource={chartExport.exportSource}
      title="Season tracker"
      unit={`Cumulative ${UNIT_CELL_DAYS}, monthly, ${TIME_CONVENTION}`}
      summary={summary}
      state={state}
      error={query.error}
      onRetry={() => void query.refetch()}
      emptyMessage={season?.reason ?? undefined}
      testId="chart-season-tracker"
      controls={
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <div className="flex items-center gap-2">
            <label htmlFor={startId} className="font-medium">
              Season starts in
            </label>
            <select
              id={startId}
              className="min-h-8 rounded-md border border-input bg-background px-2"
              value={startMonth}
              onChange={(event) => {
                setStartMonth(Number(event.target.value))
                setYear(null)
              }}
            >
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {monthName(i + 1)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor={yearId} className="font-medium">
              Season year
            </label>
            <select
              id={yearId}
              className="min-h-8 rounded-md border border-input bg-background px-2"
              value={season?.season_year ?? ''}
              onChange={(event) => {
                setYear(Number(event.target.value))
              }}
            >
              {(season?.available_season_years ?? []).map((y) => (
                <option key={y} value={y}>
                  {seasonLabel(y, startMonth)}
                </option>
              ))}
            </select>
          </div>
        </div>
      }
      table={
        <ChartTable
          caption={`Season tracker: cumulative median, 10th and 90th percentile and the selected season, ${UNIT_CELL_DAYS}. ${status}`}
          columns={[
            'Month of season',
            'Median',
            '10th percentile',
            '90th percentile',
            `Season ${seasonName}`,
          ]}
          rows={rows}
        />
      }
    >
      <p className="mb-1 text-sm" data-testid="season-status">
        {status}
      </p>
      {provisional === null ? null : (
        <p className="mb-1 text-sm text-muted-foreground" data-testid="season-provisional">
          {provisional}
        </p>
      )}
      {option === null ? null : (
        <EChart
          onChart={chartExport.onChart}
          option={option}
          pointLabels={points.map((p) => describePoint(p, seasonName))}
        />
      )}
    </ChartFrame>
  )
}

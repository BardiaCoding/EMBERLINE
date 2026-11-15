import { ChartFrame } from '@/components/ChartFrame'
import { formatCount, formatMonth, TIME_CONVENTION, UNIT_CELL_DAYS } from '@/lib/format'
import { calendarTotal, describeChart, peakMonth } from './chartModels'
import type { ChartQuery, StatsSlot } from './chartTypes'

type RankingListsProps = ChartQuery & { stats: StatsSlot }

/**
 * Top 10 months and top 10 years by harmonized count (requirement 16.5), as ordered HTML
 * lists. The server sorts them (descending count, earlier date first on a tie) and leaves out
 * the provisional month and its year, so fewer than 10 entries can appear.
 */
export function RankingLists({ calendar, range, area, stats }: RankingListsProps) {
  const data = stats.data
  let state: 'ready' | 'loading' | 'error' = 'ready'
  if (data === undefined) state = stats.isError ? 'error' : 'loading'
  const hasProvisional = calendar.provisional_months.length > 0
  const notes = hasProvisional
    ? ['The provisional month and its year are left out of the rankings.']
    : []
  const summary = describeChart({
    variable: 'Rankings of the months and years with the highest harmonized count',
    area,
    start: range.start,
    end: range.end,
    total: data?.summary.total_harmonized ?? calendarTotal(calendar),
    peak: peakMonth(calendar.months),
    notes,
  })
  return (
    <ChartFrame
      title="Top months and years"
      unit={`Harmonized count, ${UNIT_CELL_DAYS}, ${TIME_CONVENTION}`}
      summary={summary}
      state={state}
      error={stats.error}
      onRetry={stats.onRetry}
      testId="chart-rankings"
    >
      {data === undefined ? null : (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <h4 className="text-sm font-semibold">Top 10 months</h4>
            <ol className="mt-1 list-decimal pl-6 text-sm tabular-nums" data-testid="top-months">
              {data.top_months.map((m) => (
                <li key={`${m.year}-${m.month}`}>
                  {formatMonth(m.year, m.month)}: {formatCount(m.harmonized)}
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h4 className="text-sm font-semibold">Top 10 years</h4>
            <ol className="mt-1 list-decimal pl-6 text-sm tabular-nums" data-testid="top-years">
              {data.top_years.map((y) => (
                <li key={y.year}>
                  {y.year}: {formatCount(y.harmonized)}
                  {y.n_months !== null && y.n_months < 12
                    ? ` (partial year, ${y.n_months} months)`
                    : ''}
                </li>
              ))}
            </ol>
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Counts are in {UNIT_CELL_DAYS}. Ties list the earlier date first.
            {hasProvisional ? ' The provisional month and its year are left out.' : ''}
          </p>
        </div>
      )}
    </ChartFrame>
  )
}

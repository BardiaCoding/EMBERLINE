import type { CalendarOut, StatsOut } from '@/lib/api'
import { formatCount, formatMonthLabel, UNIT_CELL_DAYS, UNIT_CELL_DAYS_RAW } from '@/lib/format'
import { formatWatchBadge } from '@/lib/watch'
import { cn } from '@/lib/utils'
import { WatchBadge } from './WatchBadge'
import { summaryTotals } from './resultsSummary'

type SummaryCardsProps = {
  result: Pick<CalendarOut, 'months'>
  /** Optional watch data from StatsOut */
  watch?: StatsOut['watch'] | null
  className?: string
}

const wholeNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

type CardProps = { label: string; value: string; unit: string; note?: string; testId: string }

function Card({ label, value, unit, note, testId }: CardProps) {
  return (
    <div
      className="rounded-lg border border-border bg-card p-3 text-card-foreground"
      data-testid={testId}
    >
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1">
        <span className="text-2xl font-semibold">{value}</span>
        <span className="ml-2 text-sm text-muted-foreground">{unit}</span>
        {note ? <span className="mt-1 block text-xs text-muted-foreground">{note}</span> : null}
      </dd>
    </div>
  )
}

/**
 * Summary cards (requirement 16.1): the total harmonized count over the Date_Range, and raw
 * MODIS and raw VIIRS cell-days as two separate values. The raw values are never added.
 * A Query with zero cell-days shows 0 in all three (requirement 16.9).
 */
export function SummaryCards({ result, watch = null, className }: SummaryCardsProps) {
  const totals = summaryTotals(result)
  const provisional =
    totals.provisionalMonths.length > 0
      ? `Includes ${totals.provisionalMonths.map(formatMonthLabel).join(', ')} to date (provisional).`
      : undefined
  const watchBadgeData = formatWatchBadge(watch ?? null)
  return (
    <section aria-label="Summary figures" className={cn('space-y-2', className)}>
      {watch ? (
        <div className="mb-2">
          <WatchBadge data={watchBadgeData} />
        </div>
      ) : null}
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card
          testId="card-harmonized"
          label="Total harmonized"
          value={formatCount(totals.harmonized)}
          unit={UNIT_CELL_DAYS}
          note={provisional}
        />
        <Card
          testId="card-raw-modis"
          label="Raw MODIS"
          value={wholeNumber.format(totals.rawModis)}
          unit={UNIT_CELL_DAYS_RAW}
        />
        <Card
          testId="card-raw-viirs"
          label="Raw VIIRS"
          value={wholeNumber.format(totals.rawViirs)}
          unit={UNIT_CELL_DAYS_RAW}
        />
      </dl>
      <p className="text-xs text-muted-foreground">
        Raw MODIS and raw VIIRS are shown separately and are not added. The harmonized total is on
        the MODIS-equivalent scale.
      </p>
    </section>
  )
}

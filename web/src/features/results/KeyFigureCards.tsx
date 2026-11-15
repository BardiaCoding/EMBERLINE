import type { ReactNode } from 'react'
import { InfoControl } from '@/components/InfoControl'
import type { AnomalyOut, CurrentMonthOut, CurrentYearOut } from '@/lib/api'
import {
  formatCount,
  formatMonth,
  formatPercentDifference,
  formatSignedCount,
  monthName,
  NO_TYPICAL_FIRES,
  TIME_CONVENTION,
  UNIT_CELL_DAYS,
} from '@/lib/format'
import { cn } from '@/lib/utils'

type KeyFigureCardsProps = {
  currentMonth: CurrentMonthOut | null
  currentYear: CurrentYearOut | null
  /** Sentence naming the baseline period. */
  baselineText?: string
  className?: string
}

function Line({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <span className="mt-1 block text-xs text-muted-foreground" data-testid={testId}>
      {children}
    </span>
  )
}

/** `+12.0 (+8.5%) against the median` or, for a median of 0, the "no typical fires" sentence. */
function differenceText(anomaly: AnomalyOut, against: string): string {
  const absolute = formatSignedCount(anomaly.absolute)
  if (anomaly.percent === null) return `${NO_TYPICAL_FIRES}; ${absolute} ${against}`
  return `${absolute} (${formatPercentDifference(anomaly.percent)}) ${against}`
}

type CardProps = { label: string; value: string; testId: string; children: ReactNode }

function Card({ label, value, testId, children }: CardProps) {
  return (
    <div
      className="rounded-lg border border-border bg-card p-3 text-card-foreground"
      data-testid={testId}
    >
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1">
        <span className="text-2xl font-semibold">{value}</span>
        <span className="ml-2 text-sm text-muted-foreground">{UNIT_CELL_DAYS}</span>
        {children}
      </dd>
    </div>
  )
}

function MonthCard({ month }: { month: CurrentMonthOut }) {
  const name = formatMonth(month.year, month.month)
  return (
    <Card
      testId="card-current-month"
      label={`Month at the end of the range: ${name}`}
      value={formatCount(month.harmonized)}
    >
      {month.provisional ? (
        <Line testId="card-current-month-status">
          Count to date (provisional). The month is not complete, so there is no comparison with the
          baseline.
        </Line>
      ) : month.baseline_median === null ? (
        <Line testId="card-current-month-status">No baseline is available for this month.</Line>
      ) : (
        <>
          <Line testId="card-current-month-baseline">
            Baseline median for {monthName(month.month)}: {formatCount(month.baseline_median)} (
            {month.baseline_n_years} years){' '}
            <InfoControl helpKey="baseline_median" term="baseline median" />
          </Line>
          {month.anomaly === null ? null : (
            <Line testId="card-current-month-difference">
              {differenceText(month.anomaly, 'against the median')}. Percentile rank:{' '}
              {formatCount(month.anomaly.percentile_rank)}.
            </Line>
          )}
        </>
      )}
    </Card>
  )
}

function YearCard({ year }: { year: CurrentYearOut }) {
  const partial = year.n_months < 12
  return (
    <Card
      testId="card-current-year"
      label={`Year at the end of the range: ${year.year}${year.provisional ? ' (provisional)' : ''}`}
      value={formatCount(year.harmonized)}
    >
      {year.provisional ? (
        <Line testId="card-current-year-status">
          Provisional: the year includes a month that is still incomplete, so its total is a count
          to date and is not compared with full years.
        </Line>
      ) : null}
      {partial && !year.provisional ? (
        <Line>Partial year: {year.n_months} months are in the range.</Line>
      ) : null}
      {year.baseline_median === null ? (
        year.provisional || partial ? null : (
          <Line testId="card-current-year-status">No baseline is available for this year.</Line>
        )
      ) : (
        <>
          <Line testId="card-current-year-baseline">
            Baseline yearly median: {formatCount(year.baseline_median)} ({year.baseline_n_years}{' '}
            years)
          </Line>
          {year.anomaly === null ? null : (
            <Line testId="card-current-year-difference">
              {differenceText(year.anomaly, 'against the yearly median')}.
              {year.percentile_rank === null
                ? ''
                : ` Percentile rank (0 to 100) among the baseline yearly totals: ${formatCount(year.percentile_rank)}.`}
            </Line>
          )}
        </>
      )}
    </Card>
  )
}

/**
 * Cards for the month and the year that contain the end of the Date_Range, each against its
 * baseline (requirement 16.1). A provisional month shows its count to date with no baseline
 * comparison; a provisional or partial year is labelled and not compared with full years. A
 * baseline median of 0 gives the "no typical fires" sentence, never an infinite percent.
 * Differences carry a + or - sign.
 */
export function KeyFigureCards({
  currentMonth,
  currentYear,
  baselineText,
  className,
}: KeyFigureCardsProps) {
  return (
    <section
      aria-label="Current month and year against the baseline"
      className={cn('space-y-2', className)}
    >
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {currentMonth === null ? null : <MonthCard month={currentMonth} />}
        {currentYear === null ? null : <YearCard year={currentYear} />}
      </dl>
      {currentMonth === null && currentYear === null ? (
        <p className="text-sm text-muted-foreground">
          The end of the range has no month in this result, so there is no current month or year to
          compare.
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Counts are in {UNIT_CELL_DAYS}. Months and years use {TIME_CONVENTION}. The current month
        and year are the ones that contain the end of the date range.
      </p>
      {baselineText === undefined ? null : (
        <p className="text-xs text-muted-foreground" data-testid="cards-baseline">
          {baselineText}
        </p>
      )}
    </section>
  )
}

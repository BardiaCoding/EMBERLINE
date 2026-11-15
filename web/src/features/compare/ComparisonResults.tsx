// The results slot in comparison mode (requirements 19.1, 19.4, 19.5): two Calendar panels
// from two /calendar requests, with one shared colour scale. Replaces the single-view results
// while a comparison is on; the single view is unchanged when the mode is `none`.
import type { UseQueryResult } from '@tanstack/react-query'
import { CalendarViewSwitch } from '@/features/calendar/CalendarViewSwitch'
import { ErrorCard } from '@/features/results/ResultStates'
import type { MetaOut } from '@/lib/api'
import type { CalendarView } from '@/lib/binning'
import type { CalendarData } from '@/lib/queries'
import type { UrlCompare } from '@/lib/urlState'
import { CompareView } from './CompareView'

type ComparisonResultsProps = {
  compare: UrlCompare
  view: CalendarView
  onViewChange: (view: CalendarView) => void
  first: UseQueryResult<CalendarData>
  second: UseQueryResult<CalendarData>
  meta: MetaOut | undefined
  /** Panel labels: the areas in area mode, the date ranges in period mode. */
  areaLabel: string
  areaLabel2: string
}

function periodLabel(data: CalendarData): string {
  return `${data.range.start} to ${data.range.end}`
}

export function ComparisonResults({
  compare,
  view,
  onViewChange,
  first,
  second,
  meta,
  areaLabel,
  areaLabel2,
}: ComparisonResultsProps) {
  const failed = first.isError ? first : second.isError ? second : null
  let body
  if (failed !== null) {
    body = (
      <ErrorCard
        error={failed.error}
        onRetry={() => {
          void failed.refetch()
        }}
      />
    )
  } else if (first.data === undefined || second.data === undefined || meta === undefined) {
    body = (
      <p className="text-sm text-muted-foreground" role="status">
        Loading the comparison…
      </p>
    )
  } else {
    const options = (data: CalendarData) => ({
      range: data.range,
      recordStart: meta.record_start,
      latestMonth: meta.latest_month,
    })
    const period = compare.mode === 'period'
    body = (
      <CompareView
        result1={first.data.result}
        result2={second.data.result}
        compare={compare}
        view={view}
        range1={first.data.range}
        range2={second.data.range}
        options1={options(first.data)}
        options2={options(second.data)}
        area1_km2={first.data.result.area_km2 ?? undefined}
        area2_km2={second.data.result.area_km2 ?? undefined}
        label1={period ? `Period 1: ${periodLabel(first.data)}` : `Area 1: ${areaLabel}`}
        label2={period ? `Period 2: ${periodLabel(second.data)}` : `Area 2: ${areaLabel2}`}
      />
    )
  }
  return (
    <section aria-label="Comparison" className="flex flex-col gap-4" data-testid="comparison">
      <CalendarViewSwitch value={view} onChange={onViewChange} />
      {body}
    </section>
  )
}

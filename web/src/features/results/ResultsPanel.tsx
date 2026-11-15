import { lazy, Suspense, useId, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { CalendarGrid } from '@/features/calendar/CalendarGrid'
import { DetailPanel } from '@/features/calendar/DetailPanel'
import { CalendarLegend } from '@/features/calendar/CalendarLegend'
import { CalendarTable } from '@/features/calendar/CalendarTable'
import { CalendarViewSwitch } from '@/features/calendar/CalendarViewSwitch'
import type { StatsSlot } from '@/features/charts/chartTypes'
import type { ApiGeometry } from '@/lib/api'
import {
  describeCell,
  type CalendarCell,
  type CalendarModel,
  type CalendarView,
} from '@/lib/binning'
import { formatMonthLabel } from '@/lib/format'
import type { CalendarData } from '@/lib/queries'
import { KeyFigureCards } from './KeyFigureCards'
import { panelElementId, tabElementId, type ResultsTabId } from './resultTabs'
import { EmptyState, ErrorCard, LoadingIndicator, UpdatingLabel } from './ResultStates'
import { isEmptyResult } from './resultsSummary'
import { ResultsTabs } from './ResultsTabs'
import { StatusAnnouncer } from './StatusAnnouncer'
import { detailsOpenedMessage, MESSAGE_DETAILS_CLOSED } from './statusMessages'
import { SummaryCards } from './SummaryCards'
import type { ResultsStatus } from './useResultsStatus'
import { useResultsAboveCalendar } from './useResultsAboveCalendar'

// The chart tabs are separate chunks: ECharts is not part of the initial bundle (design G12).
const TrendsTab = lazy(() => import('@/features/charts/TrendsTab'))
const SeasonTab = lazy(() => import('@/features/charts/SeasonTab'))
const RecentTab = lazy(() => import('@/features/recent/RecentTab'))

type ResultsPanelProps = {
  status: ResultsStatus
  /** A load failure shown in place of the results (the Calendar or `/meta` request failed). */
  loadError: { error: unknown; onRetry: () => void } | null
  calendar: CalendarData | undefined
  /** The Calendar model of `calendar`, or null while it is not known. */
  model: CalendarModel | null
  /**
   * The `/stats` result for the same Query as `calendar`. `data` is undefined while it loads,
   * after it failed, and while it is out of step with `calendar` (so no old value is shown).
   */
  stats: StatsSlot
  /** Name of the Selection_Area, or its coordinates. */
  areaLabel: string
  /** The accepted Selection_Area for the season tracker, null for the full region. */
  geometry?: ApiGeometry | null
  /** The applied baseline period (first and last year), null for the default. */
  baselineYears?: [number, number] | null
  /** Sentence naming the baseline period, shown in the legend and on the cards. */
  baselineText?: string
  view: CalendarView
  onViewChange: (view: CalendarView) => void
  /** The selected tab and its setter, when the parent keeps it (for the page address). */
  tab?: ResultsTabId
  onTabChange?: (tab: ResultsTabId) => void
  /** The month (`YYYY-MM`) the map is filtered to, and the toggle for a clicked Calendar cell. */
  selectedMonth?: string | null
  onSelectMonth?: (key: string) => void
  onClearMonth?: () => void
}

/** The Calendar cell with data for `key` (`YYYY-MM`), or null. */
function findCell(model: CalendarModel | null, key: string | null): CalendarCell | null {
  if (model === null || key === null) return null
  for (const row of model.rows) {
    const cell = row.cells.find((c) => c.key === key)
    if (cell !== undefined) return cell.state === 'no_data' ? null : cell
  }
  return null
}

const noop = (): void => undefined

function MonthFilterChip({ monthKey, onClear }: { monthKey: string; onClear?: () => void }) {
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="month-filter-chip">
      <span className="rounded-full border border-border px-3 py-1">
        Filtered to {formatMonthLabel(monthKey)}
      </span>
      <button type="button" className="underline" onClick={onClear}>
        Clear filter
      </button>
    </p>
  )
}
function StatsCardsState({ stats }: { stats: StatsSlot }) {
  if (stats.isError) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-destructive bg-card p-3 text-sm"
        data-testid="stats-error"
      >
        <p>The current month and year figures could not be loaded. The Calendar is not affected.</p>
        <Button type="button" className="mt-2" variant="outline" onClick={stats.onRetry}>
          Retry key figures
        </Button>
      </div>
    )
  }
  return (
    <p className="text-sm text-muted-foreground" data-testid="stats-loading">
      Loading the current month and year figures…
    </p>
  )
}

/**
 * The results panel: status label, summary cards, current month and year cards, the tab list
 * and the active tab (Calendar, Trends, Season). It shows an error card, the empty state or the
 * loading indicator in place of the cards and tabs when there are no results to show.
 *
 * Everything above the Calendar region (status label, cards, tab list, view switch) sits in one
 * element whose bottom edge `useResultsAboveCalendar` publishes as `--results-above-calendar`,
 * so the Calendar region fills the rest of the viewport (requirement 26.11).
 */
export function ResultsPanel({
  status,
  loadError,
  calendar,
  model,
  stats,
  areaLabel,
  geometry = null,
  baselineYears = null,
  baselineText,
  view,
  onViewChange,
  selectedMonth = null,
  onSelectMonth,
  onClearMonth,
  tab: tabProp,
  onTabChange,
}: ResultsPanelProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const aboveRef = useRef<HTMLDivElement>(null)
  useResultsAboveCalendar(aboveRef, rootRef)

  const idPrefix = `results${useId()}`
  const [ownTab, setOwnTab] = useState<ResultsTabId>('calendar')
  const tab = tabProp ?? ownTab
  const setTab = (next: ResultsTabId): void => {
    setOwnTab(next)
    onTabChange?.(next)
  }

  // The Detail_Panel is open while a Calendar cell with data is selected (requirement 15.27).
  const showTabsForPanel =
    loadError === null && calendar !== undefined && !isEmptyResult(calendar.result)
  const panelCell = showTabsForPanel ? findCell(model, selectedMonth) : null
  // One status live region: the newest of the results status text and the Detail_Panel
  // opening or closing text. Set while rendering, when either source changes.
  const panelKey = panelCell?.key ?? null
  const [announced, setAnnounced] = useState({
    key: panelKey,
    status: status.announcement,
    message: '',
  })
  if (announced.key !== panelKey || announced.status !== status.announcement) {
    const panelChanged = announced.key !== panelKey
    setAnnounced({
      key: panelKey,
      status: status.announcement,
      message: panelChanged
        ? panelCell !== null && model !== null
          ? detailsOpenedMessage(describeCell(model, panelCell).title)
          : MESSAGE_DETAILS_CLOSED
        : status.announcement,
    })
  }
  const hasResults = loadError === null && calendar !== undefined && model !== null
  const empty = hasResults && isEmptyResult(calendar.result)
  const showTabs = hasResults && !empty
  const chartQuery =
    calendar === undefined
      ? null
      : { calendar: calendar.result, range: calendar.range, area: areaLabel }

  let body: ReactNode = null
  if (loadError !== null) {
    body = <ErrorCard error={loadError.error} onRetry={loadError.onRetry} />
  } else if (hasResults && empty) {
    body = <EmptyState area={areaLabel} start={calendar.range.start} end={calendar.range.end} />
  } else if (showTabs && chartQuery !== null) {
    body = (
      <div
        role="tabpanel"
        id={panelElementId(idPrefix, tab)}
        aria-labelledby={tabElementId(idPrefix, tab)}
        tabIndex={0}
      >
        {tab === 'calendar' ? (
          <div className="flex flex-col gap-4">
            {selectedMonth === null ? null : (
              <MonthFilterChip monthKey={selectedMonth} onClear={onClearMonth} />
            )}
            <CalendarGrid
              model={model}
              selectedKey={selectedMonth}
              onSelect={onSelectMonth}
              onClearSelection={onClearMonth}
              description={`Area: ${areaLabel}. Range: ${calendar.range.start} to ${calendar.range.end}.`}
            />
            <CalendarLegend model={model} baselineText={baselineText} />
            <details>
              <summary className="cursor-pointer text-sm font-medium">View table</summary>
              <CalendarTable model={model} className="mt-2" />
            </details>
          </div>
        ) : (
          <Suspense fallback={<LoadingIndicator />}>
            {tab === 'trends' ? (
              <TrendsTab {...chartQuery} stats={stats} />
            ) : tab === 'recent' ? (
              <RecentTab geometry={geometry} baselineYears={baselineYears} area={areaLabel} />
            ) : (
              <SeasonTab
                {...chartQuery}
                stats={stats}
                geometry={geometry}
                baselineYears={baselineYears}
              />
            )}
          </Suspense>
        )}
      </div>
    )
  } else if (status.showLoading) {
    body = <LoadingIndicator />
  }

  return (
    <div
      ref={rootRef}
      aria-busy={status.updating === 'updating'}
      data-updating={status.updating === 'updating' ? 'true' : undefined}
      className="flex flex-col gap-3"
      data-testid="results-panel"
    >
      <div ref={aboveRef} className="flex flex-col gap-3">
        <StatusAnnouncer message={announced.message} />
        <UpdatingLabel state={status.updating} />
        {showTabs ? (
          <>
            <SummaryCards result={calendar.result} watch={stats.data?.watch} />
            {stats.data === undefined ? (
              <StatsCardsState stats={stats} />
            ) : (
              <KeyFigureCards
                currentMonth={stats.data.current_month}
                currentYear={stats.data.current_year}
                baselineText={baselineText}
              />
            )}
            <ResultsTabs value={tab} onChange={setTab} idPrefix={idPrefix} />
            {tab === 'calendar' ? (
              <CalendarViewSwitch value={view} onChange={onViewChange} />
            ) : null}
          </>
        ) : null}
      </div>
      {body}
      {panelCell !== null && model !== null ? (
        <DetailPanel model={model} cell={panelCell} isOpen onClose={onClearMonth ?? noop} />
      ) : null}
    </div>
  )
}

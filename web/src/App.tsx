import { useEffect, useMemo, useRef, useState } from 'react'
import { AppShell } from '@/components/AppShell'
import { AreaMessages } from '@/features/area/AreaMessages'
import { AreaPanel } from '@/features/area/AreaPanel'
import { useAreaSelection } from '@/features/area/useAreaSelection'
import { BaselinePanel } from '@/features/baseline/BaselinePanel'
import { baselineLabel, completeYearBounds } from '@/features/baseline/baselineYears'
import {
  isBaselineRejection,
  useBaselineRejection,
  useBaselineSelection,
} from '@/features/baseline/useBaseline'
import { CompareControls } from '@/features/compare/CompareControls'
import { ComparisonResults } from '@/features/compare/ComparisonResults'
import { useSelectCell } from '@/features/calendar/useSelectCell'
import { DateRangePanel } from '@/features/dates/DateRangePanel'
import { DownloadsMenu } from '@/features/export/DownloadsMenu'
import { extentFromMeta, resolveExtent } from '@/features/map/extent'
import { MapView } from '@/features/map/MapView'
import type { MapLayerRequest } from '@/features/map/mapLayerApi'
import type { StatsSlot } from '@/features/charts/chartTypes'
import { isDataUnavailable } from '@/features/results/dataUnavailable'
import { DataUnavailable } from '@/features/results/ResultStates'
import { RESULT_TABS, type ResultsTabId } from '@/features/results/resultTabs'
import { ResultsPanel } from '@/features/results/ResultsPanel'
import { useResultsStatus } from '@/features/results/useResultsStatus'
import type { HotspotExportRequest } from '@/lib/api'
import { formatBbox5, geometryBbox } from '@/lib/areaGeometry'
import { buildCalendarModel, type CalendarView } from '@/lib/binning'
import { availableRecord, defaultDateRange, type DateRange } from '@/lib/dates'
import { REGION_LABEL } from '@/lib/format'
import {
  areaCalendarRequest,
  useCalendarQuery,
  useHealthQuery,
  useMetaQuery,
  useStatsQuery,
} from '@/lib/queries'
import {
  decodeState,
  parseCellId,
  rejectedNotice,
  serializeState,
  type AppState,
  type UrlArea,
  type UrlCompare,
} from '@/lib/urlState'
import { useUrlWriter } from '@/lib/useUrlWriter'
import { resolveSharedArea } from '@/lib/sharedArea'
import { CopyLinkButton } from '@/features/share/CopyLinkButton'

const TAB_IDS: readonly string[] = RESULT_TABS.map((t) => t.id)
// Only used to read the settings that do not depend on `/meta` (view, tab, area) on first render.
const NO_RANGE = { start: '0000-01-01', end: '0000-01-01' }
/**
 * The minimal app: area and Date_Range panels, map, summary cards, Calendar and legend. The
 * Selection_Area is the full region until the user draws a shape, picks an example area or
 * enters coordinates (each is checked by the server first).
 *
 * The page address holds the shareable state (requirements 14.5, 19.1 to 19.3, 19.8): area
 * geometry, Date_Range, Calendar view, results tab and the settings the app does not use yet.
 * It is read once, when the page opens (the Date_Range after `/meta` has answered, because it is
 * checked against the record), and written back with `history.replaceState` 200 ms after a
 * change. A parameter that is not usable falls back to its default and is named in a notice.
 * A geometry in the address goes through the same server check as a drawn shape; results wait
 * for that check, so the full region is not shown first.
 */
export function App() {
  const health = useHealthQuery()
  const meta = useMetaQuery()
  // The address as it was when the page opened: the only place a range is read from.
  const [initialSearch] = useState(() => window.location.search)
  const [applied, setApplied] = useState<DateRange | null>(null)
  // View, tab and area from the address, read without the record (they do not need it).
  const [initialState] = useState(
    () => decodeState(initialSearch, { fallback: NO_RANGE, tabs: TAB_IDS }).state,
  )
  const [view, setView] = useState<CalendarView>(initialState.view)
  // The selected Calendar cell (`YYYY-MM`, page address `cell`). Selecting it opens the
  // Detail_Panel and filters the map to that month as one action (requirement 15.27).
  const [cell, setCell] = useState<string | undefined>(initialState.cell)
  const [tab, setTab] = useState<ResultsTabId>(
    () => RESULT_TABS.find((t) => t.id === initialState.tab)?.id ?? 'calendar',
  )

  const metaData = meta.data
  const fromUrl = useMemo(() => {
    if (metaData === undefined) return null
    const fallback = defaultDateRange(metaData.first_date, metaData.latest_month)
    const decoded = decodeState(initialSearch, {
      fallback,
      record: availableRecord(metaData.first_date, metaData.latest_month),
      tabs: TAB_IDS,
    })
    return {
      state: decoded.state,
      range: { start: decoded.state.start, end: decoded.state.end },
      notice: rejectedNotice(decoded.rejected, fallback),
    }
  }, [metaData, initialSearch])
  const range = applied ?? fromUrl?.range ?? null

  const regionExtent = useMemo(() => resolveExtent(extentFromMeta(metaData)), [metaData])
  const selection = useAreaSelection(regionExtent)
  const { submitGeometry } = selection
  // Comparison mode (task 28.6): the second area has its own selection. It is chosen with the
  // area panel in the comparison controls (examples, coordinates, circle, file), not on the map.
  const selection2 = useAreaSelection(regionExtent)
  const { submitGeometry: submitGeometry2 } = selection2
  // Area restore: a geometry in the address is checked like a drawn shape. `restored` is false
  // until that check has answered; queries and address writes wait for it.
  const initialArea = initialState.area
  const [restored, setRestored] = useState(initialArea.kind === 'region')
  const [areaNotice, setAreaNotice] = useState<string | null>(null)
  const restoreStarted = useRef(false)
  useEffect(() => {
    if (initialArea.kind === 'region' || restoreStarted.current) return
    restoreStarted.current = true
    const unusable = 'The area in the page address could not be used, so the full region is shown.'
    if (initialArea.kind === 'geom') {
      void submitGeometry(initialArea.geometry, 'url').then((kept) => {
        if (!kept) setAreaNotice(unusable)
        setRestored(true)
      })
      return
    }
    // A short link (`s=`): read the stored area, then check it like a drawn shape (19.2, 19.8).
    void resolveSharedArea(initialArea.id)
      .then(async (result) => {
        if (result.ok) {
          if (!(await submitGeometry(result.geometry, 'url'))) setAreaNotice(unusable)
        } else {
          setAreaNotice(result.notice)
        }
      })
      .finally(() => {
        setRestored(true)
      })
  }, [initialArea, submitGeometry])
  // The second area of a comparison in the address is restored the same way.
  const initialArea2 = initialState.compare.mode === 'area' ? initialState.compare.area2 : null
  const [restored2, setRestored2] = useState(
    initialArea2 === null || initialArea2.kind === 'region',
  )
  const restore2Started = useRef(false)
  useEffect(() => {
    if (initialArea2 === null || initialArea2.kind === 'region' || restore2Started.current) return
    restore2Started.current = true
    const unusable =
      'The second area in the page address could not be used, so the full region is shown for it.'
    if (initialArea2.kind === 'geom') {
      void submitGeometry2(initialArea2.geometry, 'url').then((kept) => {
        if (!kept) setAreaNotice(unusable)
        setRestored2(true)
      })
      return
    }
    void resolveSharedArea(initialArea2.id)
      .then(async (result) => {
        if (result.ok) {
          if (!(await submitGeometry2(result.geometry, 'url'))) setAreaNotice(unusable)
        } else {
          setAreaNotice(result.notice)
        }
      })
      .finally(() => {
        setRestored2(true)
      })
  }, [initialArea2, submitGeometry2])
  const notice =
    applied === null
      ? [fromUrl?.notice ?? null, areaNotice].filter((n) => n !== null).join(' ') || null
      : areaNotice
  // The accepted area only. A shape being checked, or rejected, never changes the query, so
  // the previous results stay on screen (requirements 11.7, 13.9). Null means the full region.
  const areaGeometry = selection.area?.geometry ?? null
  // The baseline period (page address `bl`). A rejected baseline is put back below.
  const baselineSelection = useBaselineSelection(initialState.baseline ?? null)
  const { baseline } = baselineSelection
  const request = useMemo(
    () => (range === null || !restored ? null : areaCalendarRequest(range, areaGeometry, baseline)),
    [range, areaGeometry, restored, baseline],
  )
  // Comparison settings. Until the user changes them they come from the address (the second
  // Date_Range is checked against the record there). `none` keeps the single view.
  const [compareChoice, setCompareChoice] = useState<UrlCompare | null>(null)
  const urlCompare = fromUrl?.state.compare
  const areaGeometry2 = selection2.area?.geometry ?? null
  const compare = useMemo<UrlCompare>(() => {
    const base: UrlCompare = compareChoice ?? urlCompare ?? { mode: 'none' }
    if (base.mode !== 'area') return base
    const area2: UrlArea =
      areaGeometry2 === null ? { kind: 'region' } : { kind: 'geom', geometry: areaGeometry2 }
    return { ...base, area2 }
  }, [compareChoice, urlCompare, areaGeometry2])
  // The second panel's own /calendar request: the second area, or the second date range.
  const request2 = useMemo(() => {
    if (range === null || !restored || !restored2) return null
    if (compare.mode === 'area') return areaCalendarRequest(range, areaGeometry2, baseline)
    if (compare.mode === 'period') {
      return areaCalendarRequest(
        { start: compare.start2, end: compare.end2 },
        areaGeometry,
        baseline,
      )
    }
    return null
  }, [compare, range, restored, restored2, areaGeometry, areaGeometry2, baseline])
  const hotspotRequest = useMemo<HotspotExportRequest | null>(
    () =>
      range === null || !restored
        ? null
        : { geometry: areaGeometry, start: range.start, end: range.end },
    [range, areaGeometry, restored],
  )

  // The address: everything read from it stays (settings the app does not use yet included),
  // the parts the user can change are replaced by the current values.
  const currentState = useMemo<AppState | null>(() => {
    if (fromUrl === null || range === null || !restored || !restored2) return null
    const next: AppState = {
      ...fromUrl.state,
      area: areaGeometry === null ? { kind: 'region' } : { kind: 'geom', geometry: areaGeometry },
      start: range.start,
      end: range.end,
      view,
      compare,
    }
    if (baseline === null) delete next.baseline
    else next.baseline = baseline
    if (tab === 'calendar') delete next.tab
    else next.tab = tab
    if (cell === undefined) delete next.cell
    else next.cell = cell
    return next
  }, [fromUrl, range, restored, restored2, areaGeometry, baseline, view, tab, cell, compare])

  // Cell selection (task 28.9): `selectCell` and `clearSelection` write the `cell` part of the
  // address state. Everything else in the address comes from `currentState`.
  const stateRef = useRef<AppState | null>(currentState)
  useEffect(() => {
    stateRef.current = currentState
  })
  const cellSelection = useSelectCell(currentState, (update) => {
    const prev = stateRef.current
    if (prev !== null) setCell(update(prev).cell)
  })

  const urlSearch = useMemo(
    () => (currentState === null ? null : serializeState(initialSearch, currentState)),
    [currentState, initialSearch],
  )
  useUrlWriter(urlSearch)
  const calendar = useCalendarQuery(request)
  const calendarData = calendar.data
  const calendar2 = useCalendarQuery(request2)
  useBaselineRejection(baselineSelection, calendar)
  const baselineRejected = isBaselineRejection(calendar.error)
  // Key figures and chart data for the same request. They are shown only while they answer the
  // same Query as the Calendar result (both fresh, or both held), so no old value stays on
  // screen beside new ones (requirement 16.8).
  const stats = useStatsQuery(request)

  const metaLoading = metaData === undefined && meta.isFetching
  const status = useResultsStatus({
    isPlaceholderData: calendar.isPlaceholderData || stats.isPlaceholderData,
    isFetching: calendar.isFetching || stats.isFetching || metaLoading,
    isError: (calendar.isError && !baselineRejected) || meta.isError,
    hasData: calendarData !== undefined,
  })

  const model = useMemo(
    () =>
      calendarData === undefined || metaData === undefined
        ? null
        : buildCalendarModel(calendarData.result, view, {
            range: calendarData.range,
            recordStart: metaData.record_start,
            latestMonth: metaData.latest_month,
          }),
    [calendarData, metaData, view],
  )

  // Selected month: format from cellSelection.selection, only active within applied range.
  const selectedMonthKey = useMemo(() => {
    if (cellSelection.selection === null || range === null) return null
    const { year, month } = cellSelection.selection
    const cellKey = `${year}-${String(month).padStart(2, '0')}`
    // Only show selection if within the applied range
    if (cellKey >= range.start.slice(0, 7) && cellKey <= range.end.slice(0, 7)) {
      return cellKey
    }
    return null
  }, [cellSelection.selection, range])

  // The hotspot layer of the map: the accepted area and the applied range (raw detections),
  // narrowed to the selected month while a Calendar cell is selected (requirement 15.27).
  const mapLayerRequest = useMemo<MapLayerRequest | null>(
    () =>
      range === null || !restored
        ? null
        : {
            geometry: areaGeometry,
            start: range.start,
            end: range.end,
            ...(selectedMonthKey === null ? {} : { month: selectedMonthKey }),
          },
    [range, areaGeometry, restored, selectedMonthKey],
  )

  if (
    isDataUnavailable(health.error) ||
    isDataUnavailable(meta.error) ||
    isDataUnavailable(calendar.error)
  ) {
    return (
      <DataUnavailable
        onRetry={() => {
          void health.refetch()
          void meta.refetch()
        }}
      />
    )
  }

  const regionName = metaData?.name ?? REGION_LABEL
  const areaBbox = areaGeometry === null ? null : geometryBbox(areaGeometry)
  const areaLabel = areaBbox === null ? regionName : `your selected area (${formatBbox5(areaBbox)})`

  let loadError: { error: unknown; onRetry: () => void } | null = null
  if (meta.isError && metaData === undefined) {
    loadError = {
      error: meta.error,
      onRetry: () => {
        void meta.refetch()
      },
    }
  } else if (calendar.isError && !baselineRejected) {
    loadError = {
      error: calendar.error,
      onRetry: () => {
        void calendar.refetch()
      },
    }
  }

  const yearBounds =
    metaData === undefined
      ? null
      : completeYearBounds(metaData.record_start, metaData.latest_complete_month)
  const statsInStep = stats.isPlaceholderData === calendar.isPlaceholderData
  const statsSlot: StatsSlot = {
    data: statsInStep ? stats.data?.result : undefined,
    isError: stats.isError,
    error: stats.error,
    onRetry: () => {
      void stats.refetch()
    },
  }

  return (
    <AppShell
      latestMonth={metaData?.latest_month ?? null}
      latestMonthIncomplete={metaData?.latest_month_incomplete ?? false}
      controls={
        <div className="flex flex-col gap-4">
          {notice !== null && (
            <p role="note" className="text-sm" data-testid="url-notice">
              {notice}
            </p>
          )}
          <AreaPanel
            selection={selection}
            regionExtent={regionExtent}
            regionName={regionName}
            exampleAreas={metaData?.example_areas}
          />
          {metaData !== undefined && range !== null && (
            <DateRangePanel
              firstDate={metaData.first_date}
              latestMonth={metaData.latest_month}
              latestDetectionDate={metaData.latest_detection_local_date}
              value={range}
              onApply={setApplied}
            />
          )}
          {metaData !== undefined && range !== null && (
            <CompareControls
              compare={compare}
              primaryRange={range}
              onCompareChange={setCompareChoice}
              renderAreaSelector={() => (
                <div className="flex flex-col gap-2">
                  <AreaPanel
                    selection={selection2}
                    regionExtent={regionExtent}
                    regionName={regionName}
                    exampleAreas={metaData.example_areas}
                  />
                  <AreaMessages selection={selection2} />
                </div>
              )}
              renderDateRangeSelector={(value, onRangeChange) => (
                <DateRangePanel
                  firstDate={metaData.first_date}
                  latestMonth={metaData.latest_month}
                  latestDetectionDate={metaData.latest_detection_local_date}
                  value={value}
                  onApply={onRangeChange}
                />
              )}
            />
          )}
          {yearBounds !== null && (
            <BaselinePanel
              bounds={yearBounds}
              value={baseline}
              onApply={baselineSelection.apply}
              serverError={baselineSelection.error}
            />
          )}
          {/* Area: the accepted Selection_Area. Dates: the exact applied range. */}
          <DownloadsMenu request={hotspotRequest} />
          <CopyLinkButton state={currentState} search={initialSearch} />
        </div>
      }
      map={
        <MapView
          extent={regionExtent}
          regionName={regionName}
          selection={selection}
          hotspots={mapLayerRequest}
        />
      }
      results={
        compare.mode !== 'none' ? (
          <ComparisonResults
            compare={compare}
            view={view}
            onViewChange={setView}
            first={calendar}
            second={calendar2}
            meta={metaData}
            areaLabel={areaLabel}
            areaLabel2={
              areaGeometry2 === null
                ? regionName
                : `your second area (${formatBbox5(geometryBbox(areaGeometry2) ?? regionExtent)})`
            }
          />
        ) : (
          <ResultsPanel
            status={status}
            loadError={loadError}
            calendar={calendarData}
            model={model}
            stats={statsSlot}
            areaLabel={areaLabel}
            geometry={areaGeometry}
            baselineYears={baseline}
            baselineText={baselineLabel(baseline)}
            view={view}
            onViewChange={setView}
            selectedMonth={selectedMonthKey}
            onSelectMonth={(key) => {
              const parsed = parseCellId(key)
              if (parsed !== null) {
                // Toggle selection: if already selected, clear; otherwise select
                if (
                  cellSelection.selection !== null &&
                  cellSelection.selection.year === parsed.year &&
                  cellSelection.selection.month === parsed.month
                ) {
                  cellSelection.clearSelection()
                } else {
                  cellSelection.selectCell(parsed.year, parsed.month)
                }
              }
            }}
            onClearMonth={cellSelection.clearSelection}
            tab={tab}
            onTabChange={setTab}
          />
        )
      }
    />
  )
}

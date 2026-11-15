// Comparison view with two panels side by side (requirements 19.1, 19.4, 19.5).
// Shows two areas or two periods with unified binning scale.
import type { CalendarOut } from '@/lib/api'
import type { CalendarView, CalendarOptions, CalendarModel } from '@/lib/binning'
import type { UrlCompare } from '@/lib/urlState'
import type { DateRange } from '@/lib/dates'
import { buildUnifiedCalendarModels } from '@/lib/binning.unified'
import { normalizeCalendarResult, normalizedUnit, regularUnit } from '@/lib/normalize'
import { CalendarGrid } from '@/features/calendar/CalendarGrid'
import { CalendarLegend } from '@/features/calendar/CalendarLegend'

export type CompareViewProps = {
  /** Primary calendar data */
  result1: CalendarOut
  /** Secondary calendar data (for area2 or period2) */
  result2: CalendarOut
  /** Comparison configuration */
  compare: UrlCompare
  /** Current calendar view (counts, anomaly, diff) */
  view: CalendarView
  /** Primary date range */
  range1: DateRange
  /** Secondary date range (only differs in period mode) */
  range2: DateRange
  /** Area in km² for first selection (for per-area normalization) */
  area1_km2?: number
  /** Area in km² for second selection (for per-area normalization) */
  area2_km2?: number
  /** Calendar options for first panel */
  options1?: CalendarOptions
  /** Calendar options for second panel */
  options2?: CalendarOptions
  /** Label for first panel */
  label1?: string
  /** Label for second panel */
  label2?: string
  className?: string
}

/**
 * Comparison view showing two panels side by side.
 *
 * Displays either:
 * - Two different areas (area comparison mode)
 * - Two different time periods (period comparison mode)
 *
 * Both panels share a unified colour scale computed from the union of both datasets,
 * and a single shared legend, ensuring visual comparability.
 *
 * In area comparison mode with perArea=true, counts are normalized to per-1000 km²
 * using geodesic area calculation.
 */
export function CompareView({
  result1,
  result2,
  compare,
  view,
  range1,
  range2,
  area1_km2,
  area2_km2,
  options1,
  options2,
  label1 = 'Area 1',
  label2 = 'Area 2',
  className = '',
}: CompareViewProps) {
  // Per-1000 km² needs the area of both selections from the API. Without both, nothing is
  // normalized and a note says so (counts are never silently shown in the wrong unit).
  const wantsPerArea = compare.mode === 'area' && compare.perArea
  const normalizeData =
    wantsPerArea &&
    area1_km2 !== undefined &&
    area1_km2 > 0 &&
    area2_km2 !== undefined &&
    area2_km2 > 0
  const perAreaUnavailable = wantsPerArea && !normalizeData
  const processedResult1 = normalizeData ? normalizeCalendarResult(result1, area1_km2) : result1
  const processedResult2 = normalizeData ? normalizeCalendarResult(result2, area2_km2) : result2

  // Build unified models with shared binning scale
  const { model1, model2, hasData } = buildUnifiedCalendarModels({
    result1: processedResult1,
    result2: processedResult2,
    view,
    options1: options1 ?? { range: range1 },
    options2: options2 ?? { range: range2 },
  })

  const unit = normalizeData ? normalizedUnit() : regularUnit()
  // Both models share one set of edges, so one legend serves both panels.
  const legendModel = normalizeData && model1.view === 'counts' ? { ...model1, unit } : model1

  if (!hasData) {
    return (
      <div className={className}>
        <div className="flex h-64 items-center justify-center text-muted-foreground">
          No data available for comparison
        </div>
      </div>
    )
  }

  return (
    <div className={className}>
      <div className="space-y-6">
        {/* Shared legend at the top */}
        <div className="border-b pb-4" data-testid="compare-legend">
          <CalendarLegend
            model={legendModel}
            scaleText="Colours are set from the cells of both panels together, so the same colour means the same value in both."
          />
          {perAreaUnavailable && (
            <p className="mt-2 text-xs text-muted-foreground" role="note">
              The area of one or both selections is not available, so counts are shown in{' '}
              {regularUnit()}, not per 1000 km².
            </p>
          )}
          {normalizeData && (
            <p className="mt-2 text-xs text-muted-foreground">
              Counts shown as per 1000 km² for fair comparison of differently sized areas.
            </p>
          )}
        </div>

        {/* Two panels side by side */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Panel 1 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">{label1}</h3>
              {area1_km2 !== undefined && (
                <span className="text-xs text-muted-foreground">{area1_km2.toFixed(0)} km²</span>
              )}
            </div>
            <CalendarGrid model={model1} />
            <div className="text-xs text-muted-foreground">
              Total: {model1.total.toFixed(1)} {unit}
            </div>
          </div>

          {/* Panel 2 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">{label2}</h3>
              {area2_km2 !== undefined && (
                <span className="text-xs text-muted-foreground">{area2_km2.toFixed(0)} km²</span>
              )}
            </div>
            <CalendarGrid model={model2} />
            <div className="text-xs text-muted-foreground">
              Total: {model2.total.toFixed(1)} {unit}
            </div>
          </div>
        </div>

        {/* Comparison summary */}
        <div className="border-t pt-4">
          <CompareSummary
            model1={model1}
            model2={model2}
            label1={label1}
            label2={label2}
            unit={unit}
          />
        </div>
      </div>
    </div>
  )
}

type CompareSummaryProps = {
  model1: CalendarModel
  model2: CalendarModel
  label1: string
  label2: string
  unit: string
}

/**
 * Summary statistics comparing the two panels.
 */
function CompareSummary({ model1, model2, label1, label2, unit }: CompareSummaryProps) {
  const diff = model1.total - model2.total
  const percentDiff = model2.total > 0 ? (diff / model2.total) * 100 : null

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium">Comparison</h4>
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <span className="text-muted-foreground">{label1} total:</span>{' '}
          <span className="font-medium">{model1.total.toFixed(1)}</span> {unit}
        </div>
        <div>
          <span className="text-muted-foreground">{label2} total:</span>{' '}
          <span className="font-medium">{model2.total.toFixed(1)}</span> {unit}
        </div>
      </div>
      <div className="text-sm">
        <span className="text-muted-foreground">Difference:</span>{' '}
        <span className="font-medium">
          {diff >= 0 ? '+' : ''}
          {diff.toFixed(1)}
        </span>{' '}
        {unit}
        {percentDiff !== null && (
          <span className="text-muted-foreground">
            {' '}
            ({diff >= 0 ? '+' : ''}
            {percentDiff.toFixed(1)}%)
          </span>
        )}
      </div>
    </div>
  )
}

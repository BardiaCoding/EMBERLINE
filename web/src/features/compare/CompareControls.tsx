// Comparison mode controls (requirements 19.1, 19.4, 19.5; design.md section 11.2).
// Lets the user select between no comparison, area comparison, or period comparison.
// Updates URL state via the compare parameters.
import { useState } from 'react'
import type { UrlCompare, UrlArea } from '@/lib/urlState'
import type { DateRange } from '@/lib/dates'

type CompareModeType = 'none' | 'area' | 'period'

export type CompareControlsProps = {
  /** Current comparison state from URL */
  compare: UrlCompare
  /** Primary date range from main app state */
  primaryRange: DateRange
  /** Update comparison state (triggers URL update) */
  onCompareChange: (compare: UrlCompare) => void
  /** Renders the area selection UI for the second area */
  renderAreaSelector?: (onAreaChange: (area: UrlArea) => void) => React.ReactNode
  /** Renders the date range selector for the second period */
  renderDateRangeSelector?: (
    range: DateRange,
    onRangeChange: (range: DateRange) => void,
  ) => React.ReactNode
  className?: string
}

/**
 * Comparison mode controls panel.
 *
 * Modes:
 * - None: single view (default)
 * - Area: compare two different areas side by side
 * - Period: compare two different time periods side by side
 *
 * Area comparison includes a per-1000 km² toggle for normalization.
 */
export function CompareControls({
  compare,
  primaryRange,
  onCompareChange,
  renderAreaSelector,
  renderDateRangeSelector,
  className = '',
}: CompareControlsProps) {
  const mode: CompareModeType = compare.mode
  const [localMode, setLocalMode] = useState<CompareModeType>(mode)

  const handleModeChange = (newMode: CompareModeType) => {
    setLocalMode(newMode)
    if (newMode === 'none') {
      onCompareChange({ mode: 'none' })
    } else if (newMode === 'area') {
      onCompareChange({
        mode: 'area',
        area2: { kind: 'region' },
        perArea: false,
      })
    } else {
      onCompareChange({
        mode: 'period',
        start2: primaryRange.start,
        end2: primaryRange.end,
      })
    }
  }

  const handleArea2Change = (area2: UrlArea) => {
    if (compare.mode === 'area') {
      onCompareChange({ ...compare, area2 })
    }
  }

  const handlePerAreaToggle = (checked: boolean) => {
    if (compare.mode === 'area') {
      onCompareChange({ ...compare, perArea: checked })
    }
  }

  const handlePeriod2Change = (range2: DateRange) => {
    if (compare.mode === 'period') {
      onCompareChange({
        mode: 'period',
        start2: range2.start,
        end2: range2.end,
      })
    }
  }

  return (
    <div className={className}>
      <div className="space-y-4">
        <div>
          <label className="mb-2 block text-sm font-medium">Comparison Mode</label>
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <input
                type="radio"
                id="compare-none"
                name="compare-mode"
                value="none"
                checked={localMode === 'none'}
                onChange={(e) => {
                  handleModeChange(e.target.value as CompareModeType)
                }}
                className="cursor-pointer"
              />
              <label htmlFor="compare-none" className="cursor-pointer font-normal">
                None (single view)
              </label>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="radio"
                id="compare-area"
                name="compare-mode"
                value="area"
                checked={localMode === 'area'}
                onChange={(e) => {
                  handleModeChange(e.target.value as CompareModeType)
                }}
                className="cursor-pointer"
              />
              <label htmlFor="compare-area" className="cursor-pointer font-normal">
                Compare Areas
              </label>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="radio"
                id="compare-period"
                name="compare-mode"
                value="period"
                checked={localMode === 'period'}
                onChange={(e) => {
                  handleModeChange(e.target.value as CompareModeType)
                }}
                className="cursor-pointer"
              />
              <label htmlFor="compare-period" className="cursor-pointer font-normal">
                Compare Periods
              </label>
            </div>
          </div>
        </div>

        {localMode === 'area' && (
          <div className="space-y-4 border-t pt-2">
            <div>
              <label className="mb-2 block text-sm font-medium">Second Area</label>
              <div className="mt-2">
                {renderAreaSelector ? (
                  renderAreaSelector(handleArea2Change)
                ) : (
                  <p className="text-sm text-muted-foreground">Area selection not available</p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label htmlFor="per-area-toggle" className="cursor-pointer text-sm font-medium">
                Normalize per 1000 km²
              </label>
              <input
                type="checkbox"
                id="per-area-toggle"
                checked={compare.mode === 'area' && compare.perArea}
                onChange={(e) => {
                  handlePerAreaToggle(e.target.checked)
                }}
                aria-label="Toggle per-area normalization"
                className="cursor-pointer"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              When enabled, counts are shown as cell-days per 1000 km² based on geodesic area
              calculation, allowing fair comparison of differently sized areas.
            </p>
          </div>
        )}

        {localMode === 'period' && (
          <div className="space-y-2 border-t pt-2">
            <label className="mb-2 block text-sm font-medium">Second Period</label>
            <div className="mt-2">
              {renderDateRangeSelector && compare.mode === 'period' ? (
                renderDateRangeSelector(
                  { start: compare.start2, end: compare.end2 },
                  handlePeriod2Change,
                )
              ) : (
                <p className="text-sm text-muted-foreground">Date range selection not available</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

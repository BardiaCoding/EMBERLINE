import * as Tooltip from '@radix-ui/react-tooltip'
import { useId, useRef, useState } from 'react'
import {
  cellAriaLabel,
  compactCount,
  describeCell,
  monthAbbreviation,
  type CalendarCell,
  type CalendarModel,
} from '@/lib/binning'
import { formatCount, formatMonth, MISSING, monthName, UNIT_CELL_DAYS } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ProvisionalMark, WholeMonthMark } from './CalendarMarkers'
import { CellDetails } from './CellDetails'
import {
  HATCH_STYLE,
  LATEST_RING_CLASS,
  PROVISIONAL_BORDER_CLASS,
  REGION_SIZE_CLASS,
  ROW_HEIGHT,
  SWITCHOVER_CLASS,
  toneClass,
} from './calendarStyles'

type CalendarGridProps = {
  model: CalendarModel
  /** Key (`YYYY-MM`) of the cell that holds the roving tab stop. Defaults to the latest month with data. */
  activeKey?: string
  /** Extra sentence for assistive technology, for example the area name and the Date_Range. */
  description?: string
  /** Key (`YYYY-MM`) of the month the map is filtered to, or null for none. */
  selectedKey?: string | null
  /** Called with the key of a clicked cell that has data. The parent toggles the filter. */
  onSelect?: (key: string) => void
  /** Called when Escape is pressed to clear the selection. */
  onClearSelection?: () => void
  className?: string
}

/** A pointer that moves this far (px) between down and up is a drag, not a tap or click. */
const TAP_MOVE_LIMIT_PX = 8

// Year column, 12 month columns (at least 36 px wide, cells at least 24 x 24 px), year total.
const COLUMNS = 'grid-cols-[4.5rem_repeat(12,minmax(2.25rem,1fr))_4rem]'
const ROW = cn('grid', COLUMNS)
// Sticky header height and year column width, so a focused cell is not hidden behind them.
const SCROLL_MARGIN = { scrollMarginTop: '2rem', scrollMarginLeft: '4.5rem' } as const

function defaultActiveKey(model: CalendarModel): string | null {
  for (const row of model.rows) {
    for (let i = row.cells.length - 1; i >= 0; i -= 1) {
      const cell = row.cells[i]
      if (cell !== undefined && cell.state !== 'no_data') return cell.key
    }
  }
  return null
}

const GRID_LABEL: Record<CalendarModel['view'], string> = {
  counts: 'Harmonized monthly counts by year and month',
  anomaly: 'Percent difference from the baseline median by year and month',
  diff: 'Month-to-month difference of the harmonized count by year and month',
}

function Cell({
  model,
  cell,
  active,
  selected,
  onFocus,
  onSelect,
}: {
  model: CalendarModel
  cell: CalendarCell
  active: boolean
  selected: boolean
  onFocus: () => void
  onSelect?: () => void
}) {
  const noData = cell.hatched
  const filled = cell.colour !== null
  const description = describeCell(model, cell)
  const face = cell.face

  // One gesture = pointerdown, pointerup and (for mouse, touch and pen alike) a click.
  // Touch and pen select on `pointerup` when the pointer moved less than 8 px; the click that
  // follows is then ignored, so one tap is one selection (requirements 15.24, 15.27). A mouse
  // selects on `click`, unless the pointer moved 8 px or more between down and up (a drag).
  const gesture = useRef<{ x: number; y: number; moved: boolean; handled: boolean } | null>(null)

  const handlePointerDown = (e: React.PointerEvent) => {
    if (noData) return
    gesture.current = { x: e.clientX, y: e.clientY, moved: false, handled: false }
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    const g = gesture.current
    if (noData || onSelect === undefined || g === null) return
    g.moved = Math.hypot(e.clientX - g.x, e.clientY - g.y) >= TAP_MOVE_LIMIT_PX
    if (!g.moved && e.pointerType !== 'mouse') {
      g.handled = true
      onSelect()
    }
  }

  const handlePointerCancel = () => {
    gesture.current = null
  }

  const handleClick = () => {
    const g = gesture.current
    gesture.current = null
    // A click that follows a handled tap, or a drag, is not a second selection.
    if (g !== null && (g.handled || g.moved)) return
    onSelect?.()
  }

  // Touch and pen show no hover tooltip: Radix skips its own handler when this one calls
  // `preventDefault`. It already ignores touch, so this adds pen. Keyboard focus still opens it.
  const handlePointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' || e.pointerType === 'pen') e.preventDefault()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (noData) return
    // Enter or Space: select the cell (task 28.9)
    if ((e.key === 'Enter' || e.key === ' ') && onSelect !== undefined) {
      e.preventDefault()
      onSelect()
    }
  }

  const gridCell = (
    <div
      role="gridcell"
      tabIndex={active ? 0 : -1}
      aria-label={cellAriaLabel(cell, model.view)}
      data-key={cell.key}
      data-state={cell.state}
      data-class={cell.classIndex ?? undefined}
      data-provisional={cell.provisional || undefined}
      data-latest={cell.latest || undefined}
      data-whole-month={cell.wholeMonth || undefined}
      data-switchover={cell.switchover || undefined}
      data-selected={selected || undefined}
      aria-selected={onSelect === undefined || noData ? undefined : selected}
      onFocus={onFocus}
      onClick={noData || onSelect === undefined ? undefined : handleClick}
      onPointerMove={handlePointerMove}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onKeyDown={handleKeyDown}
      style={{
        ...SCROLL_MARGIN,
        ...(noData ? HATCH_STYLE : filled ? { backgroundColor: cell.colour ?? undefined } : null),
      }}
      className={cn(
        ROW_HEIGHT,
        'relative flex min-w-6 items-center justify-center border text-xs',
        noData ? 'border-border' : 'border-transparent',
        !noData && !filled && 'bg-background',
        toneClass(cell.textTone),
        cell.provisional && PROVISIONAL_BORDER_CLASS,
        cell.latest && LATEST_RING_CLASS,
        cell.switchover && SWITCHOVER_CLASS,
        onSelect !== undefined && !noData && 'cursor-pointer',
        selected && 'outline-2 -outline-offset-2 outline-foreground outline-dashed',
      )}
    >
      {face === null ? null : <span>{face}</span>}
      {cell.wholeMonth ? <WholeMonthMark /> : null}
      {cell.provisional ? <ProvisionalMark /> : null}
    </div>
  )
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{gridCell}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="top"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 max-w-xs rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
        >
          <p className="mb-1 text-sm font-medium">{description.title}</p>
          <CellDetails description={description} />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

/**
 * The Calendar heatmap as an ARIA grid inside its own scroll region (requirements 15.1, 15.6,
 * 15.7, 15.12, 27.7, 26.11). Rows are years, newest first; columns are January to December, a
 * year total and, in the last row, the Baseline median of each calendar month. Month headers
 * and the year column stay fixed while the region scrolls. Cells are at least 24 x 24 px and
 * carry a roving tab index (one tab stop); arrow keys, Enter and Escape are added by the
 * keyboard-interaction task.
 */
export function CalendarGrid({
  model,
  activeKey,
  description,
  selectedKey = null,
  onSelect,
  onClearSelection,
  className,
}: CalendarGridProps) {
  const summaryId = useId()
  const [focused, setFocused] = useState<string | null>(null)
  const active = focused ?? activeKey ?? defaultActiveKey(model)
  const peak = model.peak
  const summary =
    `Variable: ${model.variable}. Unit: ${model.unit}. Time: ${model.timeConvention}. ` +
    `Total displayed: ${formatCount(model.total)} ${UNIT_CELL_DAYS}. ` +
    (peak === null
      ? 'No month with burning activity is displayed. '
      : `Highest month: ${formatMonth(peak.year, peak.month)}, ${formatCount(peak.value)} ${UNIT_CELL_DAYS}. `) +
    (description ?? '')

  // Escape key clears the selection (task 28.9).
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && onClearSelection !== undefined && selectedKey !== null) {
      e.preventDefault()
      onClearSelection()
    }
  }

  return (
    <div
      role="region"
      aria-label="Burning activity calendar"
      aria-describedby={summaryId}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className={cn('overflow-auto rounded-md border border-border', REGION_SIZE_CLASS, className)}
    >
      <Tooltip.Provider delayDuration={200} skipDelayDuration={100}>
        <p id={summaryId} className="sr-only">
          {summary}
        </p>
        <div
          role="grid"
          aria-label={GRID_LABEL[model.view]}
          aria-rowcount={model.rows.length + 2}
          aria-colcount={14}
          className="w-max min-w-full"
        >
          <div
            role="row"
            aria-rowindex={1}
            className={cn(ROW, 'sticky top-0 z-20 bg-background text-xs')}
          >
            <div
              role="columnheader"
              className={cn(
                ROW_HEIGHT,
                'sticky left-0 z-30 flex items-center bg-background px-1 font-medium',
              )}
            >
              Year
            </div>
            {Array.from({ length: 12 }, (_, i) => (
              <div
                key={i}
                role="columnheader"
                aria-label={monthName(i + 1)}
                className={cn(ROW_HEIGHT, 'flex items-center justify-center font-medium')}
              >
                {monthAbbreviation(i + 1)}
              </div>
            ))}
            <div
              role="columnheader"
              className={cn(ROW_HEIGHT, 'flex items-center justify-center px-1 font-medium')}
            >
              Total
            </div>
          </div>

          {model.rows.map((row, r) => (
            <div key={row.year} role="row" aria-rowindex={r + 2} className={ROW}>
              <div
                role="rowheader"
                className={cn(
                  ROW_HEIGHT,
                  'sticky left-0 z-10 flex items-center bg-background px-1 text-xs font-medium',
                )}
              >
                {row.year}
              </div>
              {row.cells.map((cell) => (
                <Cell
                  key={cell.key}
                  model={model}
                  cell={cell}
                  active={cell.key === active}
                  selected={cell.key === selectedKey}
                  onSelect={
                    onSelect === undefined
                      ? undefined
                      : () => {
                          onSelect(cell.key)
                        }
                  }
                  onFocus={() => {
                    setFocused(cell.key)
                  }}
                />
              ))}
              <div
                role="gridcell"
                aria-label={
                  row.total === null
                    ? `${row.year} total: no data`
                    : `${row.year} total: ${formatCount(row.total)} ${UNIT_CELL_DAYS}${
                        row.totalProvisional ? ', includes the provisional month' : ''
                      }`
                }
                className={cn(
                  ROW_HEIGHT,
                  'flex items-center justify-center px-1 text-xs font-medium',
                )}
              >
                {row.total === null ? MISSING : compactCount(row.total)}
                {row.totalProvisional ? (
                  <span
                    aria-hidden="true"
                    data-marker="provisional-total"
                    className="ml-1 inline-block size-1.5 rounded-full bg-current"
                  />
                ) : null}
              </div>
            </div>
          ))}

          <div
            role="row"
            aria-rowindex={model.rows.length + 2}
            className={cn(ROW, 'border-t border-border')}
          >
            <div
              role="rowheader"
              className={cn(
                ROW_HEIGHT,
                'sticky left-0 z-10 flex items-center bg-background px-1 text-[10px] leading-tight font-medium',
              )}
            >
              Baseline median
            </div>
            {model.baselineMedians.map((median, i) => (
              <div
                key={i}
                role="gridcell"
                aria-label={`Baseline median for ${monthName(i + 1)}: ${
                  median === null ? 'not available' : `${formatCount(median)} ${UNIT_CELL_DAYS}`
                }`}
                className={cn(
                  ROW_HEIGHT,
                  'flex items-center justify-center text-xs text-muted-foreground',
                )}
              >
                {median === null ? MISSING : compactCount(median)}
              </div>
            ))}
            <div
              role="gridcell"
              aria-label="No baseline total"
              className={cn(
                ROW_HEIGHT,
                'flex items-center justify-center text-xs text-muted-foreground',
              )}
            >
              {MISSING}
            </div>
          </div>
        </div>
      </Tooltip.Provider>
    </div>
  )
}

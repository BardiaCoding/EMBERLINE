import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { isApiError } from '@/lib/api'
import {
  exportChartFile,
  type ExportDeps,
  type ExportFormat,
  type ExportMeta,
  type ExportTarget,
} from '@/lib/exportChart'
import { cn } from '@/lib/utils'
import { ChartFrameContext } from './chartFrameContext'

export type ChartFrameState = 'ready' | 'loading' | 'empty' | 'error'

type ChartFrameProps = {
  /** Chart title, the heading of the frame. */
  title: string
  /** Unit and time convention, shown under the title (requirement 27.3). */
  unit: string
  /**
   * Text label for assistive technology: variable, unit, area, Date_Range, total harmonized
   * count and the month with the highest count (requirement 27.3). Visually hidden.
   */
  summary: string
  /** Default `ready`. */
  state?: ChartFrameState
  /** Message of the `empty` state. Default: the area and period hold no detected burning activity. */
  emptyMessage?: string
  /** The error of the `error` state, shown with its message when it is an `ApiError`. */
  error?: unknown
  /** Retry action of the `error` state. */
  onRetry?: () => void
  /** The data table alternative with the same values. Enables the "View table" link. */
  table?: ReactNode
  /** Slot for a custom download menu. Ignored when `exportSource` is set. */
  exportMenu?: ReactNode
  /** What the "Download" menu (PNG and SVG) exports. Enables the menu in the `ready` state. */
  exportSource?: { target: ExportTarget; meta: ExportMeta; deps?: ExportDeps }
  /** Controls that belong to the chart, for example the year selector. */
  controls?: ReactNode
  /** The chart. Shown in the `ready` state. */
  children?: ReactNode
  className?: string
  testId?: string
}

export const DEFAULT_EMPTY_CHART_MESSAGE =
  'This area and period contain no detected burning activity.'

/**
 * Shared frame of every chart (design.md section 11.1): title, unit subtitle, a text summary
 * for assistive technology, a "View table" link to the data table alternative, a slot for the
 * PNG and SVG menu, and loading, empty and error states. The chart itself is the children.
 * An empty state is not an error (requirement 16.9).
 */
export function ChartFrame({
  title,
  unit,
  summary,
  state = 'ready',
  emptyMessage = DEFAULT_EMPTY_CHART_MESSAGE,
  error,
  onRetry,
  table,
  exportMenu,
  exportSource,
  controls,
  children,
  className,
  testId,
}: ChartFrameProps) {
  const uid = useId()
  const titleId = `${uid}-title`
  const summaryId = `${uid}-summary`
  const tableId = `${uid}-table`
  const [tableOpen, setTableOpen] = useState(false)
  const tableRef = useRef<HTMLDivElement>(null)
  const focusTable = useRef(false)

  // The link moves focus to the table once it is shown, so keyboard users land on it.
  useEffect(() => {
    if (tableOpen && focusTable.current) {
      focusTable.current = false
      tableRef.current?.focus()
    }
  }, [tableOpen])

  const hasTable = table !== undefined && state === 'ready'
  const detail = isApiError(error) ? error.message : null

  return (
    <section
      aria-labelledby={titleId}
      className={cn('rounded-lg border border-border bg-card p-3 text-card-foreground', className)}
      data-testid={testId}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div>
          <h3 id={titleId} className="text-base font-semibold">
            {title}
          </h3>
          <p className="text-xs text-muted-foreground">{unit}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {state === 'ready' ? (
            exportSource === undefined ? (
              exportMenu
            ) : (
              <ChartExportMenu
                target={exportSource.target}
                meta={exportSource.meta}
                deps={exportSource.deps}
              />
            )
          ) : null}
          {hasTable ? (
            <a
              href={`#${tableId}`}
              className="inline-flex min-h-6 items-center text-sm font-medium underline underline-offset-4 hover:text-primary"
              onClick={(event) => {
                event.preventDefault()
                if (tableOpen) {
                  tableRef.current?.focus()
                } else {
                  focusTable.current = true
                  setTableOpen(true)
                }
              }}
            >
              View table
            </a>
          ) : null}
        </div>
      </div>
      <p id={summaryId} className="sr-only">
        {summary}
      </p>
      {state === 'ready' && controls !== undefined ? <div className="mt-2">{controls}</div> : null}
      <div className="mt-2">
        {state === 'loading' ? (
          <div
            className="flex items-center gap-3 py-8 text-sm text-muted-foreground"
            data-testid="chart-loading"
          >
            <span
              aria-hidden="true"
              className="size-5 shrink-0 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent motion-reduce:animate-none"
            />
            <span>Loading chart…</span>
          </div>
        ) : null}
        {state === 'empty' ? (
          <p className="py-6 text-sm" data-testid="chart-empty">
            {emptyMessage}
          </p>
        ) : null}
        {state === 'error' ? (
          <div className="py-3 text-sm" role="alert" data-testid="chart-error">
            <p className="font-semibold text-destructive">This chart could not be loaded.</p>
            {detail !== null ? <p className="mt-1">{detail}</p> : null}
            {onRetry !== undefined ? (
              <Button type="button" className="mt-2" variant="outline" onClick={onRetry}>
                Retry
              </Button>
            ) : null}
          </div>
        ) : null}
        {state === 'ready' ? (
          <ChartFrameContext.Provider value={{ titleId, summaryId }}>
            {children}
          </ChartFrameContext.Provider>
        ) : null}
      </div>
      {hasTable && tableOpen ? (
        <div className="mt-3">
          <div
            id={tableId}
            ref={tableRef}
            role="region"
            aria-label={`${title}, data table`}
            tabIndex={0}
            className="overflow-x-auto"
          >
            {table}
          </div>
          <Button
            type="button"
            className="mt-2"
            variant="outline"
            onClick={() => {
              setTableOpen(false)
            }}
          >
            Hide table
          </Button>
        </div>
      ) : null}
    </section>
  )
}

const FORMATS: { format: ExportFormat; label: string }[] = [
  { format: 'png', label: 'PNG image' },
  { format: 'svg', label: 'SVG image' },
]

type ChartExportMenuProps = {
  target: ExportTarget
  meta: ExportMeta
  deps?: ExportDeps
}

/**
 * "Download" button with a menu of PNG and SVG (requirement 18.2). Keyboard: Enter, Space or
 * Arrow Down opens it and focuses the first item; Arrow Up and Down, Home and End move; Escape
 * closes and returns focus to the button; Tab closes. A failed export shows an alert that names
 * the file, delivers nothing and leaves the query and view unchanged (requirement 18.6).
 */
export function ChartExportMenu({ target, meta, deps }: ChartExportMenuProps) {
  const uid = useId()
  const menuId = `${uid}-menu`
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<ExportFormat | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const focusIndex = useRef(0)

  useEffect(() => {
    if (open) itemRefs.current[focusIndex.current]?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  const openAt = (index: number): void => {
    focusIndex.current = index
    setOpen(true)
  }

  const run = (format: ExportFormat): void => {
    setOpen(false)
    buttonRef.current?.focus()
    setFailure(null)
    setBusy(format)
    exportChartFile(target, format, meta, deps)
      .catch((error: unknown) => {
        setFailure(
          error instanceof Error
            ? error.message
            : `The ${format.toUpperCase()} file could not be created. Your area and dates are unchanged.`,
        )
      })
      .finally(() => {
        setBusy(null)
      })
  }

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const items = itemRefs.current
    const current = items.findIndex((el) => el === document.activeElement)
    let next: number | null = null
    switch (event.key) {
      case 'ArrowDown':
        next = (current + 1) % FORMATS.length
        break
      case 'ArrowUp':
        next = (current <= 0 ? FORMATS.length : current) - 1
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = FORMATS.length - 1
        break
      case 'Escape':
        event.preventDefault()
        setOpen(false)
        buttonRef.current?.focus()
        return
      case 'Tab':
        setOpen(false)
        return
      default:
        return
    }
    event.preventDefault()
    items[next]?.focus()
  }

  return (
    <div ref={rootRef} className="relative">
      <Button
        ref={buttonRef}
        type="button"
        variant="outline"
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={busy !== null}
        onClick={() => {
          if (open) setOpen(false)
          else openAt(0)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            openAt(0)
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            openAt(FORMATS.length - 1)
          }
        }}
      >
        {busy === null ? 'Download chart' : 'Preparing file…'}
      </Button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={`Download ${meta.title}`}
          className="absolute right-0 z-20 mt-1 min-w-36 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
          onKeyDown={onMenuKeyDown}
        >
          {FORMATS.map(({ format, label }, i) => (
            <button
              key={format}
              ref={(el) => {
                itemRefs.current[i] = el
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="block min-h-6 w-full rounded-sm px-2 py-1 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-2"
              onClick={() => {
                run(format)
              }}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {failure !== null ? (
        <p
          role="alert"
          className="mt-1 max-w-64 text-xs text-destructive"
          data-testid="export-error"
        >
          {failure}
        </p>
      ) : null}
    </div>
  )
}

import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { CalendarCell, CalendarModel, CellDescription } from '@/lib/binning'
import { describeCell } from '@/lib/binning'
import { InfoControl } from '@/components/InfoControl'
import { cn } from '@/lib/utils'

type DetailPanelProps = {
  /** The calendar model (needed to compute the description). */
  model: CalendarModel
  /** The selected cell to show details for. */
  cell: CalendarCell
  /** Whether the panel is open. */
  isOpen: boolean
  /** Called when the user closes the panel. */
  onClose: () => void
  className?: string
}

/**
 * Non-modal dialog that shows detailed information about a selected calendar month
 * (requirements 15.5, 15.21, 15.24, 15.25, 15.26, 15.27, 27.9).
 *
 * Shows the same content as the calendar cell tooltip (from shared `describeCell` function)
 * plus six InfoControl components for term help.
 *
 * - Non-modal role="dialog" with heading "{Month} {Year}"
 * - "Close details" button, no focus trap (non-modal)
 * - Beside the results column from 768 px (DEFAULT (confirm)), bottom sheet below 768 px
 * - Shows provisional and partial month markers
 */
export function DetailPanel({ model, cell, isOpen, onClose, className }: DetailPanelProps) {
  const description: CellDescription = describeCell(model, cell)

  // Map field keys to help keys and term names for InfoControl
  const infoControls: Array<{
    fieldKey: string
    helpKey:
      | 'harmonized_count'
      | 'uncertainty_interval'
      | 'baseline_median'
      | 'anomaly'
      | 'z_score'
      | 'percentile_rank'
    term: string
  }> = [
    { fieldKey: 'harmonized', helpKey: 'harmonized_count', term: 'harmonized count' },
    { fieldKey: 'interval', helpKey: 'uncertainty_interval', term: 'uncertainty interval' },
    { fieldKey: 'baseline_median', helpKey: 'baseline_median', term: 'baseline median' },
    { fieldKey: 'absolute', helpKey: 'anomaly', term: 'anomaly' },
    { fieldKey: 'zscore', helpKey: 'z_score', term: 'z-score' },
    { fieldKey: 'percentile_rank', helpKey: 'percentile_rank', term: 'percentile rank' },
  ]

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      modal={false}
    >
      <Dialog.Portal>
        <Dialog.Content
          aria-labelledby="detail-panel-title"
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => {
            e.preventDefault()
            onClose()
          }}
          // Non-modal: a tap or click on the Calendar must not dismiss the panel. Tapping the
          // selected cell again closes it through the selection (requirement 15.25).
          onInteractOutside={(e) => {
            e.preventDefault()
          }}
          // Closing returns keyboard focus to the Calendar cell (requirement 15.26).
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            document
              .querySelector<HTMLElement>(`[role="gridcell"][data-key="${cell.key}"]`)
              ?.focus()
          }}
          className={cn(
            'fixed z-50 rounded-lg border border-border bg-background shadow-lg',
            'flex flex-col',
            // Below 768 px: bottom sheet.
            'max-md:right-0 max-md:bottom-0 max-md:left-0 max-md:max-h-[50vh] max-md:rounded-b-none',
            // 768 px and wider: beside the results column, so it does not cover the Calendar.
            // The results column is half the width from 768 px and 560 px from 1280 px.
            'md:top-20 md:right-[calc(50%+0.5rem)] md:max-h-[80vh] md:w-80',
            'xl:right-[calc(var(--results-panel-width)+0.5rem)]',
            'overflow-hidden',
            className,
          )}
        >
          {/* Header with title and close button */}
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <Dialog.Title id="detail-panel-title" className="text-lg font-semibold">
              {description.title}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close details"
                className="inline-flex size-8 items-center justify-center rounded-md hover:bg-muted"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </Dialog.Close>
          </div>

          {/* Content - scrollable */}
          <div className="flex-1 overflow-y-auto px-4 py-3">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3">
              {description.fields
                .filter((field) => field.key !== 'month')
                .map((field) => {
                  // Find if this field has an InfoControl
                  const infoControl = infoControls.find((ic) => ic.fieldKey === field.key)

                  return (
                    <div key={field.key} className="contents" data-field={field.key}>
                      <dt className="flex items-center gap-1 text-sm text-muted-foreground">
                        {field.label}
                        {infoControl && (
                          <InfoControl helpKey={infoControl.helpKey} term={infoControl.term} />
                        )}
                      </dt>
                      <dd className="text-right text-sm tabular-nums">{field.value}</dd>
                    </div>
                  )
                })}
            </dl>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

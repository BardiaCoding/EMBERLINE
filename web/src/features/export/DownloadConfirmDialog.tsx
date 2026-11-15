import * as Dialog from '@radix-ui/react-dialog'
import type { RefObject } from 'react'
import { Button } from '@/components/ui/button'
import type { HotspotEstimateOut } from '@/lib/api'
import { TIME_CONVENTION } from '@/lib/format'
import { formatApproxBytes, formatRows, overLimitMessage } from './estimateFormat'

/** What the dialog shows. The dialog is rendered only while a confirmation is open. */
export type ConfirmState =
  | { kind: 'loading' }
  | { kind: 'ready'; estimate: HotspotEstimateOut }
  | { kind: 'error'; message: string }

type DownloadConfirmDialogProps = {
  state: ConfirmState
  /** The user activated "Download" on a result that is within the limit. */
  onConfirm: () => void
  /** Cancel, Close, Escape or a click outside. Nothing is downloaded. */
  onCancel: () => void
  /** The estimate failed or timed out and the user asked for it again. */
  onRetry: () => void
  /** The control that opened the dialog. It gets keyboard focus back when the dialog closes. */
  returnFocusRef: RefObject<HTMLElement | null>
}

/**
 * Confirmation before a hotspot CSV download (requirements 17.9 to 17.13). It states the row
 * count and the approximate size, and starts nothing by itself: the parent starts the download
 * from `onConfirm`. Over the limit it shows the limit message and a close action only. A failed
 * estimate shows the error and "Retry". Radix Dialog gives the modal behaviour: focus moves into
 * the dialog, stays inside it, and returns to `returnFocusRef` when it closes;
 * Escape and an outside click cancel. The "Cancel" button keeps its place across states (its
 * label becomes "Close" over the limit), so keyboard focus does not jump when the estimate
 * arrives. The status text is a live region, so the result is announced.
 */
export function DownloadConfirmDialog({
  state,
  onConfirm,
  onCancel,
  onRetry,
  returnFocusRef,
}: DownloadConfirmDialogProps) {
  const overLimit = state.kind === 'ready' && state.estimate.over_limit
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/50" />
        <Dialog.Content
          data-testid="download-confirm"
          onCloseAutoFocus={(event) => {
            // Radix only restores focus to its own Trigger, and this dialog has none.
            event.preventDefault()
            returnFocusRef.current?.focus()
          }}
          className="fixed top-1/2 left-1/2 z-50 flex w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-lg border border-border bg-popover p-5 text-popover-foreground shadow-lg"
        >
          <Dialog.Title className="text-base font-semibold">Download hotspot CSV</Dialog.Title>
          <Dialog.Description className="text-sm text-muted-foreground">
            One row per filtered raw detection in the selected area and dates. The rows are not
            individually harmonized. Days use {TIME_CONVENTION}; <code>acq_datetime_utc</code> is
            true UTC.
          </Dialog.Description>
          <div role="status" aria-live="polite" data-testid="download-confirm-body">
            <ConfirmBody state={state} />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button key="dismiss" type="button" variant="outline" size="sm" onClick={onCancel}>
              {overLimit ? 'Close' : 'Cancel'}
            </Button>
            {state.kind === 'error' && (
              <Button type="button" size="sm" onClick={onRetry}>
                Retry
              </Button>
            )}
            {state.kind === 'ready' && !overLimit && (
              <Button type="button" size="sm" onClick={onConfirm}>
                Download
              </Button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ConfirmBody({ state }: { state: ConfirmState }) {
  switch (state.kind) {
    case 'loading':
      return <p className="text-sm">Estimating the size of the file…</p>
    case 'error':
      return (
        <div className="flex flex-col gap-1 text-sm">
          <p className="font-medium text-destructive">{state.message}</p>
          <p className="text-muted-foreground">
            Nothing was downloaded. Your area and dates are unchanged.
          </p>
        </div>
      )
    case 'ready':
      if (state.estimate.over_limit) {
        return (
          <p className="text-sm font-medium text-destructive">{overLimitMessage(state.estimate)}</p>
        )
      }
      return (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Rows</dt>
          <dd className="font-medium">{formatRows(state.estimate.rows)} detections</dd>
          <dt className="text-muted-foreground">File size</dt>
          <dd className="font-medium">
            about {formatApproxBytes(state.estimate.approx_bytes)} (approximate)
          </dd>
        </dl>
      )
  }
}

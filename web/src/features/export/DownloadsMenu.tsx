import { Download } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { isApiError, postHotspotEstimate, type HotspotExportRequest } from '@/lib/api'
import { TIME_CONVENTION } from '@/lib/format'
import { cn } from '@/lib/utils'
import { DownloadConfirmDialog, type ConfirmState } from './DownloadConfirmDialog'
import { downloadHotspotCsv } from './hotspotDownload'

type DownloadsMenuProps = {
  /**
   * Area (null geometry = full region) and the exact local dates of the applied Date_Range.
   * Null disables the control, for example while the range is not known yet.
   */
  request: HotspotExportRequest | null
}

type DownloadState =
  | { kind: 'idle' }
  | { kind: 'downloading' }
  | { kind: 'done'; filename: string }
  | { kind: 'incomplete'; filename: string }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string }

/**
 * The confirmation that is open, if any. `request` is the query the estimate was made for. The
 * download that follows a confirmation uses this same query, so the rows and size the user
 * confirmed are the ones downloaded.
 */
type Confirmation = { request: HotspotExportRequest; state: ConfirmState } | null

export const INCOMPLETE_MESSAGE =
  'Download incomplete. The file does not end with its "# rows:" line, so rows are missing. ' +
  'Do not use it. Try again, or narrow the area or the date range.'

function describe(state: DownloadState): string {
  switch (state.kind) {
    case 'idle':
      return ''
    case 'downloading':
      return 'Downloading the hotspot CSV. Large files take a while.'
    case 'done':
      return `Download finished: ${state.filename}.`
    case 'incomplete':
      return `${INCOMPLETE_MESSAGE} Saved as ${state.filename}.`
    case 'cancelled':
      return 'Download cancelled.'
    case 'error':
      return state.message
  }
}

function errorMessage(error: unknown): string {
  if (isApiError(error)) return error.message
  return 'The download failed. Try again.'
}

function estimateErrorMessage(error: unknown): string {
  const reason = isApiError(error) ? error.message : 'Try again.'
  return `The file size could not be estimated. ${reason}`
}

/**
 * Downloads control of the control panel: the hotspot CSV of the current Selection_Area and
 * Date_Range (requirement 17). The file is streamed to disk where the browser allows it. This
 * button first asks the API for the row count and approximate size and opens a confirmation
 * dialog (requirements 17.9 to 17.13). Nothing is downloaded until the user activates "Download"
 * there. The status line is a live region, so the result is announced without moving focus
 * (requirement 27.8).
 */
export function DownloadsMenu({ request }: DownloadsMenuProps) {
  const [state, setState] = useState<DownloadState>({ kind: 'idle' })
  const [confirmation, setConfirmation] = useState<Confirmation>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const controller = useRef<AbortController | null>(null)
  const estimateController = useRef<AbortController | null>(null)
  const downloading = state.kind === 'downloading'

  useEffect(
    () => () => {
      controller.current?.abort()
      estimateController.current?.abort()
    },
    [],
  )

  const start = useCallback((query: HotspotExportRequest) => {
    if (controller.current !== null) return
    const abort = new AbortController()
    controller.current = abort
    setState({ kind: 'downloading' })
    downloadHotspotCsv(query, { signal: abort.signal })
      .then((outcome) => {
        if (outcome.status === 'cancelled') setState({ kind: 'cancelled' })
        else if (outcome.status === 'incomplete')
          setState({ kind: 'incomplete', filename: outcome.filename })
        else setState({ kind: 'done', filename: outcome.filename })
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted) {
          setState({ kind: 'cancelled' })
          return
        }
        setState({ kind: 'error', message: errorMessage(error) })
      })
      .finally(() => {
        if (controller.current === abort) controller.current = null
      })
  }, [])

  /** Asks for the estimate of `query` and shows the result in the dialog. No download starts. */
  const estimate = useCallback((query: HotspotExportRequest) => {
    estimateController.current?.abort()
    const abort = new AbortController()
    estimateController.current = abort
    setConfirmation({ request: query, state: { kind: 'loading' } })
    const show = (next: ConfirmState) => {
      if (abort.signal.aborted) return
      setConfirmation((current) => (current === null ? null : { ...current, state: next }))
    }
    // postHotspotEstimate ends the request after 30 s (AbortSignal.timeout, requirement 17.13).
    postHotspotEstimate(query, { signal: abort.signal })
      .then((result) => {
        show({ kind: 'ready', estimate: result })
      })
      .catch((error: unknown) => {
        show({ kind: 'error', message: estimateErrorMessage(error) })
      })
  }, [])

  const cancelConfirmation = useCallback(() => {
    estimateController.current?.abort()
    estimateController.current = null
    setConfirmation(null)
  }, [])

  const confirmDownload = useCallback(() => {
    if (confirmation === null || confirmation.state.kind !== 'ready') return
    if (confirmation.state.estimate.over_limit) return
    const { request: query } = confirmation
    estimateController.current = null
    setConfirmation(null)
    start(query)
  }, [confirmation, start])

  const failed = state.kind === 'error' || state.kind === 'incomplete'

  return (
    <section aria-labelledby="downloads-title" className="flex flex-col gap-2">
      <h2 id="downloads-title" className="text-sm font-semibold">
        Downloads
      </h2>
      <div className="flex flex-wrap gap-2">
        <Button
          ref={triggerRef}
          type="button"
          variant="outline"
          size="sm"
          // aria-disabled keeps keyboard focus on the button while the download runs.
          aria-disabled={request === null || downloading}
          onClick={() => {
            if (request !== null && !downloading) estimate(request)
          }}
          className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
        >
          <Download aria-hidden="true" className="size-4" />
          Download hotspots (CSV)
        </Button>
        {downloading && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              controller.current?.abort()
            }}
          >
            Cancel download
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        One row per filtered raw detection, not individually harmonized. Days use {TIME_CONVENTION}.
      </p>
      <p
        role="status"
        aria-live="polite"
        data-testid="download-status"
        className={cn('text-sm', failed && 'font-medium text-destructive')}
      >
        {describe(state)}
      </p>
      {confirmation !== null && (
        <DownloadConfirmDialog
          state={confirmation.state}
          onConfirm={confirmDownload}
          onCancel={cancelConfirmation}
          returnFocusRef={triggerRef}
          onRetry={() => {
            estimate(confirmation.request)
          }}
        />
      )}
    </section>
  )
}

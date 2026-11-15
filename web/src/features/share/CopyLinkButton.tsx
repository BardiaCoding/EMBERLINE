import { Link2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { postShare } from '@/lib/api'
import { buildShareLink, shareMessage } from '@/lib/shareLink'
import type { AppState } from '@/lib/urlState'

type CopyLinkButtonProps = {
  /** The state to share (area, dates, baseline, view, tab). Null disables the control. */
  state: AppState | null
  /** Current query string, so parameters the app does not manage stay in the link. */
  search: string
}

type Status =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'done'; message: string }
  | { kind: 'manual'; message: string; url: string }
  | { kind: 'error'; message: string }

/**
 * "Copy link": copies the address of the current view (requirements 19.6 and 19.7). A long area
 * is stored on the server as a short `s=` id, or simplified when the server cannot store it,
 * and the status line says so, with the largest vertex displacement in metres. The status is a
 * live region. When the browser refuses clipboard access, the link is shown in a text field.
 */
export function CopyLinkButton({ state, search }: CopyLinkButtonProps) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const copy = useCallback(async () => {
    if (state === null) return
    setStatus({ kind: 'working' })
    try {
      const baseUrl = `${window.location.origin}${window.location.pathname}`
      const outcome = await buildShareLink({
        baseUrl,
        search,
        state,
        storeArea: async (geometry) => (await postShare(geometry)).id,
      })
      const message = shareMessage(outcome)
      let next: Status
      try {
        await navigator.clipboard.writeText(outcome.url)
        next = { kind: 'done', message }
      } catch {
        next = { kind: 'manual', message: 'Copy the link below.', url: outcome.url }
      }
      if (mounted.current) setStatus(next)
    } catch {
      if (mounted.current) setStatus({ kind: 'error', message: 'The link could not be made.' })
    }
  }, [state, search])

  const working = status.kind === 'working'
  return (
    <section aria-labelledby="share-title" className="flex flex-col gap-2">
      <h2 id="share-title" className="text-sm font-semibold">
        Share
      </h2>
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-disabled={state === null || working}
          onClick={() => {
            if (!working) void copy()
          }}
          className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
        >
          <Link2 aria-hidden="true" className="size-4" />
          Copy link
        </Button>
      </div>
      <p role="status" aria-live="polite" data-testid="share-status" className="text-sm">
        {status.kind === 'working' && 'Making the link.'}
        {(status.kind === 'done' || status.kind === 'manual' || status.kind === 'error') &&
          status.message}
      </p>
      {status.kind === 'manual' && (
        <input
          readOnly
          aria-label="Link to copy"
          value={status.url}
          onFocus={(event) => {
            event.currentTarget.select()
          }}
          className="w-full rounded border px-2 py-1 text-xs"
        />
      )}
    </section>
  )
}

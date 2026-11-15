import { Button } from '@/components/ui/button'
import { isApiError } from '@/lib/api'
import { formatDateRange, REGION_LABEL } from '@/lib/format'
import type { UpdatingState } from '@/lib/updatingState'

/** Solid label at the top of the results panel while old results are held (requirement 28.7). */
export function UpdatingLabel({ state }: { state: UpdatingState }) {
  if (state === 'idle') return null
  return (
    <p
      className="inline-block rounded-md bg-primary px-3 py-1 text-sm font-semibold text-primary-foreground"
      data-testid="updating-label"
    >
      {state === 'updating' ? 'Updating' : 'Not updated'}
    </p>
  )
}

/** Loading indicator for a first load that has lasted 300 ms (requirement 26.3). */
export function LoadingIndicator() {
  return (
    <div
      className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 text-sm text-card-foreground"
      data-testid="loading-indicator"
    >
      <span
        aria-hidden="true"
        className="size-5 shrink-0 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent motion-reduce:animate-none"
      />
      <span>Loading results…</span>
    </div>
  )
}

type EmptyStateProps = {
  /** Name or description of the Selection_Area, for example "California region". */
  area?: string
  /** Date_Range, `YYYY-MM-DD`, local standard time UTC-8. */
  start: string
  end: string
}

/** Message for a Query with zero cell-days, in place of the Calendar and charts (requirement 26.4). */
export function EmptyState({ area = REGION_LABEL, start, end }: EmptyStateProps) {
  return (
    <section
      aria-labelledby="empty-state-title"
      className="rounded-lg border border-border bg-card p-4 text-card-foreground"
      data-testid="empty-state"
    >
      <h3 id="empty-state-title" className="text-base font-semibold">
        No detected burning activity
      </h3>
      <p className="mt-1 text-sm">
        There were no detected fires in {area} from {formatDateRange(start, end)}. Try a larger area
        or a longer date range.
      </p>
    </section>
  )
}

type ErrorCardProps = {
  error: unknown
  onRetry: () => void
}

/** Error card with Retry. The Selection_Area, Date_Range and options stay as entered (requirement 26.5). */
export function ErrorCard({ error, onRetry }: ErrorCardProps) {
  const timedOut = isApiError(error) && error.kind === 'timeout'
  const title = timedOut ? 'The request timed out' : 'The request failed'
  const detail = isApiError(error) ? error.message : null
  const requestId = isApiError(error) ? error.requestId : null
  return (
    <section
      aria-labelledby="error-card-title"
      className="rounded-lg border border-destructive bg-card p-4 text-card-foreground"
      data-testid="error-card"
    >
      <h3 id="error-card-title" className="text-base font-semibold text-destructive">
        {title}
      </h3>
      {detail ? <p className="mt-1 text-sm">{detail}</p> : null}
      <p className="mt-1 text-sm text-muted-foreground">
        Your area, dates and options are unchanged. Retry sends the same request again.
      </p>
      {requestId ? (
        <p className="mt-1 text-xs text-muted-foreground">Request id: {requestId}</p>
      ) : null}
      <Button className="mt-3" variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </section>
  )
}

/**
 * Full-page state when the health endpoint reports 503: the delivered data are missing or
 * unreadable. Shown instead of empty charts (requirement 32.7).
 */
export function DataUnavailable({ onRetry }: { onRetry?: () => void }) {
  return (
    <main
      aria-labelledby="data-unavailable-title"
      className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground"
      data-testid="data-unavailable"
    >
      <div className="max-w-md rounded-lg border border-border bg-card p-6 text-card-foreground">
        <h1 id="data-unavailable-title" className="text-xl font-semibold">
          Data not available
        </h1>
        <p className="mt-2 text-sm">
          The fire activity data for the {REGION_LABEL} cannot be read right now, so no results are
          shown. Try again in a few minutes.
        </p>
        {onRetry ? (
          <Button className="mt-4" variant="outline" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
      </div>
    </main>
  )
}

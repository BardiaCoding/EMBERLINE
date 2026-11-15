// Text for the status live region (requirements 27.8, 28.9). Pure, so it can be tested alone.

/** What the results panel is doing. `pending` is a fetch shorter than the 300 ms delay. */
export type ResultsPhase = 'pending' | 'loading' | 'updating' | 'error' | 'ready'

export const MESSAGE_LOADING = 'Loading results.'
export const MESSAGE_UPDATING =
  'Updating results. The previous results stay on screen until the new ones arrive.'
export const MESSAGE_ERROR = 'The request failed. Results were not updated.'
export const MESSAGE_READY = 'Results updated.'

/**
 * Message to announce when the phase changes from `previous` to `next`, or null for none.
 * A `ready` phase is announced only after a visible loading, updating or error phase.
 */
export function announcementFor(previous: ResultsPhase, next: ResultsPhase): string | null {
  if (previous === next) return null
  switch (next) {
    case 'loading':
      return MESSAGE_LOADING
    case 'updating':
      return MESSAGE_UPDATING
    case 'error':
      return MESSAGE_ERROR
    case 'ready':
      return previous === 'loading' || previous === 'updating' || previous === 'error'
        ? MESSAGE_READY
        : null
    case 'pending':
      return null
  }
}

// Detail_Panel messages (requirement 15.26). Polite status text, no focus change.
export const MESSAGE_DETAILS_CLOSED = 'Details closed.'
/** Message for the Detail_Panel opening on `title` (for example `July 2002`). */
export function detailsOpenedMessage(title: string): string {
  return `Details for ${title} opened.`
}

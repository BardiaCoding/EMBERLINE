// The "Updating" state of the results panel (design.md section 11.2, requirements 28.5 to 28.9).
// Pure function, no I/O, so the timing rule can be tested with plain numbers.

/** Fetching must last this long, with old results held, before the label shows (G13, DEFAULT (confirm)). */
export const UPDATING_DELAY_MS = 300

export type UpdatingState = 'idle' | 'updating' | 'not_updated'

/**
 * - `not_updated`: the last request failed (error card and Retry are shown).
 * - `updating`: previous results are held while a new Query loads, and 300 ms have passed.
 * - `idle`: anything else, including a fetch shorter than 300 ms.
 */
export function updatingState(
  isPlaceholderData: boolean,
  isFetching: boolean,
  isError: boolean,
  elapsedMs: number,
): UpdatingState {
  if (isError) return 'not_updated'
  if (isPlaceholderData && isFetching && elapsedMs >= UPDATING_DELAY_MS) return 'updating'
  return 'idle'
}

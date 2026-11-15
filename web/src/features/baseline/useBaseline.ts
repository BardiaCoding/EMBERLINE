import { useCallback, useEffect, useRef, useState } from 'react'
import { isApiError } from '@/lib/api'
import type { Baseline } from './baselineYears'
/** API error code for a baseline the server rejects (HTTP 422). */
export const INVALID_BASELINE_CODE = 'invalid_baseline_years'
export type BaselineSelection = {
  /** The baseline sent with every request, null for the default (full record). */
  baseline: Baseline | null
  /** Server message of the last rejected baseline, until the next apply. */
  error: string | null
  apply: (next: Baseline | null) => void
}
/** Applied baseline (initially from the page address) and the message of a rejection. */
export function useBaselineSelection(initial: Baseline | null): BaselineSelection & {
  /** Puts the last accepted baseline back and keeps `message`. */
  revert: (message: string) => void
  /** Records `baseline` as the last one the server accepted. */
  confirm: (baseline: Baseline | null) => void
} {
  const [baseline, setBaseline] = useState<Baseline | null>(initial)
  const [error, setError] = useState<string | null>(null)
  // The last baseline the server answered for. The full record is always accepted.
  const lastGood = useRef<Baseline | null>(null)
  const apply = useCallback((next: Baseline | null) => {
    setError(null)
    setBaseline(next)
  }, [])
  const revert = useCallback((message: string) => {
    setError(message)
    setBaseline(lastGood.current)
  }, [])
  const confirm = useCallback((value: Baseline | null) => {
    lastGood.current = value
  }, [])
  return { baseline, error, apply, revert, confirm }
}
type QueryState = { error: unknown; isSuccess: boolean; isPlaceholderData: boolean }
/**
 * Watches the Calendar query. A 422 `invalid_baseline_years` puts the previous baseline back
 * (its results are still cached) and keeps the server message for the panel. A fresh success
 * records the baseline as the one to return to.
 */
export function useBaselineRejection(
  selection: ReturnType<typeof useBaselineSelection>,
  query: QueryState,
): void {
  const { baseline, revert, confirm } = selection
  const { error, isSuccess, isPlaceholderData } = query
  useEffect(() => {
    if (isApiError(error) && error.code === INVALID_BASELINE_CODE) {
      revert(error.message)
    } else if (isSuccess && !isPlaceholderData) {
      confirm(baseline)
    }
  }, [error, isSuccess, isPlaceholderData, baseline, revert, confirm])
}
/** True for the 422 that `useBaselineRejection` handles, so it is not shown as a load error. */
export function isBaselineRejection(error: unknown): boolean {
  return isApiError(error) && error.code === INVALID_BASELINE_CODE
}

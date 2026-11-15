import { useEffect, useState } from 'react'
import { UPDATING_DELAY_MS, updatingState, type UpdatingState } from '@/lib/updatingState'
import { announcementFor, type ResultsPhase } from './statusMessages'

export type ResultsStatusInput = {
  /** TanStack Query `isPlaceholderData`: old results are held while a new Query loads. */
  isPlaceholderData: boolean
  isFetching: boolean
  isError: boolean
  /** True when results (current or held) are available to show. */
  hasData: boolean
}

export type ResultsStatus = {
  updating: UpdatingState
  /** Show the loading indicator: no results yet and 300 ms have passed. */
  showLoading: boolean
  phase: ResultsPhase
  /** Text for `StatusAnnouncer`. Empty until the first change. */
  announcement: string
}

/** True once `active` has been true for `delayMs` without a break. */
function useDelayedFlag(active: boolean, delayMs: number): boolean {
  const [reached, setReached] = useState(false)
  useEffect(() => {
    if (!active) return undefined
    const timer = setTimeout(() => {
      setReached(true)
    }, delayMs)
    return () => {
      clearTimeout(timer)
      setReached(false)
    }
  }, [active, delayMs])
  return active && reached
}

/**
 * Combines the query flags with the 300 ms delay into what the panel shows and what the
 * status live region announces (requirements 26.3, 28.5, 28.7 to 28.9).
 */
export function useResultsStatus(input: ResultsStatusInput): ResultsStatus {
  const { isPlaceholderData, isFetching, isError, hasData } = input
  const delayPassed = useDelayedFlag(isFetching && !isError, UPDATING_DELAY_MS)
  const elapsedMs = delayPassed ? UPDATING_DELAY_MS : 0
  const updating = updatingState(isPlaceholderData, isFetching, isError, elapsedMs)
  const showLoading = !isError && !hasData && isFetching && delayPassed

  let phase: ResultsPhase
  if (isError) phase = 'error'
  else if (showLoading) phase = 'loading'
  else if (updating === 'updating') phase = 'updating'
  else if (isFetching) phase = 'pending'
  else phase = 'ready'

  // Adjust state during render (React docs: "storing information from previous renders").
  const [lastPhase, setLastPhase] = useState<ResultsPhase>(phase)
  const [announcement, setAnnouncement] = useState('')
  if (phase !== lastPhase && phase !== 'pending') {
    setLastPhase(phase)
    const text = announcementFor(lastPhase, phase)
    if (text !== null) setAnnouncement(text)
  }
  return { updating, showLoading, phase, announcement }
}

import { useEffect, useRef } from 'react'

/** Delay between a state change and the write to the page address (design.md section 11.2). */
export const URL_WRITE_DELAY_MS = 200

/**
 * Writes `search` (`?...` or an empty string) to the page address with `history.replaceState`
 * 200 ms after the last change, so no history entry is added and fast changes make one write.
 * Pass null to write nothing (state not ready). A pending write is made when the component
 * unmounts. Path and hash stay as they are.
 */
export function useUrlWriter(search: string | null): void {
  const pending = useRef<string | null>(null)

  useEffect(() => {
    if (search === null) return
    pending.current = search
    const timer = window.setTimeout(() => {
      writeNow(search)
      pending.current = null
    }, URL_WRITE_DELAY_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [search])

  useEffect(
    () => () => {
      if (pending.current !== null) writeNow(pending.current)
    },
    [],
  )
}

function writeNow(search: string): void {
  const { pathname, hash } = window.location
  window.history.replaceState(window.history.state as unknown, '', `${pathname}${search}${hash}`)
}

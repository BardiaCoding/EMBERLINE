import { useCallback, useState } from 'react'

/** Session storage key. "1" means the hint was dismissed or closed in this tab session. */
export const DRAW_HINT_STORAGE_KEY = 'hfc.drawHint.closed'

function readClosed(): boolean {
  try {
    return window.sessionStorage.getItem(DRAW_HINT_STORAGE_KEY) === '1'
  } catch {
    // Storage can be blocked. Show the hint, and forget the choice on reload.
    return false
  }
}

function writeClosed(): void {
  try {
    window.sessionStorage.setItem(DRAW_HINT_STORAGE_KEY, '1')
  } catch {
    // Not stored. The hint stays closed until the page reloads.
  }
}

/**
 * Open or closed state of the draw hint (requirement 11.13). Closing is remembered for the
 * browser tab session. Storage access is wrapped, so blocked storage never throws.
 */
export function useDrawHint(): { open: boolean; close: () => void } {
  const [closed, setClosed] = useState(readClosed)
  const close = useCallback(() => {
    writeClosed()
    setClosed(true)
  }, [])
  return { open: !closed, close }
}

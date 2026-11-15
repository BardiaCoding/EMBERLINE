import { useCallback, useMemo } from 'react'
import { formatCellId, parseCellId, type AppState } from '@/lib/urlState'

/**
 * Hook that manages calendar cell selection via URL state (task 28.9).
 * - Reads the `cell` parameter from the current app state
 * - Provides `selectCell(year, month)` to update the URL with a cell selection
 * - Provides `clearSelection()` to remove the cell selection from the URL
 * - Returns the current selection as `{ year, month } | null`
 */
export function useSelectCell(
  currentState: AppState | null,
  onUpdateState: (update: (prev: AppState) => AppState) => void,
) {
  const selection = useMemo(() => {
    if (currentState === null || currentState.cell === undefined) return null
    return parseCellId(currentState.cell)
  }, [currentState])

  const selectCell = useCallback(
    (year: number, month: number) => {
      onUpdateState((prev) => ({
        ...prev,
        cell: formatCellId(year, month),
      }))
    },
    [onUpdateState],
  )

  const clearSelection = useCallback(() => {
    onUpdateState((prev) => {
      const next = { ...prev }
      delete next.cell
      return next
    })
  }, [onUpdateState])

  return {
    selection,
    selectCell,
    clearSelection,
  }
}

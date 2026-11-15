import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSelectCell } from './useSelectCell'
import type { AppState } from '@/lib/urlState'

describe('useSelectCell', () => {
  const baseState: AppState = {
    area: { kind: 'region' },
    start: '2020-01-01',
    end: '2020-12-31',
    view: 'counts',
    compare: { mode: 'none' },
  }

  it('returns null selection when cell is not in state', () => {
    const onUpdate = vi.fn()
    const { result } = renderHook(() => useSelectCell(baseState, onUpdate))

    expect(result.current.selection).toBeNull()
  })

  it('parses cell from state', () => {
    const stateWithCell: AppState = { ...baseState, cell: '2020-06' }
    const onUpdate = vi.fn()
    const { result } = renderHook(() => useSelectCell(stateWithCell, onUpdate))

    expect(result.current.selection).toEqual({ year: 2020, month: 6 })
  })

  it('selectCell updates state with formatted cell id', () => {
    const onUpdate = vi.fn()
    const { result } = renderHook(() => useSelectCell(baseState, onUpdate))

    act(() => {
      result.current.selectCell(2021, 3)
    })

    expect(onUpdate).toHaveBeenCalledWith(expect.any(Function))
    const updateFn = onUpdate.mock.calls[0]?.[0] as ((prev: AppState) => AppState) | undefined
    if (updateFn) {
      const newState = updateFn(baseState)
      expect(newState.cell).toBe('2021-03')
    }
  })

  it('clearSelection removes cell from state', () => {
    const stateWithCell: AppState = { ...baseState, cell: '2020-06' }
    const onUpdate = vi.fn()
    const { result } = renderHook(() => useSelectCell(stateWithCell, onUpdate))

    act(() => {
      result.current.clearSelection()
    })

    expect(onUpdate).toHaveBeenCalledWith(expect.any(Function))
    const updateFn = onUpdate.mock.calls[0]?.[0] as ((prev: AppState) => AppState) | undefined
    if (updateFn) {
      const newState = updateFn(stateWithCell)
      expect(newState.cell).toBeUndefined()
    }
  })

  it('handles invalid cell id gracefully', () => {
    const stateWithBadCell: AppState = { ...baseState, cell: 'invalid' }
    const onUpdate = vi.fn()
    const { result } = renderHook(() => useSelectCell(stateWithBadCell, onUpdate))

    expect(result.current.selection).toBeNull()
  })

  it('handles null state', () => {
    const onUpdate = vi.fn()
    const { result } = renderHook(() => useSelectCell(null, onUpdate))

    expect(result.current.selection).toBeNull()
  })
})

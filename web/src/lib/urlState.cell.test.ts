import { describe, it, expect } from 'vitest'
import { formatCellId, parseCellId, decodeState, encodeState } from './urlState'

describe('formatCellId', () => {
  it('formats year and month as YYYY-MM', () => {
    expect(formatCellId(2020, 6)).toBe('2020-06')
    expect(formatCellId(2020, 12)).toBe('2020-12')
    expect(formatCellId(2000, 1)).toBe('2000-01')
  })

  it('pads single-digit months with zero', () => {
    expect(formatCellId(2020, 1)).toBe('2020-01')
    expect(formatCellId(2020, 9)).toBe('2020-09')
  })
})

describe('parseCellId', () => {
  it('parses valid cell id', () => {
    expect(parseCellId('2020-06')).toEqual({ year: 2020, month: 6 })
    expect(parseCellId('2020-12')).toEqual({ year: 2020, month: 12 })
    expect(parseCellId('2000-01')).toEqual({ year: 2000, month: 1 })
  })

  it('accepts single-digit months', () => {
    expect(parseCellId('2020-6')).toEqual({ year: 2020, month: 6 })
    expect(parseCellId('2020-1')).toEqual({ year: 2020, month: 1 })
  })

  it('returns null for invalid format', () => {
    expect(parseCellId('2020-6-1')).toBeNull()
    expect(parseCellId('202006')).toBeNull()
    expect(parseCellId('invalid')).toBeNull()
    expect(parseCellId('')).toBeNull()
  })

  it('returns null for out-of-range months', () => {
    expect(parseCellId('2020-0')).toBeNull()
    expect(parseCellId('2020-13')).toBeNull()
    expect(parseCellId('2020-99')).toBeNull()
  })

  it('round-trips with formatCellId', () => {
    const year = 2020
    const month = 6
    const formatted = formatCellId(year, month)
    const parsed = parseCellId(formatted)
    expect(parsed).toEqual({ year, month })
  })
})

describe('cell parameter in URL state', () => {
  const fallback = { start: '2020-01-01', end: '2020-12-31' }

  it('encodes cell in URL state', () => {
    const state = {
      area: { kind: 'region' as const },
      start: '2020-01-01',
      end: '2020-12-31',
      view: 'counts' as const,
      compare: { mode: 'none' as const },
      cell: '2020-06',
    }
    const encoded = encodeState(state)
    expect(encoded).toContain('cell=2020-06')
  })

  it('decodes cell from URL state', () => {
    const search = 'from=2020-01-01&to=2020-12-31&cell=2020-06'
    const { state } = decodeState(search, { fallback })
    expect(state.cell).toBe('2020-06')
  })

  it('rejects invalid cell format', () => {
    const search = 'from=2020-01-01&to=2020-12-31&cell=invalid'
    const { state, rejected } = decodeState(search, { fallback })
    expect(state.cell).toBeUndefined()
    expect(rejected).toContainEqual({ param: 'cell', reason: 'bad_cell' })
  })

  it('accepts valid cell id pattern', () => {
    const search = 'from=2020-01-01&to=2020-12-31&cell=2020-06'
    const { state, rejected } = decodeState(search, { fallback })
    expect(state.cell).toBe('2020-06')
    expect(rejected).toHaveLength(0)
  })

  it('omits cell when not present', () => {
    const state = {
      area: { kind: 'region' as const },
      start: '2020-01-01',
      end: '2020-12-31',
      view: 'counts' as const,
      compare: { mode: 'none' as const },
    }
    const encoded = encodeState(state)
    expect(encoded).not.toContain('cell=')
  })
})

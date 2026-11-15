import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { UPDATING_DELAY_MS, updatingState } from './updatingState'

describe('updatingState', () => {
  it('is idle before 300 ms and updating from 300 ms while old results are held', () => {
    expect(updatingState(true, true, false, 299)).toBe('idle')
    expect(updatingState(true, true, false, UPDATING_DELAY_MS)).toBe('updating')
  })

  it('is idle without held results or without a running fetch', () => {
    expect(updatingState(false, true, false, 5000)).toBe('idle')
    expect(updatingState(true, false, false, 5000)).toBe('idle')
  })

  it('is not_updated after a failure', () => {
    expect(updatingState(true, false, true, 0)).toBe('not_updated')
  })

  it('error always wins, and updating needs all three conditions', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), fc.boolean(), fc.nat(10_000), (p, f, e, ms) => {
        const state = updatingState(p, f, e, ms)
        if (e) return state === 'not_updated'
        return state === (p && f && ms >= UPDATING_DELAY_MS ? 'updating' : 'idle')
      }),
    )
  })
})

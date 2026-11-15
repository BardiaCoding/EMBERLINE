import fc from 'fast-check'
import {
  baselineLabel,
  completeYearBounds,
  MAX_BASELINE_YEARS,
  MIN_BASELINE_YEARS,
  validateBaselineInput,
} from './baselineYears'
import { decodeState, encodeState } from '@/lib/urlState'
describe('completeYearBounds', () => {
  it('skips the partial first and last years', () => {
    expect(completeYearBounds('2000-11', '2026-10')).toEqual({ first: 2001, last: 2025 })
    expect(completeYearBounds('2000-01', '2026-12')).toEqual({ first: 2000, last: 2026 })
  })
  it('is null without a complete year', () => {
    expect(completeYearBounds('2000-11', null)).toBeNull()
    expect(completeYearBounds('2000-11', '2001-06')).toBeNull()
  })
})
describe('validateBaselineInput', () => {
  const bounds = { first: 2001, last: 2025 }
  it('accepts 5 to 30 years inside the bounds', () => {
    expect(validateBaselineInput('2005', '2009', bounds)).toEqual({
      ok: true,
      baseline: [2005, 2009],
    })
  })
  it.each([
    ['2005', '2008', /at least 5/],
    ['2000', '2010', /complete years in the record/],
    ['2010', '2005', /not be after/],
    ['abc', '2010', /four digits/],
  ])('rejects %s to %s with a message', (a, b, message) => {
    const result = validateBaselineInput(a, b, bounds)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(message)
  })
  it('names the upper limit', () => {
    const result = validateBaselineInput('1990', '2025', { first: 1990, last: 2025 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/at most 30/)
  })
  /** **Validates: Requirements 10.2, 10.10** */
  it('accepts exactly the periods of 5 to 30 years inside the bounds', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1990, max: 2030 }),
        fc.integer({ min: 1990, max: 2030 }),
        (a, b) => {
          const result = validateBaselineInput(String(a), String(b), { first: 2001, last: 2025 })
          const n = b - a + 1
          const valid = a >= 2001 && b <= 2025 && n >= MIN_BASELINE_YEARS && n <= MAX_BASELINE_YEARS
          expect(result.ok).toBe(valid)
        },
      ),
    )
  })
})
describe('baseline text and URL', () => {
  it('names the period or the default', () => {
    expect(baselineLabel([2005, 2014])).toBe('Baseline period: 2005 to 2014 (10 years).')
    expect(baselineLabel(null)).toMatch(/full record/)
  })
  it('round-trips through the page address', () => {
    const fallback = { start: '2020-01-01', end: '2020-12-31' }
    const search = encodeState({
      area: { kind: 'region' },
      ...fallback,
      baseline: [2005, 2014],
      view: 'counts',
      compare: { mode: 'none' },
    })
    expect(new URLSearchParams(search).get('bl')).toBe('2005-2014')
    expect(decodeState(search, { fallback }).state.baseline).toEqual([2005, 2014])
  })
})

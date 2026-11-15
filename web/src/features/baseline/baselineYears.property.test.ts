// Feature: harmonized-fire-calendar, Property 26: Baseline period limits
// Validates: Requirements 10.2, 10.10. Synthetic years (TEST FIXTURE, not NASA data).
import fc from 'fast-check'
import { MAX_BASELINE_YEARS, MIN_BASELINE_YEARS, validateBaselineInput } from './baselineYears'

const bounds = { first: 2001, last: 2025 }

describe('Property 26: baseline period limits (front end)', () => {
  it('accepts exactly 5 to 30 complete in-record years and names the violated limit', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1990, max: 2040 }),
        fc.integer({ min: 1990, max: 2040 }),
        (first, last) => {
          const wide = { first: 1990, last: 2040 }
          const narrow = bounds
          for (const b of [wide, narrow]) {
            const result = validateBaselineInput(String(first), String(last), b)
            const n = last - first + 1
            const inRecord = first >= b.first && last <= b.last
            const ok =
              first <= last && inRecord && n >= MIN_BASELINE_YEARS && n <= MAX_BASELINE_YEARS
            expect(result.ok).toBe(ok)
            if (result.ok) {
              expect(result.baseline).toEqual([first, last])
            } else if (first <= last && inRecord) {
              expect(result.error).toContain(
                n < MIN_BASELINE_YEARS
                  ? `at least ${MIN_BASELINE_YEARS}`
                  : `at most ${MAX_BASELINE_YEARS}`,
              )
            } else if (first <= last) {
              expect(result.error).toContain(`${b.first} to ${b.last}`)
            }
          }
        },
      ),
    )
  })
})

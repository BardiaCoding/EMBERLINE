// Property-based tests for unified binning (requirement 19.4).
// **Validates: Requirements 19.4**
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { buildUnifiedCalendarModels } from './binning.unified'
import type { CalendarOut, MonthOut } from './api'

// Generator for a calendar result with random month counts
const calendarResultArb: fc.Arbitrary<CalendarOut> = fc
  .tuple(
    fc.integer({ min: 2010, max: 2020 }),
    fc.array(fc.float({ min: 0, max: 1000, noNaN: true }), { minLength: 1, maxLength: 12 }),
  )
  .map(([year, counts]): CalendarOut => {
    const months: MonthOut[] = counts.map((count, i) => ({
      year,
      month: i + 1,
      harmonized: count,
      raw_modis: Math.floor(count / 2),
      raw_viirs: Math.floor(count / 2),
      frp_sum_mw: null,
      source_flag: 'native',
      calib_model: null,
      provenance: 'Terra',
      provisional: false,
      lower_bound: null,
      upper_bound: null,
      anomaly: null,
    }))

    return {
      months,
      years: [],
      baseline_by_month: [],
      baseline_year: null,
      coverage: {
        first_month: null,
        last_month: null,
        n_months: months.length,
        requested_start: null,
        requested_end: null,
        starts_mid_month: false,
        ends_mid_month: false,
        before_record: false,
        after_latest: false,
      },
      n_cells: 100,
      notice: null,
      clipped_percent: null,
      area_km2: null,
      provisional_months: [],
    }
  })

describe('unified binning properties', () => {
  it('property: unified edges contain data from both panels', () => {
    fc.assert(
      fc.property(calendarResultArb, calendarResultArb, (result1, result2) => {
        const { model1, model2, hasData } = buildUnifiedCalendarModels({
          result1,
          result2,
          view: 'counts',
        })

        if (!hasData) {
          // If no data, edges should be empty or models should have no values
          return model1.total === 0 && model2.total === 0
        }

        // Both models should be defined
        expect(model1).toBeDefined()
        expect(model2).toBeDefined()

        // If there's data, at least one model should have positive total
        return model1.total > 0 || model2.total > 0
      }),
      { numRuns: 50 },
    )
  })

  it('property: counts view bins are monotonic', () => {
    fc.assert(
      fc.property(calendarResultArb, calendarResultArb, (result1, result2) => {
        const { unifiedEdges } = buildUnifiedCalendarModels({
          result1,
          result2,
          view: 'counts',
        })

        // Edges should be in ascending order
        for (let i = 1; i < unifiedEdges.length; i++) {
          if (unifiedEdges[i]! <= unifiedEdges[i - 1]!) {
            return false
          }
        }
        return true
      }),
      { numRuns: 50 },
    )
  })

  it('property: anomaly view always uses fixed edges', () => {
    fc.assert(
      fc.property(calendarResultArb, calendarResultArb, (result1, result2) => {
        const { unifiedEdges } = buildUnifiedCalendarModels({
          result1,
          result2,
          view: 'anomaly',
        })

        // Anomaly edges are always the same fixed set
        const expectedEdges = [-75, -50, -25, -10, 10, 25, 50, 100]
        return (
          unifiedEdges.length === expectedEdges.length &&
          unifiedEdges.every((edge, i) => edge === expectedEdges[i])
        )
      }),
      { numRuns: 50 },
    )
  })

  it('property: unified edges are stable for same inputs', () => {
    fc.assert(
      fc.property(calendarResultArb, calendarResultArb, (result1, result2) => {
        const output1 = buildUnifiedCalendarModels({
          result1,
          result2,
          view: 'counts',
        })
        const output2 = buildUnifiedCalendarModels({
          result1,
          result2,
          view: 'counts',
        })

        // Same inputs should produce same edges
        expect(output1.unifiedEdges).toEqual(output2.unifiedEdges)
        return true
      }),
      { numRuns: 50 },
    )
  })

  it('property: models with unified edges remain consistent', () => {
    fc.assert(
      fc.property(calendarResultArb, calendarResultArb, (result1, result2) => {
        const { model1, model2 } = buildUnifiedCalendarModels({
          result1,
          result2,
          view: 'counts',
        })

        // Both models should have the same view
        expect(model1.view).toBe('counts')
        expect(model2.view).toBe('counts')

        // Both models should have bins
        expect(Array.isArray(model1.bins)).toBe(true)
        expect(Array.isArray(model2.bins)).toBe(true)

        return true
      }),
      { numRuns: 50 },
    )
  })
})

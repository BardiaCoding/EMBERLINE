// Feature: harmonized-fire-calendar, Property 50: Watch badge text contains every required value
// Validates: Requirements 20.11, 20.12, 20.14, 20.15
// @vitest-environment node
// Inputs are synthetic.
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { formatWatchBadge } from './watch'

// Arbitraries for WatchOut fields
const watchLevelArb = fc.constantFrom('Above normal', 'Within normal range', 'Not available')

const periodArb = fc.integer({ min: 2000, max: 2026 }).chain((year) =>
  fc.integer({ min: 1, max: 12 }).map((month) => {
    const monthName = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ][month - 1]
    return `${monthName} ${year}`
  }),
)

const watchOutArb = fc.record({
  level: watchLevelArb,
  count: fc.option(fc.double({ min: 0, max: 10000, noNaN: true })),
  median: fc.option(fc.double({ min: 0, max: 10000, noNaN: true })),
  percentile: fc.option(fc.double({ min: 0, max: 100, noNaN: true })),
  period: fc.option(periodArb),
  baseline_start: fc.option(fc.integer({ min: 2000, max: 2026 })),
  baseline_end: fc.option(fc.integer({ min: 2000, max: 2026 })),
  n_years: fc.option(fc.integer({ min: 1, max: 26 })),
  provisional: fc.option(fc.boolean()),
  provisional_month: fc.option(periodArb),
  provisional_count: fc.option(fc.double({ min: 0, max: 10000, noNaN: true })),
  reason: fc.option(fc.string()),
  threshold: fc.option(fc.double({ min: 0, max: 100, noNaN: true })),
})

describe('Property 50: Watch badge text contains every required value', () => {
  it('returns level for all watch inputs', () => {
    fc.assert(
      fc.property(watchOutArb, (watch) => {
        const result = formatWatchBadge(watch)
        expect(result.level).toBeDefined()
        expect(typeof result.level).toBe('string')
        expect(result.level.length).toBeGreaterThan(0)
      }),
    )
  })

  it('returns tooltip for all watch inputs', () => {
    fc.assert(
      fc.property(watchOutArb, (watch) => {
        const result = formatWatchBadge(watch)
        expect(result.tooltip).toBeDefined()
        expect(typeof result.tooltip).toBe('string')
        expect(result.tooltip.length).toBeGreaterThan(0)
      }),
    )
  })

  it('includes level in the result', () => {
    fc.assert(
      fc.property(watchOutArb, (watch) => {
        const result = formatWatchBadge(watch)
        // Level is always returned as result.level
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (watch.level) {
          expect(result.level).toBe(watch.level)
        } else {
          expect(result.level).toBe('Not available')
        }
      }),
    )
  })

  it('includes count in tooltip when present and not "Not available"', () => {
    fc.assert(
      fc.property(
        watchOutArb.filter((w) => w.level !== 'Not available' && w.count !== null),
        (watch) => {
          const result = formatWatchBadge(watch)
          // Count should appear somewhere in the tooltip
          // formatCount rounds to 1 decimal, adds thousands separator
          const countStr = watch.count!.toFixed(1)
          const countWithCommas = watch.count!.toLocaleString('en-US', {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
          })
          expect(
            result.tooltip.includes(countStr) ||
              result.tooltip.includes(countWithCommas) ||
              result.tooltip.includes(watch.count!.toString()),
          ).toBe(true)
        },
      ),
    )
  })

  it('includes median in tooltip when present and count is present', () => {
    fc.assert(
      fc.property(
        watchOutArb.filter(
          (w) => w.level !== 'Not available' && w.count !== null && w.median !== null,
        ),
        (watch) => {
          const result = formatWatchBadge(watch)
          // Median should appear in tooltip with "baseline median" or just as a number
          const medianStr = watch.median!.toFixed(1)
          const medianWithCommas = watch.median!.toLocaleString('en-US', {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
          })
          expect(
            result.tooltip.includes(medianStr) ||
              result.tooltip.includes(medianWithCommas) ||
              result.tooltip.includes(watch.median!.toString()),
          ).toBe(true)
        },
      ),
    )
  })

  it('includes percentile in tooltip when present', () => {
    fc.assert(
      fc.property(
        watchOutArb.filter((w) => w.percentile !== null),
        (watch) => {
          const result = formatWatchBadge(watch)
          // Percentile should appear with "percentile"
          const percentileStr = watch.percentile!.toFixed(1)
          const percentileWithCommas = watch.percentile!.toLocaleString('en-US', {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
          })
          expect(
            result.tooltip.includes(percentileStr) ||
              result.tooltip.includes(percentileWithCommas) ||
              result.tooltip.includes(watch.percentile!.toString()),
          ).toBe(true)
        },
      ),
    )
  })

  it('includes period (month) in tooltip when present', () => {
    fc.assert(
      fc.property(
        watchOutArb.filter((w) => w.period !== null),
        (watch) => {
          const result = formatWatchBadge(watch)
          // Period should appear in tooltip
          expect(result.tooltip).toContain(watch.period!)
        },
      ),
    )
  })

  it('includes baseline years when all present', () => {
    fc.assert(
      fc.property(
        watchOutArb.filter(
          (w) => w.baseline_start !== null && w.baseline_end !== null && w.n_years !== null,
        ),
        (watch) => {
          const result = formatWatchBadge(watch)
          // Baseline years should appear in tooltip
          expect(result.tooltip).toContain(watch.baseline_start!.toString())
          expect(result.tooltip).toContain(watch.baseline_end!.toString())
          expect(result.tooltip).toContain(watch.n_years!.toString())
        },
      ),
    )
  })

  it('includes provisional info when provisional is true', () => {
    fc.assert(
      fc.property(
        watchOutArb.filter(
          (w) =>
            w.provisional === true && w.provisional_month !== null && w.provisional_count !== null,
        ),
        (watch) => {
          const result = formatWatchBadge(watch)
          // "Provisional" or similar term should appear
          expect(result.tooltip.toLowerCase()).toContain('provisional')
          // Provisional month and count should appear
          expect(result.tooltip).toContain(watch.provisional_month!)
        },
      ),
    )
  })

  it('includes threshold info for "Above normal"', () => {
    fc.assert(
      fc.property(
        watchOutArb.filter((w) => w.level === 'Above normal' && w.threshold !== null),
        (watch) => {
          const result = formatWatchBadge(watch)
          // Threshold should appear in tooltip
          expect(result.tooltip).toContain(watch.threshold!.toString())
        },
      ),
    )
  })

  it('includes reason when level is "Not available"', () => {
    fc.assert(
      fc.property(
        watchOutArb.filter(
          (w) => w.level === 'Not available' && w.reason !== null && w.reason !== '',
        ),
        (watch) => {
          const result = formatWatchBadge(watch)
          // Reason should appear in tooltip
          expect(result.tooltip).toContain(watch.reason!)
        },
      ),
    )
  })

  it('handles null watch gracefully', () => {
    const result = formatWatchBadge(null)
    expect(result.level).toBe('Not available')
    expect(result.tooltip).toBeTruthy()
    expect(result.tooltip.length).toBeGreaterThan(0)
  })

  it('all required fields appear for complete watch data', () => {
    fc.assert(
      fc.property(
        watchOutArb.filter(
          (w) =>
            w.level !== 'Not available' &&
            w.count !== null &&
            w.median !== null &&
            w.percentile !== null &&
            w.period !== null &&
            w.baseline_start !== null &&
            w.baseline_end !== null &&
            w.n_years !== null,
        ),
        (watch) => {
          const result = formatWatchBadge(watch)

          // All required fields from Requirements 20.11 should be present:
          // - level
          expect(result.level).toBe(watch.level)

          // - harmonized count (in cell-days) - just check that cell-days unit is present
          expect(result.tooltip.toLowerCase()).toContain('cell-day')

          // - baseline median - check for "baseline median" or just "median"
          expect(result.tooltip.toLowerCase()).toMatch(/baseline.*median|median/)

          // - percentile rank - can be formatted with "th percentile"
          expect(result.tooltip.toLowerCase()).toContain('percentile')

          // - evaluated month (period)
          expect(result.tooltip).toContain(watch.period!)

          // - baseline years (first and last)
          expect(result.tooltip).toContain(watch.baseline_start!.toString())
          expect(result.tooltip).toContain(watch.baseline_end!.toString())
        },
      ),
    )
  })

  it('cell-days unit appears in tooltip when count is present', () => {
    fc.assert(
      fc.property(
        watchOutArb.filter((w) => w.level !== 'Not available' && w.count !== null),
        (watch) => {
          const result = formatWatchBadge(watch)
          // Unit should be present
          expect(result.tooltip.toLowerCase()).toContain('cell-day')
        },
      ),
    )
  })
})

// Tests for per-area normalization (requirement 19.5).
import { describe, it, expect } from 'vitest'
import { normalizeToArea, normalizeCalendarResult, normalizedUnit, regularUnit } from './normalize'
import type { CalendarOut } from './api'

describe('normalizeToArea', () => {
  it('normalizes count to per-1000 km²', () => {
    expect(normalizeToArea(100, 5000)).toBe(20) // 100 / 5000 * 1000
    expect(normalizeToArea(500, 2500)).toBe(200) // 500 / 2500 * 1000
    expect(normalizeToArea(50, 1000)).toBe(50) // 50 / 1000 * 1000
  })

  it('returns 0 for zero area', () => {
    expect(normalizeToArea(100, 0)).toBe(0)
  })

  it('returns 0 for negative area', () => {
    expect(normalizeToArea(100, -100)).toBe(0)
  })

  it('handles zero count', () => {
    expect(normalizeToArea(0, 5000)).toBe(0)
  })

  it('handles fractional results', () => {
    expect(normalizeToArea(123.4, 5678)).toBeCloseTo(21.73, 2)
  })
})

describe('normalizeCalendarResult', () => {
  const mockResult: CalendarOut = {
    months: [
      {
        year: 2020,
        month: 1,
        harmonized: 100,
        raw_modis: 50,
        raw_viirs: 50,
        frp_sum_mw: null,
        source_flag: 'native',
        calib_model: null,
        provenance: 'Terra',
        provisional: false,
        lower_bound: null,
        upper_bound: null,
        anomaly: {
          absolute: 20,
          percent: 25,
          percent_text: null,
          zscore: 1.5,
          percentile_rank: 75,
          baseline_start_year: 2000,
          baseline_end_year: 2019,
          n_years: 20,
        },
      },
    ],
    years: [
      {
        year: 2020,
        harmonized: 1200,
        raw_modis: 600,
        raw_viirs: 600,
        frp_sum_mw: null,
        n_months: 12,
        provisional: false,
        anomaly: null,
      },
    ],
    baseline_by_month: [
      {
        month: 1,
        median: 80,
        p10: 40,
        p90: 120,
        mean: 85,
        std: 20,
        n_years: 20,
      },
    ],
    baseline_year: {
      median: 1000,
      p10: 500,
      p90: 1500,
      mean: 1050,
      std: 250,
      n_years: 20,
    },
    coverage: {
      first_month: null,
      last_month: null,
      n_months: 12,
      requested_start: '2020-01-01',
      requested_end: '2020-12-31',
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

  it('normalizes all harmonized counts', () => {
    const normalized = normalizeCalendarResult(mockResult, 5000)

    // Months: 100 / 5000 * 1000 = 20
    expect(normalized.months[0]?.harmonized).toBe(20)

    // Years: 1200 / 5000 * 1000 = 240
    expect(normalized.years[0]?.harmonized).toBe(240)

    // Baseline medians: 80 / 5000 * 1000 = 16
    expect(normalized.baseline_by_month[0]?.median).toBe(16)
    expect(normalized.baseline_by_month[0]?.p10).toBe(8)
    expect(normalized.baseline_by_month[0]?.p90).toBe(24)

    // Baseline year: 1000 / 5000 * 1000 = 200
    expect(normalized.baseline_year?.median).toBe(200)
  })

  it('keeps raw counts unchanged', () => {
    const normalized = normalizeCalendarResult(mockResult, 5000)

    // Raw counts should not be normalized
    expect(normalized.months[0]?.raw_modis).toBe(50)
    expect(normalized.months[0]?.raw_viirs).toBe(50)
    expect(normalized.years[0]?.raw_modis).toBe(600)
    expect(normalized.years[0]?.raw_viirs).toBe(600)
  })

  it('normalizes absolute anomaly but keeps percent unchanged', () => {
    const normalized = normalizeCalendarResult(mockResult, 5000)

    // Absolute should be normalized: 20 / 5000 * 1000 = 4
    expect(normalized.months[0]?.anomaly?.absolute).toBe(4)

    // Percent should stay the same (it's relative)
    expect(normalized.months[0]?.anomaly?.percent).toBe(25)
  })

  it('keeps a null baseline std null and leaves z-score unchanged', () => {
    const withNullStd: CalendarOut = {
      ...mockResult,
      baseline_by_month: mockResult.baseline_by_month.map((b) => ({ ...b, std: null })),
    }
    const normalized = normalizeCalendarResult(withNullStd, 5000)
    expect(normalized.baseline_by_month[0]?.std).toBeNull()
    expect(normalizeCalendarResult(withNullStd, 0).baseline_by_month[0]?.std).toBeNull()
    expect(normalized.months[0]?.anomaly?.zscore).toBe(1.5)
  })
  it('returns zero counts for zero area', () => {
    const normalized = normalizeCalendarResult(mockResult, 0)

    expect(normalized.months[0]?.harmonized).toBe(0)
    expect(normalized.years[0]?.harmonized).toBe(0)
    expect(normalized.baseline_by_month[0]?.median).toBe(0)
  })

  it('returns zero counts for negative area', () => {
    const normalized = normalizeCalendarResult(mockResult, -100)

    expect(normalized.months[0]?.harmonized).toBe(0)
    expect(normalized.years[0]?.harmonized).toBe(0)
  })
})

describe('unit labels', () => {
  it('returns normalized unit label', () => {
    expect(normalizedUnit()).toBe('cell-days per 1000 km² (MODIS-equivalent)')
  })

  it('returns regular unit label', () => {
    expect(regularUnit()).toBe('cell-days per month (MODIS-equivalent)')
  })
})

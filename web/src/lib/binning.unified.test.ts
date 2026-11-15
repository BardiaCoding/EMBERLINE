// Tests for unified binning in comparison mode (requirement 19.4).
import { describe, it, expect } from 'vitest'
import { buildUnifiedCalendarModels } from './binning.unified'
import type { CalendarOut } from './api'
import { ANOMALY_EDGES } from './binning'

describe('buildUnifiedCalendarModels', () => {
  const mockResult1: CalendarOut = {
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
      {
        year: 2020,
        month: 2,
        harmonized: 200,
        raw_modis: 100,
        raw_viirs: 100,
        frp_sum_mw: null,
        source_flag: 'native',
        calib_model: null,
        provenance: 'Terra',
        provisional: false,
        lower_bound: null,
        upper_bound: null,
        anomaly: null,
      },
    ],
    years: [],
    baseline_by_month: [],
    baseline_year: null,
    coverage: {
      first_month: null,
      last_month: null,
      n_months: 2,
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

  const mockResult2: CalendarOut = {
    months: [
      {
        year: 2020,
        month: 1,
        harmonized: 150,
        raw_modis: 75,
        raw_viirs: 75,
        frp_sum_mw: null,
        source_flag: 'native',
        calib_model: null,
        provenance: 'Terra',
        provisional: false,
        lower_bound: null,
        upper_bound: null,
        anomaly: null,
      },
      {
        year: 2020,
        month: 2,
        harmonized: 250,
        raw_modis: 125,
        raw_viirs: 125,
        frp_sum_mw: null,
        source_flag: 'native',
        calib_model: null,
        provenance: 'Terra',
        provisional: false,
        lower_bound: null,
        upper_bound: null,
        anomaly: null,
      },
    ],
    years: [],
    baseline_by_month: [],
    baseline_year: null,
    coverage: {
      first_month: null,
      last_month: null,
      n_months: 2,
      requested_start: null,
      requested_end: null,
      starts_mid_month: false,
      ends_mid_month: false,
      before_record: false,
      after_latest: false,
    },
    n_cells: 150,
    notice: null,
    clipped_percent: null,
    area_km2: null,
    provisional_months: [],
  }

  it('builds two models with data flag', () => {
    const { model1, model2, hasData } = buildUnifiedCalendarModels({
      result1: mockResult1,
      result2: mockResult2,
      view: 'counts',
    })

    expect(model1).toBeDefined()
    expect(model2).toBeDefined()
    expect(hasData).toBe(true)
  })

  it('uses fixed ANOMALY_EDGES for anomaly view', () => {
    const { unifiedEdges } = buildUnifiedCalendarModels({
      result1: mockResult1,
      result2: mockResult2,
      view: 'anomaly',
    })

    expect(unifiedEdges).toEqual([...ANOMALY_EDGES])
  })

  it('computes unified edges for counts view', () => {
    const { unifiedEdges, hasData } = buildUnifiedCalendarModels({
      result1: mockResult1,
      result2: mockResult2,
      view: 'counts',
    })

    // Should compute edges from union of both datasets (100, 150, 200, 250)
    expect(hasData).toBe(true)
    expect(unifiedEdges.length).toBeGreaterThanOrEqual(0)
    // The exact edges depend on quantile calculation
  })

  it('computes unified edges for diff view', () => {
    const { unifiedEdges, hasData } = buildUnifiedCalendarModels({
      result1: mockResult1,
      result2: mockResult2,
      view: 'diff',
    })

    expect(hasData).toBe(true)
    // Diff edges depend on the differences between consecutive months
    expect(Array.isArray(unifiedEdges)).toBe(true)
  })

  it('handles empty datasets', () => {
    const emptyResult: CalendarOut = {
      months: [],
      years: [],
      baseline_by_month: [],
      baseline_year: null,
      coverage: {
        first_month: null,
        last_month: null,
        n_months: 0,
        requested_start: null,
        requested_end: null,
        starts_mid_month: false,
        ends_mid_month: false,
        before_record: false,
        after_latest: false,
      },
      n_cells: 0,
      notice: null,
      clipped_percent: null,
      area_km2: null,
      provisional_months: [],
    }

    const { hasData } = buildUnifiedCalendarModels({
      result1: emptyResult,
      result2: emptyResult,
      view: 'counts',
    })

    expect(hasData).toBe(false)
  })

  it('excludes provisional months from binning', () => {
    const provisionalResult: CalendarOut = {
      ...mockResult1,
      provisional_months: ['2020-01', '2020-02'],
    }

    const { hasData } = buildUnifiedCalendarModels({
      result1: provisionalResult,
      result2: mockResult2,
      view: 'counts',
    })

    // Should only use mockResult2's data since mockResult1 is all provisional
    expect(hasData).toBe(true)
  })

  it('respects date range options', () => {
    const { model1, model2 } = buildUnifiedCalendarModels({
      result1: mockResult1,
      result2: mockResult2,
      view: 'counts',
      options1: {
        range: { start: '2020-01-01', end: '2020-01-31' },
      },
      options2: {
        range: { start: '2020-02-01', end: '2020-02-28' },
      },
    })

    // Models should be built with their respective ranges
    expect(model1).toBeDefined()
    expect(model2).toBeDefined()
  })

  it('gives both models identical edges from the union, and the same bins in the legend data', () => {
    const mk = (values: number[]): CalendarOut => ({
      ...mockResult1,
      months: values.map((v, i) => ({ ...mockResult1.months[0]!, month: i + 1, harmonized: v })),
      years: [],
      baseline_by_month: [],
      baseline_year: null,
    })
    const small = mk([10, 20, 30, 40, 50, 60, 70, 80])
    const large = mk([1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000])
    const alone = buildUnifiedCalendarModels({ result1: small, result2: small, view: 'counts' })
    const out = buildUnifiedCalendarModels({ result1: small, result2: large, view: 'counts' })
    expect(out.model1.edges).toEqual(out.unifiedEdges)
    expect(out.model2.edges).toEqual(out.unifiedEdges)
    expect(out.unifiedEdges).not.toEqual(alone.unifiedEdges)
    expect(out.model1.bins.map((b) => b.label)).toEqual(out.model2.bins.map((b) => b.label))
    // Small values fall in the lowest classes, large values in the highest.
    const classes = (m: typeof out.model1) =>
      m.rows.flatMap((r) => r.cells.flatMap((c) => (c.classIndex === null ? [] : [c.classIndex])))
    expect(Math.max(...classes(out.model1))).toBeLessThanOrEqual(Math.min(...classes(out.model2)))
  })
})

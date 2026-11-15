import { describe, it, expect } from 'vitest'
import { formatWatchBadge } from './watch'
import type { components } from './api.types'

type WatchOut = components['schemas']['WatchOut']

describe('formatWatchBadge', () => {
  it('returns "Not available" with reason when watch is null', () => {
    const result = formatWatchBadge(null)
    expect(result.level).toBe('Not available')
    expect(result.tooltip).toBe('Watch level not available')
  })

  it('returns "Not available" with custom reason when level is null', () => {
    const watch: WatchOut = {
      level: null,
      count: null,
      median: null,
      percentile: null,
      period: null,
      baseline_start: null,
      baseline_end: null,
      n_years: null,
      provisional: null,
      provisional_month: null,
      provisional_count: null,
      reason: 'Fewer than 5 baseline years',
      threshold: null,
    }
    const result = formatWatchBadge(watch)
    expect(result.level).toBe('Not available')
    expect(result.tooltip).toBe('Fewer than 5 baseline years')
  })

  it('formats "Above normal" watch level with full data', () => {
    const watch: WatchOut = {
      level: 'Above normal',
      count: 1234.5,
      median: 890.2,
      percentile: 95.3,
      period: 'November 2026',
      baseline_start: 2000,
      baseline_end: 2025,
      n_years: 26,
      provisional: false,
      provisional_month: null,
      provisional_count: null,
      reason: null,
      threshold: 90,
    }
    const result = formatWatchBadge(watch)
    expect(result.level).toBe('Above normal')
    expect(result.tooltip).toContain('November 2026')
    expect(result.tooltip).toContain('1,234.5 cell-days (MODIS-equivalent)')
    expect(result.tooltip).toContain('baseline median 890.2')
    expect(result.tooltip).toContain('95.3th percentile')
    expect(result.tooltip).toContain('baseline 2000 to 2025 (26 years)')
    expect(result.tooltip).toContain('(above 90th percentile)')
  })

  it('formats "Within normal range" watch level', () => {
    const watch: WatchOut = {
      level: 'Within normal range',
      count: 450.0,
      median: 500.5,
      percentile: 42.0,
      period: 'October 2026',
      baseline_start: 2000,
      baseline_end: 2025,
      n_years: 26,
      provisional: false,
      provisional_month: null,
      provisional_count: null,
      reason: null,
      threshold: 90,
    }
    const result = formatWatchBadge(watch)
    expect(result.level).toBe('Within normal range')
    expect(result.tooltip).toContain('October 2026')
    expect(result.tooltip).toContain('450.0 cell-days (MODIS-equivalent)')
    expect(result.tooltip).toContain('baseline median 500.5')
    expect(result.tooltip).toContain('42.0th percentile')
    expect(result.tooltip).not.toContain('(above')
  })

  it('includes provisional data when present', () => {
    const watch: WatchOut = {
      level: 'Above normal',
      count: 1234.5,
      median: 890.2,
      percentile: 95.3,
      period: 'October 2026',
      baseline_start: 2000,
      baseline_end: 2025,
      n_years: 26,
      provisional: true,
      provisional_month: 'November 2026',
      provisional_count: 567.8,
      reason: null,
      threshold: 90,
    }
    const result = formatWatchBadge(watch)
    expect(result.tooltip).toContain(
      'Provisional: November 2026 to date 567.8 cell-days (MODIS-equivalent)',
    )
  })

  it('handles missing optional fields gracefully', () => {
    const watch: WatchOut = {
      level: 'Within normal range',
      count: 450.0,
      median: null,
      percentile: null,
      period: 'October 2026',
      baseline_start: null,
      baseline_end: null,
      n_years: null,
      provisional: false,
      provisional_month: null,
      provisional_count: null,
      reason: null,
      threshold: null,
    }
    const result = formatWatchBadge(watch)
    expect(result.level).toBe('Within normal range')
    expect(result.tooltip).toContain('October 2026')
    expect(result.tooltip).toContain('450.0 cell-days (MODIS-equivalent)')
    expect(result.tooltip).not.toContain('baseline median')
    expect(result.tooltip).not.toContain('percentile')
  })

  it('handles zero count', () => {
    const watch: WatchOut = {
      level: 'Within normal range',
      count: 0,
      median: 0,
      percentile: 50.0,
      period: 'October 2026',
      baseline_start: 2000,
      baseline_end: 2025,
      n_years: 26,
      provisional: false,
      provisional_month: null,
      provisional_count: null,
      reason: null,
      threshold: 90,
    }
    const result = formatWatchBadge(watch)
    expect(result.tooltip).toContain('0.0 cell-days (MODIS-equivalent)')
    expect(result.tooltip).toContain('baseline median 0.0')
  })

  it('formats count with one decimal place', () => {
    const watch: WatchOut = {
      level: 'Above normal',
      count: 1234.567,
      median: 890.234,
      percentile: 95.678,
      period: 'November 2026',
      baseline_start: 2000,
      baseline_end: 2025,
      n_years: 26,
      provisional: false,
      provisional_month: null,
      provisional_count: null,
      reason: null,
      threshold: 90,
    }
    const result = formatWatchBadge(watch)
    // formatCount rounds to 1 decimal
    expect(result.tooltip).toContain('1,234.6')
    expect(result.tooltip).toContain('890.2')
    expect(result.tooltip).toContain('95.7')
  })

  it('handles "Not available" with reason in tooltip', () => {
    const watch: WatchOut = {
      level: 'Not available',
      count: null,
      median: null,
      percentile: null,
      period: null,
      baseline_start: null,
      baseline_end: null,
      n_years: null,
      provisional: null,
      provisional_month: null,
      provisional_count: null,
      reason: 'Empty series for this area',
      threshold: null,
    }
    const result = formatWatchBadge(watch)
    expect(result.level).toBe('Not available')
    expect(result.tooltip).toBe('Empty series for this area')
  })

  it('falls back to level when tooltip parts are empty', () => {
    const watch: WatchOut = {
      level: 'Within normal range',
      count: null,
      median: null,
      percentile: null,
      period: null,
      baseline_start: null,
      baseline_end: null,
      n_years: null,
      provisional: false,
      provisional_month: null,
      provisional_count: null,
      reason: null,
      threshold: null,
    }
    const result = formatWatchBadge(watch)
    expect(result.tooltip).toBe('Within normal range')
  })
})

import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import { ApiError } from '@/lib/api'
import { month, result } from '@/lib/binning.fixtures'
import {
  DataUnavailable,
  EmptyState,
  ErrorCard,
  LoadingIndicator,
  UpdatingLabel,
} from './ResultStates'
import { isDataUnavailable } from './dataUnavailable'
import { isEmptyResult, summaryTotals } from './resultsSummary'
import { StatusAnnouncer } from './StatusAnnouncer'
import { announcementFor } from './statusMessages'
import { SummaryCards } from './SummaryCards'
import { useResultsStatus, type ResultsStatusInput } from './useResultsStatus'

// Synthetic test values. TEST FIXTURE, not NASA data.
const months = [
  month(2011, 12, 10.25, { raw_modis: 7, raw_viirs: 0 }),
  month(2012, 1, 1200.5, { raw_modis: 1000, raw_viirs: 300 }),
  month(2012, 2, 5, { raw_modis: 4, raw_viirs: 2, provisional: true }),
]

function text(testId: string): string {
  return screen.getByTestId(testId).textContent
}

describe('SummaryCards', () => {
  it('shows harmonized, raw MODIS and raw VIIRS as three separate values with units', () => {
    render(<SummaryCards result={result(months, ['2012-02'])} />)
    expect(text('card-harmonized')).toContain('1,215.8')
    expect(text('card-harmonized')).toContain('cell-days (MODIS-equivalent)')
    expect(text('card-harmonized')).toContain('February 2012 to date (provisional)')
    expect(text('card-raw-modis')).toContain('1,011')
    expect(text('card-raw-viirs')).toContain('302')
    expect(text('card-raw-modis')).toContain('cell-days (raw)')
    // Raw values are never added together.
    expect(document.body.textContent).not.toContain('1,313')
  })

  it('shows 0 in all three cards for a Query with zero cell-days', () => {
    render(<SummaryCards result={result([month(2012, 1, 0)])} />)
    expect(text('card-harmonized')).toContain('0.0')
    expect(text('card-raw-modis')).toBe('Raw MODIS0cell-days (raw)')
    expect(text('card-raw-viirs')).toBe('Raw VIIRS0cell-days (raw)')
  })

  it('has no axe violations', async () => {
    const { container } = render(<SummaryCards result={result(months)} />)
    expect(await axe(container)).toHaveNoViolations()
  })

  it('displays the WatchBadge when watch data is provided', () => {
    const watch = {
      level: 'Above normal' as const,
      period: 'November 2026',
      count: 125.5,
      median: 50.0,
      percentile: 92.5,
      threshold: 90,
      baseline_start: 2000,
      baseline_end: 2025,
      n_years: 25,
      provisional: false,
      provisional_month: null,
      provisional_count: null,
      reason: null,
    }
    render(<SummaryCards result={result(months)} watch={watch} />)
    // Badge should appear with "Above normal" text
    expect(screen.getByText('Above normal')).toBeTruthy()
  })

  it('does not display the WatchBadge when watch data is not provided', () => {
    render(<SummaryCards result={result(months)} />)
    // Badge should not appear
    expect(screen.queryByText('Above normal')).toBeNull()
    expect(screen.queryByText('Within normal range')).toBeNull()
    expect(screen.queryByText('Not available')).toBeNull()
  })
})

describe('resultsSummary and dataUnavailable', () => {
  it('sums months and lists provisional months', () => {
    const t = summaryTotals(result(months))
    expect(t.rawModis).toBe(1011)
    expect(t.provisionalMonths).toEqual(['2012-02'])
  })

  it('treats no months or all-zero months as empty', () => {
    expect(isEmptyResult(result([]))).toBe(true)
    expect(isEmptyResult(result([month(2012, 1, 0)]))).toBe(true)
    expect(isEmptyResult(result(months))).toBe(false)
  })

  it('recognises a 503 HTTP error only', () => {
    const make = (status: number) => new ApiError({ kind: 'http', status, code: 'x', message: 'm' })
    expect(isDataUnavailable(make(503))).toBe(true)
    expect(isDataUnavailable(make(500))).toBe(false)
    expect(isDataUnavailable(new Error('x'))).toBe(false)
  })
})

describe('result state components', () => {
  it('EmptyState names the area and the range and suggests widening', () => {
    render(<EmptyState area="Drawn area" start="2020-01-01" end="2020-03-31" />)
    const t = text('empty-state')
    expect(t).toContain('Drawn area')
    expect(t).toContain('2020-01-01 to 2020-03-31 (local standard time, UTC-8)')
    expect(t).toContain('larger area or a longer date range')
  })

  it('EmptyState defaults to "California region", never "California state"', () => {
    render(<EmptyState start="2020-01-01" end="2020-03-31" />)
    expect(text('empty-state')).toContain('California region')
    expect(document.body.textContent).not.toContain('California state')
  })

  it('ErrorCard says what failed and Retry calls back', () => {
    const onRetry = vi.fn()
    const error = new ApiError({
      kind: 'timeout',
      code: 'timeout',
      message: 'The request timed out after 30 seconds.',
    })
    render(<ErrorCard error={error} onRetry={onRetry} />)
    expect(text('error-card')).toContain('The request timed out')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('ErrorCard shows a generic failure for unknown errors', () => {
    render(<ErrorCard error={new Error('boom')} onRetry={() => undefined} />)
    expect(text('error-card')).toContain('The request failed')
    expect(text('error-card')).not.toContain('boom')
  })

  it('UpdatingLabel shows Updating, Not updated, or nothing', () => {
    const { rerender } = render(<UpdatingLabel state="updating" />)
    expect(text('updating-label')).toBe('Updating')
    rerender(<UpdatingLabel state="not_updated" />)
    expect(text('updating-label')).toBe('Not updated')
    rerender(<UpdatingLabel state="idle" />)
    expect(screen.queryByTestId('updating-label')).toBeNull()
  })

  it('DataUnavailable is a full page with the "Data not available" heading', () => {
    render(<DataUnavailable onRetry={() => undefined} />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Data not available')
    expect(screen.getByRole('main')).toBeTruthy()
  })

  it('has no axe violations in any state', async () => {
    const { container } = render(
      <div>
        <LoadingIndicator />
        <EmptyState start="2020-01-01" end="2020-03-31" />
        <ErrorCard error={new Error('x')} onRetry={() => undefined} />
        <StatusAnnouncer message="Results updated." />
      </div>,
    )
    expect(await axe(container)).toHaveNoViolations()
    const full = render(<DataUnavailable />)
    expect(await axe(full.container)).toHaveNoViolations()
  })
})

describe('StatusAnnouncer', () => {
  it('is a polite live region and does not take focus', () => {
    const before = document.activeElement
    render(<StatusAnnouncer message="Loading results." />)
    const region = screen.getByRole('status')
    expect(region.getAttribute('aria-live')).toBe('polite')
    expect(region.textContent).toBe('Loading results.')
    expect(region.hasAttribute('tabindex')).toBe(false)
    expect(document.activeElement).toBe(before)
  })
})

describe('announcementFor', () => {
  it('announces start and end only for visible phases', () => {
    expect(announcementFor('ready', 'pending')).toBeNull()
    expect(announcementFor('pending', 'ready')).toBeNull()
    expect(announcementFor('ready', 'updating')).toContain('Updating')
    expect(announcementFor('updating', 'ready')).toBe('Results updated.')
    expect(announcementFor('loading', 'error')).toContain('failed')
  })
})

describe('useResultsStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const base: ResultsStatusInput = {
    isPlaceholderData: false,
    isFetching: false,
    isError: false,
    hasData: true,
  }

  it('shows the loading indicator only after 300 ms of a first load', () => {
    const { result: hook, rerender } = renderHook((p: ResultsStatusInput) => useResultsStatus(p), {
      initialProps: { ...base, isFetching: true, hasData: false },
    })
    expect(hook.current.showLoading).toBe(false)
    act(() => {
      vi.advanceTimersByTime(299)
    })
    expect(hook.current.showLoading).toBe(false)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(hook.current.showLoading).toBe(true)
    expect(hook.current.announcement).toBe('Loading results.')
    rerender({ ...base })
    expect(hook.current.showLoading).toBe(false)
    expect(hook.current.announcement).toBe('Results updated.')
  })

  it('goes idle, updating, idle while old results are held, and announces both changes', () => {
    const { result: hook, rerender } = renderHook((p: ResultsStatusInput) => useResultsStatus(p), {
      initialProps: base,
    })
    rerender({ ...base, isFetching: true, isPlaceholderData: true })
    expect(hook.current.updating).toBe('idle')
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(hook.current.updating).toBe('updating')
    expect(hook.current.showLoading).toBe(false)
    expect(hook.current.announcement).toContain('Updating')
    rerender({ ...base })
    expect(hook.current.updating).toBe('idle')
    expect(hook.current.announcement).toBe('Results updated.')
  })

  it('stays silent when the fetch ends before 300 ms', () => {
    const { result: hook, rerender } = renderHook((p: ResultsStatusInput) => useResultsStatus(p), {
      initialProps: base,
    })
    rerender({ ...base, isFetching: true, isPlaceholderData: true })
    act(() => {
      vi.advanceTimersByTime(100)
    })
    rerender({ ...base })
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(hook.current.updating).toBe('idle')
    expect(hook.current.announcement).toBe('')
  })

  it('reports not_updated and announces the failure', () => {
    const { result: hook, rerender } = renderHook((p: ResultsStatusInput) => useResultsStatus(p), {
      initialProps: { ...base, isFetching: true, isPlaceholderData: true },
    })
    rerender({ ...base, isError: true, hasData: false })
    expect(hook.current.updating).toBe('not_updated')
    expect(hook.current.announcement).toContain('failed')
  })
})

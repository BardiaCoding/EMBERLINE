import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import type { StatsSlot } from '@/features/charts/chartTypes'
import { buildCalendarModel } from '@/lib/binning'
import { month, result } from '@/lib/binning.fixtures'
import { ApiError } from '@/lib/api'
import type { CalendarData } from '@/lib/queries'
import { ResultsPanel } from './ResultsPanel'
import { useResultsStatus } from './useResultsStatus'

// Requirements 28.5 to 28.10, design.md section 11.2. Synthetic values, TEST FIXTURE, not NASA data.

vi.mock('@/features/charts/EChartCanvas', () => ({
  default: () => <div role="group" aria-label="stub chart" tabIndex={0} />,
}))

const tokensCss = readFileSync(path.resolve(import.meta.dirname, '../../styles/tokens.css'), 'utf8')

/** Body of the first rule block that starts with `selector {`, braces not nested. */
function block(selector: string): string {
  const start = tokensCss.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`no block ${selector}`)
  return tokensCss.slice(start, tokensCss.indexOf('}', start))
}
/** Greyscale `oklch(L 0 0)` token to relative luminance (linear sRGB of a grey equals L^3). */
function luminance(css: string, name: string): number {
  const m = new RegExp(`${name}:\\s*oklch\\(([\\d.]+) 0 0\\)`).exec(css)
  if (m === null) throw new Error(`token ${name} not greyscale or missing`)
  return Number(m[1]) ** 3
}
function ratio(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

describe('dimmed tokens', () => {
  const sets: [string, string][] = [
    ['light', block(':root')],
    ['dark', block(':root.dark')],
    ['dark (OS preference)', block(':root:not(.light):not(.dark)')],
  ]
  it.each(sets)('%s: text keeps 4.5:1 on background, card and muted', (_name, css) => {
    for (const fg of ['foreground-dim', 'muted-foreground-dim']) {
      for (const bg of ['background', 'card', 'muted']) {
        expect(ratio(luminance(css, `--${fg}`), luminance(css, `--${bg}`))).toBeGreaterThanOrEqual(
          4.5,
        )
      }
    }
  })

  it('dims through scoped token overrides and not opacity', () => {
    const rule = block("[data-updating='true']")
    expect(rule).toContain('--foreground: var(--foreground-dim)')
    expect(rule).toContain('--muted-foreground: var(--muted-foreground-dim)')
    expect(rule).not.toContain('opacity')
  })
})

const range = { start: '2002-01-01', end: '2003-12-31' }
const calendarResult = result([month(2002, 7, 120.5, { raw_modis: 100 }), month(2003, 12, 33)])
const calendar: CalendarData = { range, result: calendarResult }
const model = buildCalendarModel(calendarResult, 'counts', {
  range,
  recordStart: '2000-11',
  latestMonth: '2003-12',
})
const stats: StatsSlot = { data: undefined, isError: false, error: null, onRetry: () => undefined }

type Flags = { isPlaceholderData: boolean; isFetching: boolean; isError: boolean }
const onRetry = vi.fn()

function Harness(flags: Flags) {
  const status = useResultsStatus({ ...flags, hasData: true })
  return (
    <>
      <button type="button">Control</button>
      <ResultsPanel
        status={status}
        loadError={
          flags.isError
            ? {
                error: new ApiError({
                  kind: 'network',
                  message: 'Network down',
                  code: 'network_error',
                }),
                onRetry,
              }
            : null
        }
        calendar={flags.isError ? undefined : calendar}
        model={flags.isError ? null : model}
        stats={stats}
        areaLabel="California region"
        view="counts"
        onViewChange={() => undefined}
      />
    </>
  )
}
const idleFlags: Flags = { isPlaceholderData: false, isFetching: false, isError: false }
const fetching: Flags = { isPlaceholderData: true, isFetching: true, isError: false }

describe('axe', () => {
  const statusOf = (updating: 'updating' | 'not_updated') => ({
    updating,
    showLoading: false,
    phase: 'updating' as const,
    announcement: 'Updating results.',
  })
  it.each(['updating', 'not_updated'] as const)('has no violations while %s', async (state) => {
    const { container } = render(
      <ResultsPanel
        status={statusOf(state)}
        loadError={null}
        calendar={calendar}
        model={model}
        stats={stats}
        areaLabel="California region"
        view="counts"
        onViewChange={() => undefined}
      />,
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('Updating and Not updated states', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('waits 300 ms, then marks the panel busy and dimmed with the label above the data', () => {
    const { rerender } = render(<Harness {...idleFlags} />)
    rerender(<Harness {...fetching} />)
    act(() => {
      vi.advanceTimersByTime(299)
    })
    const panel = screen.getByTestId('results-panel')
    expect(screen.queryByTestId('updating-label')).toBeNull()
    expect(panel.getAttribute('data-updating')).toBeNull()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(panel.getAttribute('aria-busy')).toBe('true')
    expect(panel.getAttribute('data-updating')).toBe('true')
    const label = screen.getByTestId('updating-label')
    expect(label.textContent).toBe('Updating')
    expect(label.className).not.toMatch(/absolute|fixed|opacity/)
    expect(panel.className).not.toMatch(/opacity/)
    // The label comes before the results in document order and is not inside them.
    expect(screen.getByRole('tabpanel').contains(label)).toBe(false)
    expect(label.compareDocumentPosition(screen.getByRole('tabpanel'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(screen.getByRole('status').textContent).toContain('Updating results')

    rerender(<Harness {...idleFlags} />)
    expect(panel.getAttribute('aria-busy')).toBe('false')
    expect(panel.getAttribute('data-updating')).toBeNull()
    expect(screen.queryByTestId('updating-label')).toBeNull()
    expect(screen.getByRole('status').textContent).toBe('Results updated.')
  })

  it('does not move focus when updating starts or ends', () => {
    const { rerender } = render(<Harness {...idleFlags} />)
    const control = screen.getByRole('button', { name: 'Control' })
    control.focus()
    rerender(<Harness {...fetching} />)
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(document.activeElement).toBe(control)
    rerender(<Harness {...idleFlags} />)
    expect(document.activeElement).toBe(control)
  })

  it('shows Not updated with the error card and a working Retry', async () => {
    onRetry.mockClear()
    const { rerender } = render(<Harness {...idleFlags} />)
    rerender(<Harness {...fetching} />)
    act(() => {
      vi.advanceTimersByTime(300)
    })
    rerender(<Harness isPlaceholderData={false} isFetching={false} isError />)
    const panel = screen.getByTestId('results-panel')
    expect(screen.getByTestId('updating-label').textContent).toBe('Not updated')
    expect(panel.getAttribute('aria-busy')).toBe('false')
    expect(panel.getAttribute('data-updating')).toBeNull()
    expect(screen.getByTestId('error-card')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('failed')

    vi.useRealTimers()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import type { StatsSlot } from '@/features/charts/chartTypes'
import { buildCalendarModel } from '@/lib/binning'
import { month, result } from '@/lib/binning.fixtures'
import type { CalendarData } from '@/lib/queries'
import { currentMonth, currentYear, statsResult, yearRow } from '@/lib/stats.fixtures'
import { RESULTS_ABOVE_CALENDAR_VAR } from './useResultsAboveCalendar'
import { ResultsPanel } from './ResultsPanel'
import type { ResultsStatus } from './useResultsStatus'

// The ECharts canvas needs a browser: the stub shows that a chart was asked for.
vi.mock('@/features/charts/EChartCanvas', () => ({
  default: () => <div role="group" aria-label="stub chart" tabIndex={0} data-testid="echart" />,
}))

// The season tracker has its own tests (it needs the API).
vi.mock('@/features/season/SeasonTracker', () => ({
  SeasonTracker: (props: { baselineYears?: [number, number] | null }) => (
    <div data-testid="season-tracker" data-baseline={JSON.stringify(props.baselineYears ?? null)} />
  ),
}))
// Synthetic values. TEST FIXTURE, not NASA data.
const range = { start: '2002-01-01', end: '2003-12-31' }
const calendarResult = {
  ...result([
    month(2002, 7, 120.5, { raw_modis: 100 }),
    month(2002, 8, 0),
    month(2003, 12, 33, { raw_modis: 30 }),
  ]),
  years: [yearRow(2002, 120.5), yearRow(2003, 33)],
}
const calendar: CalendarData = { range, result: calendarResult }
const model = buildCalendarModel(calendarResult, 'counts', {
  range,
  recordStart: '2000-11',
  latestMonth: '2003-12',
})
const idle: ResultsStatus = {
  updating: 'idle',
  showLoading: false,
  phase: 'ready',
  announcement: '',
}
const stats: StatsSlot = {
  data: statsResult({
    summary: {
      total_harmonized: 153.5,
      raw_modis: 130,
      raw_viirs: 0,
      frp_sum_mw: null,
      n_months: 3,
      includes_provisional: false,
    },
    current_month: currentMonth(),
    current_year: currentYear(),
  }),
  isError: false,
  error: null,
  onRetry: () => undefined,
}

function panel(props: Partial<Parameters<typeof ResultsPanel>[0]> = {}) {
  return (
    <ResultsPanel
      status={idle}
      loadError={null}
      calendar={calendar}
      model={model}
      stats={stats}
      areaLabel="California region"
      view="counts"
      onViewChange={() => undefined}
      {...props}
    />
  )
}

describe('ResultsPanel', () => {
  it('shows the summary cards, the month and year cards, the tabs and the Calendar', () => {
    render(panel())
    expect(screen.getByTestId('card-harmonized').textContent).toContain('153.5')
    expect(screen.getByTestId('card-current-month').textContent).toContain('December 2003')
    expect(screen.getByTestId('card-current-year').textContent).toContain('2003')
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Calendar', 'Trends', 'Season', 'Recent'])
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('region', { name: 'Burning activity calendar' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Calendar view' })).toBeTruthy()
    const tabpanel = screen.getByRole('tabpanel')
    expect(tabpanel.getAttribute('aria-labelledby')).toBe(tabs[0]?.id)
  })

  it('publishes the space above the Calendar so the Calendar region height works', () => {
    render(panel())
    const root = screen.getByTestId('results-panel')
    expect(root.style.getPropertyValue(RESULTS_ABOVE_CALENDAR_VAR)).toMatch(/^\d+px$/)
  })

  it('shows the chart tabs on demand and hides the Calendar view switch there', async () => {
    const user = userEvent.setup()
    render(panel())
    expect(screen.queryByTestId('echart')).toBeNull()
    await user.click(screen.getByRole('tab', { name: 'Trends' }))
    expect(await screen.findByRole('region', { name: 'Harmonized count by year' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Trends' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByRole('group', { name: 'Calendar view' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Burning activity calendar' })).toBeNull()
    // The cards stay above the tabs.
    expect(screen.getByTestId('card-harmonized')).toBeTruthy()

    await user.click(screen.getByRole('tab', { name: 'Season' }))
    expect(await screen.findByRole('region', { name: 'Seasonal profile' })).toBeTruthy()
  })

  it('mounts the season tracker on the Season tab with the applied baseline', async () => {
    render(panel({ baselineYears: [2005, 2014] }))
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Season' }))
    const tracker = await screen.findByTestId('season-tracker')
    expect(tracker.getAttribute('data-baseline')).toBe('[2005,2014]')
  })

  it('moves between tabs with the arrow keys, Home and End, with one tab stop', async () => {
    const user = userEvent.setup()
    render(panel())
    const [calendarTab, trendsTab, , seasonTab] = screen.getAllByRole('tab') // the last tab is Recent
    expect(calendarTab?.getAttribute('tabindex')).toBe('0')
    expect(trendsTab?.getAttribute('tabindex')).toBe('-1')
    calendarTab?.focus()
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(trendsTab)
    expect(trendsTab?.getAttribute('aria-selected')).toBe('true')
    await user.keyboard('{End}')
    expect(document.activeElement).toBe(seasonTab)
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(calendarTab)
    await user.keyboard('{ArrowLeft}')
    expect(document.activeElement).toBe(seasonTab)
    await user.keyboard('{Home}')
    expect(document.activeElement).toBe(calendarTab)
  })

  it('shows a loading note for the current month and year while stats load, and the Calendar anyway', () => {
    render(panel({ stats: { ...stats, data: undefined } }))
    expect(screen.getByTestId('stats-loading')).toBeTruthy()
    expect(screen.queryByTestId('card-current-month')).toBeNull()
    expect(screen.getByRole('region', { name: 'Burning activity calendar' })).toBeTruthy()
  })

  it('shows a stats error with Retry without hiding the Calendar', async () => {
    const onRetry = vi.fn()
    render(panel({ stats: { data: undefined, isError: true, error: new Error('x'), onRetry } }))
    const note = screen.getByTestId('stats-error')
    await userEvent.setup().click(within(note).getByRole('button', { name: 'Retry key figures' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('region', { name: 'Burning activity calendar' })).toBeTruthy()
  })

  it('shows the empty state, with no tabs, for a Query with zero cell-days', () => {
    const emptyResult = result([month(2002, 7, 0)])
    render(
      panel({
        calendar: { range, result: emptyResult },
        model: buildCalendarModel(emptyResult, 'counts', {
          range,
          recordStart: '2000-11',
          latestMonth: '2003-12',
        }),
      }),
    )
    expect(screen.getByTestId('empty-state').textContent).toContain('California region')
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('shows the error card in place of the results, and the loading indicator for a first load', async () => {
    const onRetry = vi.fn()
    const { rerender } = render(
      panel({ loadError: { error: new Error('x'), onRetry }, calendar: undefined, model: null }),
    )
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('tablist')).toBeNull()
    rerender(panel({ status: { ...idle, showLoading: true }, calendar: undefined, model: null }))
    expect(screen.getByTestId('loading-indicator')).toBeTruthy()
  })

  it('marks the panel busy and shows the Updating label while old results are held', () => {
    render(panel({ status: { ...idle, updating: 'updating' } }))
    expect(screen.getByTestId('results-panel').getAttribute('aria-busy')).toBe('true')
    expect(screen.getByTestId('updating-label').textContent).toBe('Updating')
  })

  it('has no axe violations on the Calendar tab and on a chart tab', async () => {
    const user = userEvent.setup()
    const { container } = render(panel())
    expect(await axe(container)).toHaveNoViolations()
    await user.click(screen.getByRole('tab', { name: 'Trends' }))
    await screen.findByRole('region', { name: 'Harmonized count by year' })
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('month filter chip', () => {
  it('shows no chip without a selected month', () => {
    render(panel())
    expect(screen.queryByTestId('month-filter-chip')).toBeNull()
  })
  it('shows "Filtered to {Month} {Year}" and a Clear filter button that calls onClearMonth', async () => {
    const onClearMonth = vi.fn()
    render(panel({ selectedMonth: '2002-07', onClearMonth }))
    const chip = screen.getByTestId('month-filter-chip')
    expect(chip.textContent).toContain('Filtered to July 2002')
    await userEvent.click(within(chip).getByRole('button', { name: 'Clear filter' }))
    expect(onClearMonth).toHaveBeenCalledOnce()
  })
  it('passes a clicked Calendar cell to onSelectMonth', async () => {
    const onSelectMonth = vi.fn()
    render(panel({ onSelectMonth }))
    const cell = document.querySelector('[data-key="2002-07"]') as HTMLElement
    await userEvent.click(cell)
    expect(onSelectMonth).toHaveBeenCalledWith('2002-07')
  })
})

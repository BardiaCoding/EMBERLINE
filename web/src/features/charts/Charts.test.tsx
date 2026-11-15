import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import type { CalendarOut } from '@/lib/api'
import { anomaly, month, result } from '@/lib/binning.fixtures'
import {
  currentMonth,
  currentYear,
  seasonalPoint,
  statsResult,
  yearRow,
} from '@/lib/stats.fixtures'
import type { ChartQuery, StatsSlot } from './chartTypes'
import SeasonTab from './SeasonTab'
import TrendsTab from './TrendsTab'

// The ECharts canvas needs a browser. The stub shows the option it was given.
// The season tracker has its own tests (it needs the API).
vi.mock('@/features/season/SeasonTracker', () => ({
  SeasonTracker: (props: { baselineYears?: [number, number] | null }) => (
    <div data-testid="season-tracker" data-baseline={JSON.stringify(props.baselineYears ?? null)} />
  ),
}))
type StubProps = { option: unknown; pointLabels?: string[]; titleId?: string; summaryId?: string }
vi.mock('./EChartCanvas', () => ({
  default: (props: StubProps) => (
    <div
      role="group"
      aria-labelledby={props.titleId}
      aria-describedby={props.summaryId}
      tabIndex={0}
      data-testid="echart"
      data-option={JSON.stringify(props.option)}
      data-labels={JSON.stringify(props.pointLabels ?? [])}
    />
  ),
}))

// Synthetic values. TEST FIXTURE, not NASA data.
const months = [
  month(2002, 7, 120.5, { raw_modis: 100, anomaly: anomaly(110.5, 1000) }),
  month(2002, 8, 0, { anomaly: anomaly(-9, -100) }),
  month(2003, 11, 40, { anomaly: anomaly(20, 100) }),
  month(2003, 12, 33, { provisional: true, raw_modis: 30 }),
]
const calendar: CalendarOut = {
  ...result(months, ['2003-12']),
  years: [yearRow(2002, 120.5), yearRow(2003, 73, { n_months: 12, provisional: true })],
  baseline_year: { median: 100, p10: 10, p90: 200, mean: 110, std: 5, n_years: 20 },
}
const query: ChartQuery = {
  calendar,
  range: { start: '2002-01-01', end: '2003-12-31' },
  area: 'California region',
}
const stats = statsResult({
  summary: {
    total_harmonized: 193.5,
    raw_modis: 130,
    raw_viirs: 0,
    frp_sum_mw: null,
    n_months: 4,
    includes_provisional: true,
  },
  current_month: currentMonth({ provisional: true }),
  current_year: currentYear({ provisional: true }),
  top_months: [
    { year: 2002, month: 7, harmonized: 120.5 },
    { year: 2003, month: 11, harmonized: 40 },
  ],
  top_years: [{ year: 2002, harmonized: 120.5, n_months: 12 }],
  seasonal_profile: Array.from({ length: 12 }, (_, i) => seasonalPoint(i + 1, 10 + i)),
  provisional_months: ['2003-12'],
})
const ready: StatsSlot = { data: stats, isError: false, error: null, onRetry: () => undefined }
const loading: StatsSlot = {
  data: undefined,
  isError: false,
  error: null,
  onRetry: () => undefined,
}

function optionOf(chart: HTMLElement): { series: { name: string; data: unknown[] }[] } {
  return JSON.parse(chart.dataset.option ?? '{}') as { series: { name: string; data: unknown[] }[] }
}

describe('TrendsTab', () => {
  it('shows yearly bars, the anomaly series and the rankings, each in a frame with a summary', async () => {
    render(<TrendsTab {...query} stats={ready} />)
    // The chart code is loaded on demand.
    await screen.findAllByTestId('echart')
    const yearly = screen.getByRole('region', { name: 'Harmonized count by year' })
    const anomalySeries = screen.getByRole('region', { name: 'Monthly anomaly' })
    screen.getByRole('region', { name: 'Top months and years' })
    // Unit and time convention under the title.
    expect(yearly.textContent).toContain('cell-days (MODIS-equivalent), local standard time, UTC-8')
    // The text summary names total and highest complete month, and the provisional note.
    const summary = within(yearly).getByText(/Total harmonized count/)
    expect(summary.textContent).toContain('193.5 cell-days (MODIS-equivalent)')
    expect(summary.textContent).toContain('Highest month: July 2002 with 120.5')
    expect(summary.textContent).toContain('December 2003')
    expect(summary.textContent).toContain('not a full year')
    // The provisional year is a separate dashed series, not a complete bar.
    const bars = optionOf(within(yearly).getByTestId('echart'))
    expect(bars.series[0]?.data).toEqual([120.5, null])
    expect(bars.series[1]?.data).toEqual([null, 73])
    // The anomaly series has a gap for the provisional month.
    const anomalyOption = optionOf(within(anomalySeries).getByTestId('echart'))
    expect(anomalyOption.series[0]?.data).toEqual([110.5, -9, 20, null])
  })

  it('lists the top months and years in the order the API gives, with a note on the provisional month', () => {
    render(<TrendsTab {...query} stats={ready} />)
    const months = within(screen.getByTestId('top-months')).getAllByRole('listitem')
    expect(months.map((li) => li.textContent)).toEqual(['July 2002: 120.5', 'November 2003: 40.0'])
    expect(within(screen.getByTestId('top-years')).getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByTestId('chart-rankings').textContent).toContain(
      'The provisional month and its year are left out',
    )
  })

  it('gives each chart a data table with signs and statuses', async () => {
    const user = userEvent.setup()
    render(<TrendsTab {...query} stats={ready} />)
    const links = screen.getAllByRole('link', { name: 'View table' })
    expect(links).toHaveLength(2)
    await user.click(links[1] as HTMLElement)
    const table = screen.getByRole('table', { name: /Monthly anomaly against the baseline median/ })
    expect(within(table).getByRole('cell', { name: '+110.5' })).toBeTruthy()
    expect(within(table).getByRole('cell', { name: '-9.0' })).toBeTruthy()
    expect(
      within(table).getByRole('cell', { name: /Provisional \(count to date, no anomaly\)/ }),
    ).toBeTruthy()
  })

  it('shows loading states for the rankings while stats are missing, and an error with Retry', async () => {
    const onRetry = vi.fn()
    const { rerender } = render(<TrendsTab {...query} stats={loading} />)
    expect(within(screen.getByTestId('chart-rankings')).getByTestId('chart-loading')).toBeTruthy()
    // The charts that need only the Calendar result are still drawn.
    expect(await screen.findAllByTestId('echart')).toHaveLength(2)
    rerender(<TrendsTab {...query} stats={{ ...loading, isError: true, onRetry }} />)
    const frame = screen.getByTestId('chart-rankings')
    await userEvent.setup().click(within(frame).getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('has no axe violations', async () => {
    const { container } = render(<TrendsTab {...query} stats={ready} />)
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('SeasonTab', () => {
  it('overlays the year that contains the end of the range and lets the user pick another year', async () => {
    const user = userEvent.setup()
    render(<SeasonTab {...query} stats={ready} />)
    await screen.findByTestId('echart')
    const select = screen.getByRole<HTMLSelectElement>('combobox', {
      name: 'Year shown over the baseline',
    })
    expect(select.value).toBe('2003')
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['2002', '2003'])
    let option = optionOf(screen.getByTestId('echart'))
    expect(option.series.map((s) => s.name)).toContain('Year 2003')
    expect(option.series.map((s) => s.name)).toContain('December 2003 to date (provisional)')

    await user.selectOptions(select, '2002')
    option = optionOf(screen.getByTestId('echart'))
    expect(option.series.map((s) => s.name)).toContain('Year 2002')
    expect(option.series.map((s) => s.name)).not.toContain('December 2003 to date (provisional)')
    expect(option.series.find((s) => s.name === 'Year 2002')?.data[6]).toBe(120.5)
  })

  it('shows loading and error states without the chart while the baseline is missing', () => {
    const { rerender } = render(<SeasonTab {...query} stats={loading} />)
    expect(screen.getByTestId('chart-loading')).toBeTruthy()
    expect(screen.queryByTestId('echart')).toBeNull()
    rerender(<SeasonTab {...query} stats={{ ...loading, isError: true }} />)
    expect(screen.getByTestId('chart-error')).toBeTruthy()
  })

  it('has a table with the baseline and the selected year, and no axe violations', async () => {
    const user = userEvent.setup()
    const { container } = render(<SeasonTab {...query} stats={ready} />)
    await user.click(screen.getByRole('link', { name: 'View table' }))
    const table = screen.getByRole('table', { name: /Seasonal profile/ })
    expect(within(table).getAllByRole('row')).toHaveLength(13)
    expect(await axe(container)).toHaveNoViolations()
  })
})

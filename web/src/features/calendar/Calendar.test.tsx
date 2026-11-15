import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { axe } from 'vitest-axe'
import { buildCalendarModel } from '@/lib/binning'
import { anomaly, month, result } from '@/lib/binning.fixtures'
import { CalendarGrid } from './CalendarGrid'
import { CalendarLegend } from './CalendarLegend'
import { CalendarTable } from './CalendarTable'
import { CalendarViewSwitch } from './CalendarViewSwitch'

// Radix popper measures with ResizeObserver, which jsdom does not have.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

// Synthetic test values. TEST FIXTURE, not NASA data.
const months = [
  month(2011, 12, 0),
  month(2012, 1, 12.5),
  month(2012, 2, 40),
  month(2012, 3, 3),
  month(2012, 4, 250.4, { provisional: true }),
]
const model = buildCalendarModel(result(months, ['2012-04']), 'counts', {
  range: { start: '2011-12-15', end: '2012-06-30' },
  recordStart: '2000-11',
  latestMonth: '2012-04',
})

describe('CalendarGrid', () => {
  it('is a labelled scroll region with an ARIA grid of years and months', () => {
    render(<CalendarGrid model={model} />)
    const region = screen.getByRole('region', { name: 'Burning activity calendar' })
    expect(region.getAttribute('tabindex')).toBe('0')
    expect(region.className).toContain('overflow-auto')
    const grid = within(region).getByRole('grid')
    expect(within(grid).getAllByRole('columnheader')).toHaveLength(14)
    // header + 2 year rows (2012, 2011) + baseline median row
    expect(within(grid).getAllByRole('row')).toHaveLength(4)
    const rowheaders = within(grid)
      .getAllByRole('rowheader')
      .map((h) => h.textContent)
    expect(rowheaders).toEqual(['2012', '2011', 'Baseline median'])
    expect(within(grid).getAllByRole('gridcell', { name: /^[A-Z][a-z]+ \d{4}:/ })).toHaveLength(24)
  })

  it('shows no_data as hatched, zero as a value, and a total per year', () => {
    render(<CalendarGrid model={model} />)
    const none = screen.getByRole('gridcell', { name: 'January 2011: no data' })
    expect(none.getAttribute('data-state')).toBe('no_data')
    expect(none.getAttribute('style')).toContain('repeating-linear-gradient')
    const zero = screen.getByRole('gridcell', {
      name: 'December 2011: 0.0 cell-days (MODIS-equivalent), whole month',
    })
    expect(zero.getAttribute('data-state')).toBe('zero')
    expect(zero.getAttribute('data-class')).toBe('0')
    expect(zero.textContent).toContain('0')
    expect(
      screen.getByRole('gridcell', {
        name: '2012 total: 305.9 cell-days (MODIS-equivalent), includes the provisional month',
      }),
    ).toBeTruthy()
    expect(
      screen.getByRole('gridcell', { name: /^Baseline median for January: 10.0/ }),
    ).toBeTruthy()
  })

  it('marks the provisional, latest, whole-month and switchover cells without colour', () => {
    render(<CalendarGrid model={model} />)
    const provisional = screen.getByRole('gridcell', { name: /^April 2012: 250.4.*provisional/ })
    expect(provisional.className).toContain('border-dashed')
    expect(provisional.getAttribute('style') ?? '').not.toContain('background-color: rgb')
    expect(provisional.getAttribute('data-class')).toBeNull()
    expect(provisional.querySelector('[data-marker="provisional"]')).not.toBeNull()
    expect(provisional.className).toContain('inset_0_0_0_2px') // also the latest month
    const jan = screen.getByRole('gridcell', { name: /^January 2012:.*switchover/ })
    expect(jan.className).toContain('border-l-')
    const june = screen.getByRole('gridcell', { name: 'June 2012: no data' })
    expect(june.getAttribute('data-state')).toBe('no_data')
  })

  it('gives one cell the roving tab stop, the latest month with data by default', () => {
    render(<CalendarGrid model={model} />)
    const stops = screen.getAllByRole('gridcell').filter((c) => c.getAttribute('tabindex') === '0')
    expect(stops).toHaveLength(1)
    expect(stops[0]?.getAttribute('data-key')).toBe('2012-04')
  })

  it('makes cells at least 24 px high and wide', () => {
    render(<CalendarGrid model={model} />)
    const cell = screen.getByRole('gridcell', { name: /^February 2012/ })
    expect(cell.className).toMatch(/min-h-8/)
    expect(cell.className).toMatch(/min-w-6/)
  })

  it('has no accessibility violations', async () => {
    const { container } = render(<CalendarGrid model={model} />)
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('CalendarLegend', () => {
  it('states variable, unit, time convention, bin edges, hatch and the colour-scale sentence', () => {
    render(<CalendarLegend model={model} />)
    expect(screen.getByText('Harmonized monthly count of burning activity')).toBeTruthy()
    expect(screen.getAllByText('cell-days per month (MODIS-equivalent)').length).toBeTruthy()
    expect(screen.getByText(/local standard time, UTC-8/)).toBeTruthy()
    const classes = screen.getByRole('list', { name: 'Colour classes' })
    expect(within(classes).getAllByRole('listitem')).toHaveLength(model.bins.length)
    expect(within(classes).getAllByRole('listitem')[0]?.textContent).toContain('0')
    expect(screen.getByText(/^Hatched: no data/)).toBeTruthy()
    expect(screen.getByText(/^Colours are set from the cells shown here only/)).toBeTruthy()
  })

  it('lists the markers that are displayed, and only those', () => {
    render(<CalendarLegend model={model} />)
    expect(screen.getByText(/Thick left edge: January 2012/)).toBeTruthy()
    expect(screen.getByText(/whole month/)).toBeTruthy()
    expect(screen.getByText(/latest month with data/)).toBeTruthy()
    expect(
      screen.getByText(/Dashed border and circle in the bottom-right corner: provisional/),
    ).toBeTruthy()

    const plain = buildCalendarModel(result([month(2020, 1, 3)]), 'counts')
    render(<CalendarLegend model={plain} />)
    expect(screen.getAllByText(/Thick left edge/)).toHaveLength(1)
    expect(screen.getAllByText(/Dashed border/)).toHaveLength(1)
  })

  it('has no accessibility violations', async () => {
    const { container } = render(<CalendarLegend model={model} />)
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('CalendarTable', () => {
  it('lists one row per displayed month with the same values and a Status column', () => {
    render(<CalendarTable model={model} />)
    const table = screen.getByRole('table')
    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(1 + 5) // header + 5 months with data
    expect(within(table).getByRole('columnheader', { name: 'Status' })).toBeTruthy()
    const april = within(table).getByText('April').closest('tr')
    expect(april?.textContent).toContain('250.4')
    expect(april?.textContent).toContain('Provisional')
    expect(april?.textContent).toContain('Latest month')
    const jan = within(table).getByText('January').closest('tr')
    expect(jan?.textContent).toContain('12.5')
    expect(jan?.textContent).toContain('calibrated')
    expect(jan?.textContent).toContain('Switchover')
    const march = within(table).getByText('March').closest('tr')
    expect(march?.textContent).toContain('Complete')
    const dec = within(table).getByText('December').closest('tr')
    expect(dec?.textContent).toContain('Whole month')
  })

  it('has no accessibility violations', async () => {
    const { container } = render(<CalendarTable model={model} />)
    expect(await axe(container)).toHaveNoViolations()
  })
})

// Anomaly and month-to-month views. TEST FIXTURE values, not NASA data.
const viewMonths = [
  month(2019, 12, 30),
  month(2020, 1, 20, { anomaly: anomaly(10, 100, { zscore: 1.5 }) }),
  month(2020, 2, 4, { anomaly: anomaly(-6, -60) }),
  month(2020, 3, 7, { anomaly: anomaly(7, null, { zscore: null, percentile_rank: 90 }) }),
  month(2020, 4, 50, { provisional: true }),
]
const viewOptions = {
  range: { start: '2019-12-01', end: '2020-06-30' },
  recordStart: '2000-11',
  latestMonth: '2020-04',
}
const anomalyModel = buildCalendarModel(result(viewMonths, ['2020-04']), 'anomaly', viewOptions)
const diffModel = buildCalendarModel(result(viewMonths, ['2020-04']), 'diff', viewOptions)

describe('anomaly view components', () => {
  it('shows signed percent on the cells and the percent bins with signs in the legend', () => {
    render(<CalendarGrid model={anomalyModel} />)
    expect(screen.getByRole('grid').getAttribute('aria-label')).toMatch(/^Percent difference/)
    const jan = screen.getByRole('gridcell', { name: /^January 2020:/ })
    expect(jan.textContent).toContain('+100%')
    expect(jan.getAttribute('data-class')).toBe('8')
    expect(jan.getAttribute('aria-label')).toContain('+100.0% from the baseline median')
    expect(screen.getByRole('gridcell', { name: /^February 2020:/ }).textContent).toContain('-60%')
    // Provisional month: no class, only the count to date.
    const apr = screen.getByRole('gridcell', { name: /^April 2020:/ })
    expect(apr.getAttribute('data-class')).toBeNull()
    expect(apr.textContent).toContain('50')
  })

  it('legend lists the 9 bins with signs, the median 0 rule, and no counts-view sentence', () => {
    render(<CalendarLegend model={anomalyModel} />)
    expect(screen.getByText('percent')).toBeTruthy()
    const classes = screen.getByRole('list', { name: 'Colour classes' })
    const items = within(classes).getAllByRole('listitem')
    expect(items).toHaveLength(9)
    expect(items[0]?.textContent).toContain('below -75%')
    expect(items[4]?.textContent).toContain('-10% to under +10%')
    expect(items[4]?.textContent).toContain('neutral')
    expect(items[8]?.textContent).toContain('+100% and above')
    expect(screen.getByText(/baseline median is 0 has no percent difference/)).toBeTruthy()
    expect(screen.queryByText(/Colours are set from the cells shown here only/)).toBeNull()
  })

  it('table gives absolute, percent, z-score, rank, and the no-typical-fires text for median 0', () => {
    render(<CalendarTable model={anomalyModel} />)
    const table = screen.getByRole('table')
    const jan = within(table).getByText('January').closest('tr')
    expect(jan?.textContent).toContain('+10.0')
    expect(jan?.textContent).toContain('+100.0%')
    expect(jan?.textContent).toContain('+1.50')
    const mar = within(table).getByText('March').closest('tr')
    expect(mar?.textContent).toContain('no typical fires in this month')
    expect(mar?.textContent).toContain('+7.0')
    expect(mar?.textContent).toContain('90.0')
    expect(mar?.textContent).not.toMatch(/infinity/i)
    const apr = within(table).getByText('April').closest('tr')
    expect(apr?.textContent).toContain('Provisional')
    expect(within(table).getAllByRole('columnheader').length).toBeGreaterThan(8)
  })

  it('has no accessibility violations', async () => {
    const { container } = render(
      <>
        <CalendarGrid model={anomalyModel} />
        <CalendarLegend model={anomalyModel} />
        <CalendarTable model={anomalyModel} />
      </>,
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('month-to-month difference view components', () => {
  it('shows signed differences, hatches a month without a previous month, and lists symmetric bins', () => {
    render(<CalendarGrid model={diffModel} />)
    // December 2019 has no previous month in the Date_Range, so it is hatched.
    const dec = screen.getByRole('gridcell', { name: /^December 2019:/ })
    expect(dec.getAttribute('style')).toContain('repeating-linear-gradient')
    expect(dec.getAttribute('aria-label')).toContain('previous month has no data')
    const jan = screen.getByRole('gridcell', { name: /^January 2020:/ })
    expect(jan.textContent).toContain('-10')
    expect(jan.getAttribute('aria-label')).toContain(
      '-10.0 cell-days (MODIS-equivalent) from the previous month',
    )
    render(<CalendarLegend model={diffModel} />)
    const items = within(screen.getByRole('list', { name: 'Colour classes' })).getAllByRole(
      'listitem',
    )
    expect(items).toHaveLength(9)
    expect(items[4]?.textContent).toContain('neutral')
    expect(screen.getByText(/95th percentile of the absolute differences/)).toBeTruthy()
    expect(screen.getByText(/previous month has no data\)/)).toBeTruthy()
  })
})

describe('cell tooltip', () => {
  it('opens on keyboard focus with month, count, flags, baseline and anomaly, and no interval line', async () => {
    render(<CalendarGrid model={anomalyModel} />)
    const jan = screen.getByRole('gridcell', { name: /^January 2020:/ })
    act(() => {
      jan.focus()
    })
    const tip = await screen.findByRole('tooltip')
    const text = tip.textContent
    expect(text).toContain('January 2020')
    expect(text).toContain('20.0 cell-days (MODIS-equivalent)')
    expect(text).toContain('calibrated')
    expect(text).toContain('quantile_map')
    expect(text).toContain('TEST FIXTURE')
    expect(text).toContain('Baseline median')
    expect(text).toContain('+100.0%')
    expect(text).toContain('+1.50')
    expect(text).toContain('60.0')
    expect(text).not.toContain('Uncertainty interval')
  })

  it('shows the no-typical-fires text and the interval line when both bounds exist', async () => {
    const months = [
      month(2020, 3, 7, {
        lower_bound: 4,
        upper_bound: 9,
        anomaly: anomaly(7, null, { percentile_rank: 90 }),
      }),
    ]
    const model = buildCalendarModel(result(months), 'counts', viewOptions)
    render(<CalendarGrid model={model} />)
    act(() => {
      screen.getByRole('gridcell', { name: /^March 2020:/ }).focus()
    })
    const tip = await screen.findByRole('tooltip')
    expect(tip.textContent).toContain('no typical fires in this month')
    expect(tip.textContent).toContain('+7.0')
    expect(tip.textContent).toContain('90.0')
    expect(tip.textContent).toContain('4.0 to 9.0')
  })
})

describe('CalendarViewSwitch', () => {
  it('marks the active view with aria-pressed and a check, and reports a selection', async () => {
    const onChange = vi.fn()
    render(<CalendarViewSwitch value="anomaly" onChange={onChange} />)
    const group = screen.getByRole('group', { name: 'Calendar view' })
    const buttons = within(group).getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['Counts', 'Anomaly', 'Month to month'])
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false'])
    await userEvent.click(within(group).getByRole('button', { name: 'Month to month' }))
    expect(onChange).toHaveBeenCalledWith('diff')
  })

  it('has no accessibility violations', async () => {
    const { container } = render(<CalendarViewSwitch value="counts" onChange={() => undefined} />)
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('month filter selection', () => {
  it('calls onSelect for a cell with data, marks the selected cell, and ignores no-data cells', () => {
    const onSelect = vi.fn()
    render(<CalendarGrid model={model} selectedKey="2012-02" onSelect={onSelect} />)
    const feb = document.querySelector('[data-key="2012-02"]') as HTMLElement
    expect(feb.getAttribute('aria-selected')).toBe('true')
    expect(feb.getAttribute('data-selected')).toBe('true')
    const mar = document.querySelector('[data-key="2012-03"]') as HTMLElement
    expect(mar.getAttribute('aria-selected')).toBe('false')
    fireEvent.click(mar)
    expect(onSelect).toHaveBeenCalledWith('2012-03')
    const none = document.querySelector<HTMLElement>('[data-state="no_data"]')
    if (none !== null) {
      fireEvent.click(none)
      expect(onSelect).toHaveBeenCalledTimes(1)
    }
  })
})

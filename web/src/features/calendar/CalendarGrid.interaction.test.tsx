import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { CalendarGrid } from './CalendarGrid'
import type { CalendarModel } from '@/lib/binning'

const mockBinZero = {
  index: 0,
  kind: 'zero' as const,
  lower: null,
  upper: null,
  max: null,
  label: '0',
  colour: 'hsl(0 0% 100%)',
  neutral: false,
  textTone: 'dark' as const,
  cells: 0,
}
const mockBinRange1 = {
  index: 1,
  kind: 'range' as const,
  lower: 0,
  upper: 10,
  max: null,
  label: '0 – 10',
  colour: 'hsl(20 100% 95%)',
  neutral: false,
  textTone: 'dark' as const,
  cells: 1,
}

const mockModel: CalendarModel = {
  view: 'counts',
  variable: 'Harmonized count',
  unit: 'cell-days (MODIS-equivalent)',
  timeConvention: 'local standard time, UTC-8',
  total: 1250.5,
  peak: { year: 2020, month: 8, value: 125.5 },
  bins: [mockBinZero, mockBinRange1],
  edges: [0, 10, 20, 50, 100, 200, 500, 1000],
  diffLimit: null,
  hasProvisional: false,
  hasWholeMonth: true,
  hasLatest: false,
  hasSwitchover: false,
  hasNoData: true,
  rows: [
    {
      year: 2020,
      cells: [
        {
          key: '2020-01',
          year: 2020,
          month: 1,
          state: 'value',
          hatched: false,
          colour: 'hsl(20 100% 80%)',
          classIndex: 3,
          textTone: 'light',
          face: '50',
          value: 50.5,
          baselineMedian: 45.0,
          diff: null,
          provisional: false,
          latest: false,
          wholeMonth: true,
          switchover: false,
          data: {
            year: 2020,
            month: 1,
            harmonized: 50.5,
            raw_modis: 48,
            raw_viirs: 0,
            frp_sum_mw: 1250.0,
            source_flag: 'native',
            calib_model: 'none',
            provenance: 'Aqua+Terra',
            provisional: false,
            lower_bound: null,
            upper_bound: null,
            anomaly: {
              absolute: 5.5,
              percent: 12.2,
              percent_text: '12.2%',
              zscore: 0.5,
              percentile_rank: 62.5,
              baseline_start_year: 2000,
              baseline_end_year: 2019,
              n_years: 20,
            },
          },
        },
        {
          key: '2020-06',
          year: 2020,
          month: 6,
          state: 'value',
          hatched: false,
          colour: 'hsl(120 100% 60%)',
          classIndex: 5,
          textTone: 'dark',
          face: '100',
          value: 100.0,
          baselineMedian: 80.0,
          diff: null,
          provisional: false,
          latest: false,
          wholeMonth: true,
          switchover: false,
          data: {
            year: 2020,
            month: 6,
            harmonized: 100.0,
            raw_modis: 95,
            raw_viirs: 0,
            frp_sum_mw: 2500.0,
            source_flag: 'native',
            calib_model: 'none',
            provenance: 'Aqua+Terra',
            provisional: false,
            lower_bound: null,
            upper_bound: null,
            anomaly: {
              absolute: 20.0,
              percent: 25.0,
              percent_text: '25.0%',
              zscore: 1.2,
              percentile_rank: 75.0,
              baseline_start_year: 2000,
              baseline_end_year: 2019,
              n_years: 20,
            },
          },
        },
        {
          key: '2020-12',
          year: 2020,
          month: 12,
          state: 'no_data',
          hatched: true,
          colour: null,
          classIndex: null,
          textTone: null,
          face: null,
          value: null,
          baselineMedian: null,
          diff: null,
          provisional: false,
          latest: false,
          wholeMonth: false,
          switchover: false,
          data: null,
        },
      ],
      total: 150.5,
      totalProvisional: false,
    },
  ],
  baselineMedians: Array.from({ length: 12 }, () => 50.0),
}

describe('CalendarGrid keyboard interaction', () => {
  it('selects cell with Enter key', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(<CalendarGrid model={mockModel} onSelect={onSelect} />)

    const cell = screen.getByRole('gridcell', { name: /January 2020/ })
    await user.click(cell) // Focus the cell
    await user.keyboard('{Enter}')

    expect(onSelect).toHaveBeenCalledWith('2020-01')
  })

  it('selects cell with Space key', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(<CalendarGrid model={mockModel} onSelect={onSelect} />)

    const cell = screen.getByRole('gridcell', { name: /June 2020/ })
    await user.click(cell)
    await user.keyboard(' ')

    expect(onSelect).toHaveBeenCalledWith('2020-06')
  })

  it('clears selection with Escape key', async () => {
    const user = userEvent.setup()
    const onClearSelection = vi.fn()

    render(
      <CalendarGrid model={mockModel} selectedKey="2020-06" onClearSelection={onClearSelection} />,
    )

    const region = screen.getByRole('region', { name: /burning activity calendar/i })
    region.focus()
    await user.keyboard('{Escape}')

    expect(onClearSelection).toHaveBeenCalled()
  })

  it('does not clear selection with Escape when no selection', async () => {
    const user = userEvent.setup()
    const onClearSelection = vi.fn()

    render(
      <CalendarGrid model={mockModel} selectedKey={null} onClearSelection={onClearSelection} />,
    )

    const region = screen.getByRole('region', { name: /burning activity calendar/i })
    region.focus()
    await user.keyboard('{Escape}')

    expect(onClearSelection).not.toHaveBeenCalled()
  })

  it('does not select no-data cells with Enter', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(<CalendarGrid model={mockModel} onSelect={onSelect} />)

    // Find the no-data cell (December)
    const cells = screen.getAllByRole('gridcell')
    const noDataCell = cells.find((cell) => cell.getAttribute('data-state') === 'no_data')
    expect(noDataCell).toBeDefined()

    if (noDataCell) {
      noDataCell.focus()
      await user.keyboard('{Enter}')

      expect(onSelect).not.toHaveBeenCalled()
    }
  })
})

describe('CalendarGrid pointer interaction', () => {
  it('selects cell on tap (pointerdown + pointerup without drag)', () => {
    const onSelect = vi.fn()

    render(<CalendarGrid model={mockModel} onSelect={onSelect} />)

    const cell = screen.getByRole('gridcell', { name: /January 2020/ })

    // Simulate tap: pointerdown and pointerup at same position
    cell.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: 100,
        clientY: 100,
      }),
    )
    cell.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        clientX: 100,
        clientY: 100,
      }),
    )

    expect(onSelect).toHaveBeenCalledWith('2020-01')
  })

  it('does not select cell on drag (movement > 8px)', () => {
    const onSelect = vi.fn()

    render(<CalendarGrid model={mockModel} onSelect={onSelect} />)

    const cell = screen.getByRole('gridcell', { name: /June 2020/ })

    // Simulate drag: pointerdown and pointerup at different positions (> 8px apart)
    cell.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: 100,
        clientY: 100,
      }),
    )
    cell.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        clientX: 120,
        clientY: 100,
      }),
    )

    expect(onSelect).not.toHaveBeenCalled()
  })

  it('selects on small movement (< 8px threshold)', () => {
    const onSelect = vi.fn()

    render(<CalendarGrid model={mockModel} onSelect={onSelect} />)

    const cell = screen.getByRole('gridcell', { name: /January 2020/ })

    // Simulate small movement (5px)
    cell.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: 100,
        clientY: 100,
      }),
    )
    cell.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        clientX: 103,
        clientY: 104,
      }),
    )

    expect(onSelect).toHaveBeenCalledWith('2020-01')
  })

  it('does not select no-data cells on tap', () => {
    const onSelect = vi.fn()

    render(<CalendarGrid model={mockModel} onSelect={onSelect} />)

    const cells = screen.getAllByRole('gridcell')
    const noDataCell = cells.find((cell) => cell.getAttribute('data-state') === 'no_data')
    expect(noDataCell).toBeDefined()

    if (noDataCell) {
      noDataCell.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          clientX: 100,
          clientY: 100,
        }),
      )
      noDataCell.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          clientX: 100,
          clientY: 100,
        }),
      )

      expect(onSelect).not.toHaveBeenCalled()
    }
  })

  it('handles pointer cancel gracefully', () => {
    const onSelect = vi.fn()

    render(<CalendarGrid model={mockModel} onSelect={onSelect} />)

    const cell = screen.getByRole('gridcell', { name: /January 2020/ })

    cell.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: 100,
        clientY: 100,
      }),
    )
    cell.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }))
    cell.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        clientX: 100,
        clientY: 100,
      }),
    )

    // pointercancel should reset, so pointerup should not trigger selection
    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('CalendarGrid accessibility', () => {
  it('has no accessibility violations', async () => {
    const { container } = render(<CalendarGrid model={mockModel} />)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('marks selected cell with aria-selected', () => {
    render(<CalendarGrid model={mockModel} selectedKey="2020-06" onSelect={vi.fn()} />)

    const selectedCell = screen.getByRole('gridcell', { name: /June 2020/ })
    expect(selectedCell.getAttribute('aria-selected')).toBe('true')
  })

  it('does not set aria-selected on no-data cells', () => {
    render(<CalendarGrid model={mockModel} selectedKey="2020-12" onSelect={vi.fn()} />)

    const cells = screen.getAllByRole('gridcell')
    const noDataCell = cells.find((cell) => cell.getAttribute('data-state') === 'no_data')

    expect(noDataCell).toBeDefined()
    if (noDataCell) {
      expect(noDataCell.hasAttribute('aria-selected')).toBe(false)
    }
  })
})

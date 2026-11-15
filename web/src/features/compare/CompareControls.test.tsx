// Tests for comparison mode controls (requirements 19.1, 19.4, 19.5).
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CompareControls } from './CompareControls'
import type { DateRange } from '@/lib/dates'

describe('CompareControls', () => {
  const mockDateRange: DateRange = {
    start: '2020-01-01',
    end: '2020-12-31',
  }

  it('renders with none mode by default', () => {
    const onCompareChange = vi.fn()
    render(
      <CompareControls
        compare={{ mode: 'none' }}
        primaryRange={mockDateRange}
        onCompareChange={onCompareChange}
      />,
    )

    const noneRadio = screen.getByLabelText(/none \(single view\)/i)
    expect((noneRadio as HTMLInputElement).checked).toBe(true)
  })

  it('switches to area comparison mode', async () => {
    const user = userEvent.setup()
    const onCompareChange = vi.fn()

    render(
      <CompareControls
        compare={{ mode: 'none' }}
        primaryRange={mockDateRange}
        onCompareChange={onCompareChange}
      />,
    )

    await user.click(screen.getByLabelText(/compare areas/i))

    expect(onCompareChange).toHaveBeenCalledWith({
      mode: 'area',
      area2: { kind: 'region' },
      perArea: false,
    })
  })

  it('switches to period comparison mode', async () => {
    const user = userEvent.setup()
    const onCompareChange = vi.fn()

    render(
      <CompareControls
        compare={{ mode: 'none' }}
        primaryRange={mockDateRange}
        onCompareChange={onCompareChange}
      />,
    )

    await user.click(screen.getByLabelText(/compare periods/i))

    expect(onCompareChange).toHaveBeenCalledWith({
      mode: 'period',
      start2: mockDateRange.start,
      end2: mockDateRange.end,
    })
  })

  it('shows per-area toggle in area mode', () => {
    const onCompareChange = vi.fn()

    render(
      <CompareControls
        compare={{
          mode: 'area',
          area2: { kind: 'region' },
          perArea: false,
        }}
        primaryRange={mockDateRange}
        onCompareChange={onCompareChange}
      />,
    )

    expect(screen.getByLabelText(/normalize per 1000 km²/i)).toBeDefined()
  })

  it('toggles per-area normalization', async () => {
    const user = userEvent.setup()
    const onCompareChange = vi.fn()

    render(
      <CompareControls
        compare={{
          mode: 'area',
          area2: { kind: 'region' },
          perArea: false,
        }}
        primaryRange={mockDateRange}
        onCompareChange={onCompareChange}
      />,
    )

    const toggle = screen.getByLabelText(/toggle per-area normalization/i)
    await user.click(toggle)

    expect(onCompareChange).toHaveBeenCalledWith({
      mode: 'area',
      area2: { kind: 'region' },
      perArea: true,
    })
  })

  it('renders area selector when provided in area mode', () => {
    const onCompareChange = vi.fn()
    const renderAreaSelector = vi.fn(() => <div>Mock Area Selector</div>)

    render(
      <CompareControls
        compare={{
          mode: 'area',
          area2: { kind: 'region' },
          perArea: false,
        }}
        primaryRange={mockDateRange}
        onCompareChange={onCompareChange}
        renderAreaSelector={renderAreaSelector}
      />,
    )

    expect(screen.getByText('Mock Area Selector')).toBeDefined()
    expect(renderAreaSelector).toHaveBeenCalled()
  })

  it('renders date range selector when provided in period mode', () => {
    const onCompareChange = vi.fn()
    const renderDateRangeSelector = vi.fn(() => <div>Mock Date Range Selector</div>)

    render(
      <CompareControls
        compare={{
          mode: 'period',
          start2: '2019-01-01',
          end2: '2019-12-31',
        }}
        primaryRange={mockDateRange}
        onCompareChange={onCompareChange}
        renderDateRangeSelector={renderDateRangeSelector}
      />,
    )

    expect(screen.getByText('Mock Date Range Selector')).toBeDefined()
    expect(renderDateRangeSelector).toHaveBeenCalled()
  })

  it('shows explanation text for per-area mode', () => {
    const onCompareChange = vi.fn()

    render(
      <CompareControls
        compare={{
          mode: 'area',
          area2: { kind: 'region' },
          perArea: false,
        }}
        primaryRange={mockDateRange}
        onCompareChange={onCompareChange}
      />,
    )

    expect(screen.getByText(/counts are shown as cell-days per 1000 km²/i)).toBeDefined()
  })

  it('switches back to none mode', async () => {
    const user = userEvent.setup()
    const onCompareChange = vi.fn()

    render(
      <CompareControls
        compare={{
          mode: 'area',
          area2: { kind: 'region' },
          perArea: false,
        }}
        primaryRange={mockDateRange}
        onCompareChange={onCompareChange}
      />,
    )

    await user.click(screen.getByLabelText(/none \(single view\)/i))

    expect(onCompareChange).toHaveBeenCalledWith({ mode: 'none' })
  })
})

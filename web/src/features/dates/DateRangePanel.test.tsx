import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { axe } from 'vitest-axe'
import { DateRangePanel } from './DateRangePanel'

const value = { start: '2016-01-01', end: '2026-11-30' }

function setup(props: Partial<React.ComponentProps<typeof DateRangePanel>> = {}) {
  const onApply = vi.fn()
  const onExactRangeChange = vi.fn()
  const view = render(
    <DateRangePanel
      firstDate="2000-11-01"
      latestMonth="2026-11"
      latestDetectionDate="2026-11-10"
      value={value}
      onApply={onApply}
      onExactRangeChange={onExactRangeChange}
      {...props}
    />,
  )
  return { onApply, onExactRangeChange, ...view }
}

async function type(label: string, text: string) {
  const user = userEvent.setup()
  const input = screen.getByLabelText(label)
  await user.clear(input)
  await user.type(input, text)
  return user
}

describe('DateRangePanel', () => {
  it('shows the applied range, the record and the time convention', () => {
    setup()
    expect(screen.getByLabelText<HTMLInputElement>('Start date').value).toBe('2016-01-01')
    expect(screen.getByLabelText<HTMLInputElement>('End date').value).toBe('2026-11-30')
    expect(screen.getByText(/2000-11-01 to 2026-11-30/)).toBeTruthy()
    expect(screen.getByText(/local standard time, UTC-8/)).toBeTruthy()
  })

  it('applies a valid range', async () => {
    const { onApply } = setup()
    await type('Start date', '2020-08-15')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Apply date range' }))
    expect(onApply).toHaveBeenCalledWith({ start: '2020-08-15', end: '2026-11-30' })
  })

  it('shows inline errors, sends nothing and says previous results stay', async () => {
    const { onApply } = setup()
    const user = await type('Start date', '2021-02-29')
    await user.click(screen.getByRole('button', { name: 'Apply date range' }))
    expect(onApply).not.toHaveBeenCalled()
    const start = screen.getByLabelText('Start date')
    expect(start.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByLabelText('End date').getAttribute('aria-invalid')).toBe('false')
    expect(screen.getByRole('alert').textContent).toMatch(/not a real calendar date/)
    expect(screen.getByTestId('previous-range').textContent).toContain('2016-01-01 to 2026-11-30')
  })

  it('marks both fields when the start is after the end', async () => {
    const { onApply } = setup()
    const user = await type('Start date', '2026-11-30')
    await type('End date', '2026-11-01')
    await user.click(screen.getByRole('button', { name: 'Apply date range' }))
    expect(onApply).not.toHaveBeenCalled()
    expect(screen.getAllByRole('alert')).toHaveLength(2)
  })

  it('applies a calendar preset', async () => {
    const { onApply } = setup()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Last 5 years' }))
    expect(onApply).toHaveBeenCalledWith({ start: '2021-12-01', end: '2026-11-30' })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Full record' }))
    expect(onApply).toHaveBeenLastCalledWith({ start: '2000-11-01', end: '2026-11-30' })
  })

  it('sends day presets to the exact-range callback only', async () => {
    const { onApply, onExactRangeChange } = setup()
    const user = userEvent.setup()
    const button = screen.getByRole('button', { name: 'Last 7 days' })
    await user.click(button)
    expect(onExactRangeChange).toHaveBeenCalledWith({ start: '2026-11-04', end: '2026-11-10' })
    expect(onApply).not.toHaveBeenCalled()
    expect(button.getAttribute('aria-pressed')).toBe('true')
    await user.click(button)
    expect(onExactRangeChange).toHaveBeenLastCalledWith(null)
  })

  it('hides the day presets when no exact-range handler is given', () => {
    setup({ onExactRangeChange: undefined })
    expect(screen.queryByRole('button', { name: 'Last 7 days' })).toBeNull()
  })

  it('shows the whole-month note for a mid-month start', () => {
    setup({ value: { start: '2020-08-15', end: '2026-11-30' } })
    expect(screen.getByTestId('whole-month-note').textContent).toMatch(/whole of August 2020/)
  })

  it('shows no whole-month note for whole months', () => {
    setup()
    expect(screen.queryByTestId('whole-month-note')).toBeNull()
  })

  it('follows a range changed from outside', () => {
    const { rerender } = setup()
    rerender(
      <DateRangePanel
        firstDate="2000-11-01"
        latestMonth="2026-11"
        value={{ start: '2026-01-01', end: '2026-11-30' }}
        onApply={vi.fn()}
      />,
    )
    expect(screen.getByLabelText<HTMLInputElement>('Start date').value).toBe('2026-01-01')
  })

  it('has no accessibility violations, with and without errors', async () => {
    const { container } = setup()
    expect(await axe(container)).toHaveNoViolations()
    const user = await type('Start date', 'nope')
    await user.click(screen.getByRole('button', { name: 'Apply date range' }))
    expect(await axe(container)).toHaveNoViolations()
  })
})

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { axe } from 'vitest-axe'
import { BaselinePanel } from './BaselinePanel'
const bounds = { first: 2001, last: 2025 }
function setup(props: Partial<React.ComponentProps<typeof BaselinePanel>> = {}) {
  const onApply = vi.fn()
  const view = render(<BaselinePanel bounds={bounds} value={null} onApply={onApply} {...props} />)
  return { onApply, ...view }
}
async function enter(first: string, last: string) {
  const user = userEvent.setup()
  const a = screen.getByLabelText('First year')
  const b = screen.getByLabelText('Last year')
  await user.clear(a)
  await user.type(a, first)
  await user.clear(b)
  await user.type(b, last)
  await user.click(screen.getByRole('button', { name: 'Apply baseline' }))
  return user
}
describe('BaselinePanel', () => {
  it('shows the default period and the limits', () => {
    setup()
    expect(screen.getByTestId('baseline-current').textContent).toMatch(/full record/)
    expect(screen.getByText(/5 to 30 complete years, 2001 to 2025/)).toBeTruthy()
  })
  it('applies a valid period', async () => {
    const { onApply } = setup()
    await enter('2005', '2014')
    expect(onApply).toHaveBeenCalledWith([2005, 2014])
  })
  it('shows an inline error for a period that is too short and sends nothing', async () => {
    const { onApply } = setup()
    await enter('2005', '2007')
    expect(onApply).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toMatch(/at least 5/)
    expect(screen.getByLabelText('First year').getAttribute('aria-invalid')).toBe('true')
  })
  it('shows the server message and that the previous period stays', () => {
    setup({ value: [2005, 2014], serverError: 'Baseline years must be complete in-record years.' })
    expect(screen.getByRole('alert').textContent).toMatch(
      /previous baseline period is still applied/,
    )
    expect(screen.getByLabelText<HTMLInputElement>('First year').value).toBe('2005')
  })
  it('goes back to the full record', async () => {
    const { onApply } = setup({ value: [2005, 2014] })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Use full record' }))
    expect(onApply).toHaveBeenCalledWith(null)
  })
  it('has no accessibility violations, with an error shown', async () => {
    const { container } = setup({ serverError: 'Rejected.' })
    expect((await axe(container)).violations).toEqual([])
  })
})

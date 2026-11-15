import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DrawControls } from './DrawControls'

describe('DrawControls gaps (task 19.10)', () => {
  it('keeps Clear enabled and focusable, and calls onClear in every mode', async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()
    const { rerender } = render(
      <DrawControls mode={null} onModeChange={vi.fn()} onClear={onClear} />,
    )
    const clear = screen.getByRole('button', { name: 'Clear' })
    expect((clear as HTMLButtonElement).disabled).toBe(false)
    clear.focus()
    expect(document.activeElement).toBe(clear)
    await user.keyboard(' ')
    rerender(<DrawControls mode="polygon" onModeChange={vi.fn()} onClear={onClear} />)
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onClear).toHaveBeenCalledTimes(2)
  })

  it('hides the check icon from assistive technology', () => {
    render(<DrawControls mode="rectangle" onModeChange={vi.fn()} onClear={vi.fn()} />)
    const icon = screen.getByRole('button', { name: 'Draw rectangle' }).querySelector('svg')
    expect(icon?.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByRole('button', { name: 'Draw polygon' }).querySelector('svg')).toBeNull()
  })

  it('leaves drawing mode on Escape while a control has focus, once per press', async () => {
    const user = userEvent.setup()
    const onModeChange = vi.fn()
    render(<DrawControls mode="rectangle" onModeChange={onModeChange} onClear={vi.fn()} />)
    screen.getByRole('button', { name: 'Clear' }).focus()
    await user.keyboard('{Escape}')
    expect(onModeChange).toHaveBeenCalledTimes(1)
    expect(onModeChange).toHaveBeenCalledWith(null)
  })
})

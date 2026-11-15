import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DrawControls } from './DrawControls'

// Gap tests for task 19.12: toggle transitions and the Escape listener lifecycle.
// The names, aria-pressed, Escape, Clear, hint and storage cases are in AreaControls.test.tsx,
// DrawControls.a11y.test.tsx, MapView.drawHint.test.tsx and App.area.test.tsx.

describe('DrawControls toggles (requirements 11.10, 11.12)', () => {
  it('turns the active mode off when its button is pressed again', async () => {
    const user = userEvent.setup()
    const onModeChange = vi.fn()
    render(<DrawControls mode="rectangle" onModeChange={onModeChange} onClear={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Draw rectangle' }))
    expect(onModeChange).toHaveBeenLastCalledWith(null)
  })

  it('switches directly to the other mode', async () => {
    const user = userEvent.setup()
    const onModeChange = vi.fn()
    render(<DrawControls mode="rectangle" onModeChange={onModeChange} onClear={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Draw polygon' }))
    expect(onModeChange).toHaveBeenLastCalledWith('polygon')
  })

  it('does not listen for Escape after unmount', async () => {
    const user = userEvent.setup()
    const onModeChange = vi.fn()
    const { unmount } = render(
      <DrawControls mode="polygon" onModeChange={onModeChange} onClear={vi.fn()} />,
    )
    unmount()
    await user.keyboard('{Escape}')
    expect(onModeChange).not.toHaveBeenCalled()
  })

  it('does not move focus when the mode changes from outside', () => {
    const { rerender } = render(
      <DrawControls mode={null} onModeChange={vi.fn()} onClear={vi.fn()} />,
    )
    rerender(<DrawControls mode="polygon" onModeChange={vi.fn()} onClear={vi.fn()} />)
    expect(document.activeElement).toBe(document.body)
  })
})

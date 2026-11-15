import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '@/lib/urlState'
import { CopyLinkButton } from './CopyLinkButton'

const STATE: AppState = {
  area: { kind: 'region' },
  start: '2020-01-01',
  end: '2020-12-31',
  view: 'counts',
  compare: { mode: 'none' },
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CopyLinkButton', () => {
  it('copies the link and says so', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    render(<CopyLinkButton state={STATE} search="" />)
    await user.click(screen.getByRole('button', { name: 'Copy link' }))
    expect((await screen.findByTestId('share-status')).textContent).toBe('Link copied.')
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(String(writeText.mock.calls[0]?.[0])).toContain('from=2020-01-01&to=2020-12-31')
  })

  it('shows the link for manual copying when the clipboard is refused', async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
    render(<CopyLinkButton state={STATE} search="" />)
    await user.click(screen.getByRole('button', { name: 'Copy link' }))
    const field = await screen.findByRole<HTMLInputElement>('textbox', { name: 'Link to copy' })
    expect(field.value).toContain('from=2020-01-01')
  })
})

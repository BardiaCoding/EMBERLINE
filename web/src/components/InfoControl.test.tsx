import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import fc from 'fast-check'
import { axe } from 'vitest-axe'
import { describe, expect, it } from 'vitest'
import { InfoControl } from './InfoControl'
import { HELP_KEYS, helpText } from '@/lib/helpText'

describe('helpText', () => {
  it('has one non-empty sentence of at most 30 words per key', () => {
    expect(HELP_KEYS).toHaveLength(6)
    for (const key of HELP_KEYS) {
      const words = helpText(key).trim().split(/\s+/)
      expect(words.length).toBeGreaterThan(0)
      expect(words.length).toBeLessThanOrEqual(30)
    }
  })

  it('states cell-days on the MODIS-equivalent scale for the harmonized count', () => {
    expect(helpText('harmonized_count')).toMatch(/cell-days/)
    expect(helpText('harmonized_count')).toMatch(/MODIS-equivalent/)
  })
})

describe('InfoControl', () => {
  it('names the button "About {term}" and starts collapsed', () => {
    render(<InfoControl helpKey="z_score" term="z-score" />)
    const button = screen.getByRole('button', { name: 'About z-score' })
    expect(button.getAttribute('aria-expanded')).toBe('false')
  })

  it.each(['{Enter}', ' '])('opens the popover with key %j', async (key) => {
    const user = userEvent.setup()
    render(<InfoControl helpKey="anomaly" term="anomaly" />)
    const button = screen.getByRole('button', { name: 'About anomaly' })
    await user.tab()
    expect(document.activeElement).toBe(button)
    await user.keyboard(key)
    expect(await screen.findByText(helpText('anomaly'))).toBeTruthy()
    expect(button.getAttribute('aria-expanded')).toBe('true')
  })

  it('closes on Escape and restores focus to the button', async () => {
    const user = userEvent.setup()
    render(<InfoControl helpKey="baseline_median" term="baseline median" />)
    const button = screen.getByRole('button', { name: 'About baseline median' })
    await user.tab()
    await user.keyboard('{Enter}')
    await screen.findByText(helpText('baseline_median'))
    await user.keyboard('{Escape}')
    expect(screen.queryByText(helpText('baseline_median'))).toBeNull()
    expect(document.activeElement).toBe(button)
    expect(button.getAttribute('aria-expanded')).toBe('false')
  })

  it('has no axe violations closed or open', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <main>
        <InfoControl helpKey="percentile_rank" term="percentile rank" />
      </main>,
    )
    expect(await axe(container)).toHaveNoViolations()
    await user.click(screen.getByRole('button', { name: 'About percentile rank' }))
    await screen.findByText(helpText('percentile_rank'))
    expect(await axe(document.body)).toHaveNoViolations()
  })

  it('property: the accessible name is "About " followed by the term', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...HELP_KEYS),
        fc.stringMatching(/^[A-Za-z][A-Za-z -]{0,20}[A-Za-z]$/),
        (key, term) => {
          const { container, unmount } = render(<InfoControl helpKey={key} term={term} />)
          const label = container.querySelector('button')?.getAttribute('aria-label')
          unmount()
          return label === `About ${term}`
        },
      ),
    )
  })
})

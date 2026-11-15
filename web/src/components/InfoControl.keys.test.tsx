import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { InfoControl } from './InfoControl'
import { HELP_KEYS, helpText, type HelpKey } from '@/lib/helpText'

// Every one of the six help terms is reachable and operable by keyboard and has an
// accessible name that includes the term. Requirements 15.21, 15.22.

const TERMS: Record<HelpKey, string> = {
  harmonized_count: 'harmonized count',
  uncertainty_interval: 'uncertainty interval',
  baseline_median: 'baseline median',
  anomaly: 'anomaly',
  z_score: 'z-score',
  percentile_rank: 'percentile rank',
}

describe('InfoControl for all six help terms', () => {
  it.each(HELP_KEYS)('%s: Tab, Enter opens, Escape closes and restores focus', async (key) => {
    const user = userEvent.setup()
    render(<InfoControl helpKey={key} term={TERMS[key]} />)
    const button = screen.getByRole('button', { name: `About ${TERMS[key]}` })
    await user.tab()
    expect(document.activeElement).toBe(button)
    await user.keyboard('{Enter}')
    expect(await screen.findByText(helpText(key))).toBeTruthy()
    expect(button.getAttribute('aria-expanded')).toBe('true')
    await user.keyboard('{Escape}')
    expect(screen.queryByText(helpText(key))).toBeNull()
    expect(document.activeElement).toBe(button)
  })

  it.each(HELP_KEYS)('%s: Space opens the help text', async (key) => {
    const user = userEvent.setup()
    render(<InfoControl helpKey={key} term={TERMS[key]} />)
    await user.tab()
    await user.keyboard(' ')
    expect(await screen.findByText(helpText(key))).toBeTruthy()
  })
})

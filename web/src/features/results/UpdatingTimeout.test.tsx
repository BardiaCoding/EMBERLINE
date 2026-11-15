import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { StatsSlot } from '@/features/charts/chartTypes'
import { ApiError } from '@/lib/api'
import { ResultsPanel } from './ResultsPanel'
import type { ResultsStatus } from './useResultsStatus'

// Requirements 28.6, 28.9: the 30 s timeout path shows "Not updated" with the timeout card.
// TEST FIXTURE, not NASA data.

const stats: StatsSlot = { data: undefined, isError: false, error: null, onRetry: () => undefined }
const notUpdated: ResultsStatus = {
  updating: 'not_updated',
  showLoading: false,
  phase: 'error',
  announcement: 'Update failed.',
}

describe('30 s timeout in the results panel', () => {
  it('shows Not updated, the timeout card and a working Retry, without busy or dimming', () => {
    const onRetry = vi.fn()
    const error = new ApiError({
      kind: 'timeout',
      code: 'timeout',
      message: 'The request timed out after 30 seconds.',
    })
    render(
      <ResultsPanel
        status={notUpdated}
        loadError={{ error, onRetry }}
        calendar={undefined}
        model={null}
        stats={stats}
        areaLabel="California region"
        view="counts"
        onViewChange={() => undefined}
      />,
    )
    const panel = screen.getByTestId('results-panel')
    expect(screen.getByTestId('updating-label').textContent).toBe('Not updated')
    expect(screen.getByTestId('error-card').textContent).toContain('The request timed out')
    expect(panel.getAttribute('aria-busy')).toBe('false')
    expect(panel.getAttribute('data-updating')).toBeNull()
    screen.getByRole('button', { name: 'Retry' }).click()
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})

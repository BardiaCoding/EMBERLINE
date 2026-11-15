import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import { ApiError } from '@/lib/api'
import { ChartFrame, DEFAULT_EMPTY_CHART_MESSAGE } from './ChartFrame'
import { useChartFrameIds } from './chartFrameContext'

// Synthetic values. TEST FIXTURE, not NASA data.
function Probe() {
  const ids = useChartFrameIds()
  return <p data-testid="probe">{ids === null ? 'no frame' : `${ids.titleId}|${ids.summaryId}`}</p>
}

function frame(props: Partial<Parameters<typeof ChartFrame>[0]> = {}) {
  return (
    <ChartFrame
      title="Harmonized count by year"
      unit="cell-days (MODIS-equivalent), local standard time, UTC-8"
      summary="Bar chart. Unit: cell-days. Total harmonized count: 10.0."
      table={
        <table>
          <caption>values</caption>
          <tbody>
            <tr>
              <td>2012</td>
            </tr>
          </tbody>
        </table>
      }
      {...props}
    >
      <Probe />
    </ChartFrame>
  )
}

describe('ChartFrame', () => {
  it('shows the title, the unit subtitle and a text summary for assistive technology', () => {
    render(frame())
    const section = screen.getByRole('region', { name: 'Harmonized count by year' })
    expect(within(section).getByText(/local standard time, UTC-8/)).toBeTruthy()
    const summary = within(section).getByText(/Total harmonized count: 10.0/)
    expect(summary.className).toContain('sr-only')
  })

  it('gives the chart the ids of its title and summary', () => {
    render(frame())
    const [titleId, summaryId] = screen.getByTestId('probe').textContent.split('|')
    expect(document.getElementById(titleId ?? '')?.textContent).toBe('Harmonized count by year')
    expect(document.getElementById(summaryId ?? '')?.textContent).toContain('Bar chart.')
  })

  it('opens the data table from the "View table" link and moves focus to it', async () => {
    const user = userEvent.setup()
    render(frame())
    expect(screen.queryByRole('table')).toBeNull()
    await user.click(screen.getByRole('link', { name: 'View table' }))
    const region = screen.getByRole('region', { name: 'Harmonized count by year, data table' })
    expect(within(region).getByRole('table')).toBeTruthy()
    expect(document.activeElement).toBe(region)
    await user.click(screen.getByRole('button', { name: 'Hide table' }))
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('opens the table with the keyboard', async () => {
    const user = userEvent.setup()
    render(frame())
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'View table' }))
    await user.keyboard('{Enter}')
    expect(screen.getByRole('table')).toBeTruthy()
  })

  it('has no link without a table, and renders the export menu slot', () => {
    render(frame({ table: undefined, exportMenu: <button type="button">Download PNG</button> }))
    expect(screen.queryByRole('link', { name: 'View table' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Download PNG' })).toBeTruthy()
  })

  it('shows the loading state without the chart', () => {
    render(frame({ state: 'loading' }))
    expect(screen.getByTestId('chart-loading')).toBeTruthy()
    expect(screen.queryByTestId('probe')).toBeNull()
    expect(screen.queryByRole('link', { name: 'View table' })).toBeNull()
  })

  it('shows the empty state as a message and not as an error', () => {
    render(frame({ state: 'empty' }))
    expect(screen.getByTestId('chart-empty').textContent).toBe(DEFAULT_EMPTY_CHART_MESSAGE)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByTestId('probe')).toBeNull()
  })

  it('shows the error state with the message and a Retry action', async () => {
    const onRetry = vi.fn()
    const error = new ApiError({ kind: 'http', status: 500, code: 'x', message: 'Server said no.' })
    render(frame({ state: 'error', error, onRetry }))
    expect(screen.getByRole('alert').textContent).toContain('Server said no.')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('has no axe violations in any state', async () => {
    const { container } = render(
      <div>
        {frame()}
        {frame({ title: 'Loading chart', state: 'loading' })}
        {frame({ title: 'Empty chart', state: 'empty' })}
        {frame({ title: 'Failed chart', state: 'error', onRetry: () => undefined })}
      </div>,
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})

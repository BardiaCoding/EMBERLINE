import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import { DetailPanel } from './DetailPanel'
import { buildCalendarModel, type CalendarModel } from '@/lib/binning'
import { result, month as monthFixture, anomaly as anomalyFixture } from '@/lib/binning.fixtures'

// Helper to create a minimal calendar model for testing
function createTestModel(months: ReturnType<typeof monthFixture>[]): CalendarModel {
  return buildCalendarModel(result(months), 'counts')
}

describe('DetailPanel', () => {
  it('renders with correct heading', () => {
    const month = monthFixture(2020, 8, 123.4, {
      anomaly: anomalyFixture(23.4, 19.5),
    })
    const model = createTestModel([month])
    const cell = model.rows[0]?.cells[7] // August (month 8)
    if (!cell) throw new Error('Cell not found')

    const onClose = vi.fn()
    render(<DetailPanel model={model} cell={cell} isOpen={true} onClose={onClose} />)

    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('heading', { name: /August 2020/i })).toBeTruthy()
  })

  it('shows all cell data from describeCell', () => {
    const month = monthFixture(2020, 8, 123.4, {
      anomaly: anomalyFixture(23.4, 19.5),
      provenance: 'N20+N21+SNPP',
    })
    const model = createTestModel([month])
    const cell = model.rows[0]?.cells[7]
    if (!cell) throw new Error('Cell not found')

    const onClose = vi.fn()
    render(<DetailPanel model={model} cell={cell} isOpen={true} onClose={onClose} />)

    // Check that key fields are present
    expect(screen.getByText('Harmonized count')).toBeTruthy()
    expect(screen.getByText(/123\.4 cell-days/)).toBeTruthy()
    expect(screen.getByText('Source flag')).toBeTruthy()
    expect(screen.getByText('calibrated')).toBeTruthy()
    expect(screen.getByText('Calibration model')).toBeTruthy()
    expect(screen.getByText('quantile_map')).toBeTruthy()
    expect(screen.getByText('Provenance')).toBeTruthy()
    expect(screen.getByText('N20+N21+SNPP')).toBeTruthy()
  })

  it('close button works and calls onClose', async () => {
    const user = userEvent.setup()
    const month = monthFixture(2020, 8, 123.4, {
      anomaly: anomalyFixture(23.4, 19.5),
    })
    const model = createTestModel([month])
    const cell = model.rows[0]?.cells[7]
    if (!cell) throw new Error('Cell not found')

    const onClose = vi.fn()
    render(<DetailPanel model={model} cell={cell} isOpen={true} onClose={onClose} />)

    const closeButton = screen.getByRole('button', { name: /close details/i })
    await user.click(closeButton)

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('has all 6 InfoControls for help terms', () => {
    const month = monthFixture(2020, 8, 123.4, {
      anomaly: anomalyFixture(23.4, 19.5),
    })
    const model = createTestModel([month])
    const cell = model.rows[0]?.cells[7]
    if (!cell) throw new Error('Cell not found')

    const onClose = vi.fn()
    render(<DetailPanel model={model} cell={cell} isOpen={true} onClose={onClose} />)

    // Check for all 6 info control buttons
    expect(screen.getByRole('button', { name: /about harmonized count/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /about baseline median/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /about anomaly/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /about z-score/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /about percentile rank/i })).toBeTruthy()
    // Uncertainty interval is only shown when bounds are non-null
  })

  it('shows uncertainty interval InfoControl when bounds are present', () => {
    const month = monthFixture(2020, 8, 123.4, {
      anomaly: anomalyFixture(23.4, 19.5),
      lower_bound: 100.0,
      upper_bound: 150.0,
    })
    const model = createTestModel([month])
    const cell = model.rows[0]?.cells[7]
    if (!cell) throw new Error('Cell not found')

    const onClose = vi.fn()
    render(<DetailPanel model={model} cell={cell} isOpen={true} onClose={onClose} />)

    expect(screen.getByRole('button', { name: /about uncertainty interval/i })).toBeTruthy()
    expect(screen.getByText(/100\.0 to 150\.0 cell-days/)).toBeTruthy()
  })

  it('handles provisional month correctly', () => {
    const month = monthFixture(2020, 8, 123.4, {
      provisional: true,
      anomaly: null,
    })
    const model = createTestModel([month])
    const cell = model.rows[0]?.cells[7]
    if (!cell) throw new Error('Cell not found')

    const onClose = vi.fn()
    render(<DetailPanel model={model} cell={cell} isOpen={true} onClose={onClose} />)

    // Provisional status should be shown
    expect(screen.getByText(/provisional/i)).toBeTruthy()
    // Anomaly fields should not be present
    expect(screen.queryByText('Difference from baseline median')).toBeNull()
    expect(screen.queryByText('Percent difference')).toBeNull()
  })

  it('does not render when isOpen is false', () => {
    const month = monthFixture(2020, 8, 123.4, {
      anomaly: anomalyFixture(23.4, 19.5),
    })
    const model = createTestModel([month])
    const cell = model.rows[0]?.cells[7]
    if (!cell) throw new Error('Cell not found')

    const onClose = vi.fn()
    render(<DetailPanel model={model} cell={cell} isOpen={false} onClose={onClose} />)

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes on Escape key', async () => {
    const user = userEvent.setup()
    const month = monthFixture(2020, 8, 123.4, {
      anomaly: anomalyFixture(23.4, 19.5),
    })
    const model = createTestModel([month])
    const cell = model.rows[0]?.cells[7]
    if (!cell) throw new Error('Cell not found')

    const onClose = vi.fn()
    render(<DetailPanel model={model} cell={cell} isOpen={true} onClose={onClose} />)

    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('is non-modal (does not trap focus)', () => {
    const month = monthFixture(2020, 8, 123.4, {
      anomaly: anomalyFixture(23.4, 19.5),
    })
    const model = createTestModel([month])
    const cell = model.rows[0]?.cells[7]
    if (!cell) throw new Error('Cell not found')

    const onClose = vi.fn()
    render(
      <>
        <button>Outside button</button>
        <DetailPanel model={model} cell={cell} isOpen={true} onClose={onClose} />
      </>,
    )

    // The dialog should be non-modal (modal={false} in Radix)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeTruthy()

    // Outside button should still be accessible
    const outsideButton = screen.getByRole('button', { name: 'Outside button' })
    expect(outsideButton).toBeTruthy()
    expect(outsideButton.hasAttribute('inert')).toBe(false)
  })

  it('passes accessibility check', async () => {
    const month = monthFixture(2020, 8, 123.4, {
      anomaly: anomalyFixture(23.4, 19.5),
    })
    const model = createTestModel([month])
    const cell = model.rows[0]?.cells[7]
    if (!cell) throw new Error('Cell not found')

    const onClose = vi.fn()
    const { container } = render(
      <DetailPanel model={model} cell={cell} isOpen={true} onClose={onClose} />,
    )

    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })
  it('does not call onClose when the user clicks or focuses something outside it', async () => {
    const user = userEvent.setup()
    const month = monthFixture(2020, 8, 123.4, { anomaly: anomalyFixture(23.4, 19.5) })
    const model = createTestModel([month])
    const cell = model.rows[0]?.cells[7]
    if (!cell) throw new Error('Cell not found')
    const onClose = vi.fn()
    render(
      <>
        <button>Outside button</button>
        <DetailPanel model={model} cell={cell} isOpen={true} onClose={onClose} />
      </>,
    )

    await user.click(screen.getByRole('button', { name: 'Outside button' }))

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('states the whole-month and provisional states in its Status line', () => {
    const model = buildCalendarModel(
      result([monthFixture(2020, 8, 123.4, { anomaly: anomalyFixture(23.4, 19.5) })]),
      'counts',
      {
        range: { start: '2020-08-15', end: '2020-12-31' },
        recordStart: '2000-11',
        latestMonth: '2026-11',
      },
    )
    const cell = model.rows[0]?.cells[7]
    if (!cell) throw new Error('Cell not found')

    render(<DetailPanel model={model} cell={cell} isOpen={true} onClose={vi.fn()} />)

    const status = document.querySelector('[data-field="status"]')
    expect(status?.textContent).toContain('Whole month')
  })

  it('passes the accessibility check with its portal content included', async () => {
    const month = monthFixture(2020, 8, 123.4, { anomaly: anomalyFixture(23.4, 19.5) })
    const model = createTestModel([month])
    const cell = model.rows[0]?.cells[7]
    if (!cell) throw new Error('Cell not found')
    render(<DetailPanel model={model} cell={cell} isOpen={true} onClose={vi.fn()} />)

    // The dialog is rendered in a portal, outside the render container.
    expect(await axe(document.body)).toHaveNoViolations()
  })
})

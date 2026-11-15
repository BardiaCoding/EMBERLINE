import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { axe } from 'vitest-axe'
import { anomaly } from '@/lib/binning.fixtures'
import { currentMonth, currentYear } from '@/lib/stats.fixtures'
import { KeyFigureCards } from './KeyFigureCards'

// Synthetic values. TEST FIXTURE, not NASA data.
const text = (testId: string): string => screen.getByTestId(testId).textContent

describe('KeyFigureCards', () => {
  it('shows the month and the year against their baselines with signed differences', () => {
    render(<KeyFigureCards currentMonth={currentMonth()} currentYear={currentYear()} />)
    const month = text('card-current-month')
    expect(month).toContain('December 2003')
    expect(month).toContain('33.0')
    expect(month).toContain('cell-days (MODIS-equivalent)')
    expect(text('card-current-month-baseline')).toContain(
      'Baseline median for December: 21.0 (20 years)',
    )
    expect(text('card-current-month-difference')).toContain('+12.0 (+57.1%) against the median')
    expect(text('card-current-month-difference')).toContain('Percentile rank: 80.0')
    const year = text('card-current-year')
    expect(year).toContain('2003')
    expect(text('card-current-year-baseline')).toContain('Baseline yearly median: 350.0 (20 years)')
    expect(text('card-current-year-difference')).toContain(
      '+50.0 (+14.3%) against the yearly median',
    )
    expect(text('card-current-year-difference')).toContain('Percentile rank (0 to 100)')
    expect(document.body.textContent).toContain('local standard time, UTC-8')
  })

  it('shows a negative difference with a minus sign', () => {
    render(
      <KeyFigureCards
        currentMonth={currentMonth({ anomaly: anomaly(-5.5, -20) })}
        currentYear={null}
      />,
    )
    expect(text('card-current-month-difference')).toContain('-5.5 (-20.0%)')
  })

  it('says "no typical fires" instead of a percent when the baseline median is 0', () => {
    render(
      <KeyFigureCards
        currentMonth={currentMonth({
          baseline_median: 0,
          harmonized: 4,
          anomaly: anomaly(4, null),
        })}
        currentYear={null}
      />,
    )
    const difference = text('card-current-month-difference')
    expect(difference).toContain('no typical fires in this month; +4.0 against the median')
    expect(difference).not.toMatch(/Infinity|NaN/)
  })

  it('shows a provisional month as a count to date with no baseline comparison', () => {
    render(
      <KeyFigureCards
        currentMonth={currentMonth({ provisional: true, baseline_median: null, anomaly: null })}
        currentYear={currentYear({
          provisional: true,
          n_months: 11,
          baseline_median: null,
          percentile_rank: null,
          anomaly: null,
        })}
      />,
    )
    expect(text('card-current-month-status')).toContain('Count to date (provisional)')
    expect(screen.queryByTestId('card-current-month-baseline')).toBeNull()
    expect(screen.queryByTestId('card-current-month-difference')).toBeNull()
    expect(text('card-current-year')).toContain('(provisional)')
    expect(text('card-current-year-status')).toContain('not compared with full years')
    expect(screen.queryByTestId('card-current-year-baseline')).toBeNull()
  })

  it('labels a partial year and makes no baseline claim for it', () => {
    render(
      <KeyFigureCards
        currentMonth={null}
        currentYear={currentYear({ n_months: 5, baseline_median: null, anomaly: null })}
      />,
    )
    expect(text('card-current-year')).toContain('Partial year: 5 months are in the range.')
    expect(screen.queryByTestId('card-current-year-baseline')).toBeNull()
  })

  it('explains when the end of the range has no month or year', () => {
    render(<KeyFigureCards currentMonth={null} currentYear={null} />)
    expect(screen.queryByTestId('card-current-month')).toBeNull()
    expect(document.body.textContent).toContain('no current month or year to compare')
  })

  it('has no axe violations', async () => {
    const { container } = render(
      <KeyFigureCards currentMonth={currentMonth()} currentYear={currentYear()} />,
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { WatchBadge } from './WatchBadge'
import type { WatchBadgeData } from '@/lib/watch'

describe('WatchBadge', () => {
  it('renders "Above normal" with warning styling', () => {
    const data: WatchBadgeData = {
      level: 'Above normal',
      tooltip: 'November 2026, 1,234.5 cell-days (MODIS-equivalent), baseline median 890.2',
    }
    const { container } = render(<WatchBadge data={data} />)
    const badge = screen.getByText('Above normal')
    expect(badge.getAttribute('title')).toBe(data.tooltip)
    // Check for warning variant classes
    expect(container.querySelector('.bg-orange-100')).not.toBeNull()
  })

  it('renders "Within normal range" with success styling', () => {
    const data: WatchBadgeData = {
      level: 'Within normal range',
      tooltip: 'October 2026, 450.0 cell-days (MODIS-equivalent), baseline median 500.5',
    }
    const { container } = render(<WatchBadge data={data} />)
    const badge = screen.getByText('Within normal range')
    expect(badge.getAttribute('title')).toBe(data.tooltip)
    // Check for success variant classes
    expect(container.querySelector('.bg-green-100')).not.toBeNull()
  })

  it('renders "Not available" with muted styling', () => {
    const data: WatchBadgeData = {
      level: 'Not available',
      tooltip: 'Fewer than 5 baseline years',
    }
    const { container } = render(<WatchBadge data={data} />)
    const badge = screen.getByText('Not available')
    expect(badge.getAttribute('title')).toBe(data.tooltip)
    // Check for muted variant classes
    expect(container.querySelector('.bg-muted')).not.toBeNull()
  })

  it('includes aria-label with level and tooltip', () => {
    const data: WatchBadgeData = {
      level: 'Above normal',
      tooltip: 'November 2026, 95.3th percentile',
    }
    render(<WatchBadge data={data} />)
    const badge = screen.getByLabelText(/Watch level: Above normal/)
    expect(badge.getAttribute('aria-label')).toBe(
      'Watch level: Above normal. November 2026, 95.3th percentile',
    )
  })

  it('accepts custom className', () => {
    const data: WatchBadgeData = {
      level: 'Within normal range',
      tooltip: 'Test tooltip',
    }
    render(<WatchBadge data={data} className="custom-class" />)
    const badge = screen.getByText('Within normal range')
    expect(badge.className).toContain('custom-class')
  })

  it('displays tooltip in title attribute', () => {
    const longTooltip =
      'November 2026, 1,234.5 cell-days (MODIS-equivalent), baseline median 890.2, 95.3th percentile, baseline 2000 to 2025 (26 years), (above 90th percentile)'
    const data: WatchBadgeData = {
      level: 'Above normal',
      tooltip: longTooltip,
    }
    render(<WatchBadge data={data} />)
    const badge = screen.getByText('Above normal')
    expect(badge.getAttribute('title')).toBe(longTooltip)
  })

  it('has no accessibility violations for "Above normal"', async () => {
    const data: WatchBadgeData = {
      level: 'Above normal',
      tooltip: 'November 2026, 95.3th percentile',
    }
    const { container } = render(<WatchBadge data={data} />)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('has no accessibility violations for "Within normal range"', async () => {
    const data: WatchBadgeData = {
      level: 'Within normal range',
      tooltip: 'October 2026, 42.0th percentile',
    }
    const { container } = render(<WatchBadge data={data} />)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('has no accessibility violations for "Not available"', async () => {
    const data: WatchBadgeData = {
      level: 'Not available',
      tooltip: 'Watch level not available',
    }
    const { container } = render(<WatchBadge data={data} />)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('renders with provisional information in tooltip', () => {
    const data: WatchBadgeData = {
      level: 'Above normal',
      tooltip:
        'October 2026, 1,234.5 cell-days (MODIS-equivalent), 95.3th percentile, Provisional: November 2026 to date 567.8 cell-days (MODIS-equivalent)',
    }
    render(<WatchBadge data={data} />)
    const badge = screen.getByText('Above normal')
    expect(badge.getAttribute('title')).toContain('Provisional: November 2026 to date')
  })
})

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { render, screen, within } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { AppShell } from './AppShell'

describe('AppShell', () => {
  it('shows the product name, the region label and the data badge', () => {
    render(<AppShell latestMonth="2026-11" />)
    expect(screen.getByRole('heading', { level: 1, name: PRODUCT_SHORT_NAME })).toBeTruthy()
    expect(screen.getByText('California region')).toBeTruthy()
    expect(screen.getByTestId('data-badge').textContent).toBe('Data to November 2026')
  })

  it('marks an incomplete latest month as provisional', () => {
    render(<AppShell latestMonth="2026-11" latestMonthIncomplete />)
    expect(screen.getByTestId('data-badge').textContent).toBe('Data to November 2026 (provisional)')
  })

  it('does not invent a month when the latest month is unknown', () => {
    render(<AppShell latestMonth={null} />)
    expect(screen.getByTestId('data-badge').textContent).toBe('Data range not loaded')
  })

  it('links to Methods and Help from the header', () => {
    render(<AppShell latestMonth={null} />)
    const nav = screen.getByRole('navigation', { name: 'Primary' })
    expect(within(nav).getByRole('link', { name: 'Methods' }).getAttribute('href')).toBe('/methods')
    expect(within(nav).getByRole('link', { name: 'Help' })).toBeTruthy()
  })

  it('renders the control, map and results panels with their content', () => {
    render(
      <AppShell
        latestMonth="2026-11"
        controls={<p>controls content</p>}
        map={<p>map content</p>}
        results={<p>results content</p>}
      />,
    )
    const controls = screen.getByRole('region', { name: 'Area and dates' })
    const map = screen.getByRole('region', { name: 'Map' })
    const results = screen.getByRole('region', { name: 'Results' })
    expect(within(controls).getByText('controls content')).toBeTruthy()
    expect(within(map).getByText('map content')).toBeTruthy()
    expect(within(results).getByText('results content')).toBeTruthy()
  })

  it('never says "California state"', () => {
    const { container } = render(<AppShell latestMonth="2026-11" />)
    expect(container.textContent).not.toMatch(/california state/i)
  })

  it('has no axe violations', async () => {
    const { container } = render(
      <AppShell
        latestMonth="2026-11"
        latestMonthIncomplete
        controls={<p>c</p>}
        map={<p>m</p>}
        results={<p>r</p>}
      />,
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})

// Vitest runs with `css: false`, so the CSS source is read from disk.
const readCss = (name: string): string =>
  readFileSync(path.resolve(import.meta.dirname, '../styles', name), 'utf8')
const indexCss = readCss('index.css')
const tokensCss = readCss('tokens.css')

describe('layout contract (CSS source)', () => {
  it('sets the 320 px and 560 px panel widths as tokens', () => {
    expect(tokensCss).toMatch(/--control-panel-width:\s*320px/)
    expect(tokensCss).toMatch(/--results-panel-width:\s*560px/)
  })

  it('uses a 4 px spacing unit', () => {
    expect(tokensCss).toMatch(/--space-unit:\s*4px/)
    expect(tokensCss).toMatch(/--space-1:\s*4px/)
  })

  it('defines light and dark token sets', () => {
    expect(tokensCss).toMatch(/:root\s*\{/)
    expect(tokensCss).toMatch(/:root\.dark\s*\{/)
  })

  it('switches layout at 768 px and 1280 px', () => {
    expect(indexCss).toMatch(/@media \(min-width: 768px\)/)
    expect(indexCss).toMatch(/@media \(min-width: 1280px\)/)
    expect(indexCss).toMatch(/'controls map results'/)
    expect(indexCss).toMatch(/'controls results' 'map results'/)
    expect(indexCss).toMatch(/'controls' 'map' 'results'/)
  })
})

import { render, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { axe } from 'vitest-axe'
import { AppRoutes } from '@/AppRoutes'
import type { MetaOut } from '@/lib/api'
import { QueryProvider } from '@/lib/QueryProvider'
import { createQueryClient } from '@/lib/queryClient'
import { server } from '@/test/server'
import { MethodsPage } from './MethodsPage'
import { isMethodsPath } from './path'
import { renderMarkdown } from './markdown'
import { LIMITATIONS } from './methodsContent'

// Synthetic values. TEST FIXTURE, not NASA data.
const ORIGIN = window.location.origin
const meta: MetaOut = {
  name: 'California region',
  extent: { west: -124.4, south: 32.5, east: -114.0, north: 42.2 },
  record_start: '2000-11',
  first_date: '2000-11-01',
  latest_month: '2003-12',
  latest_month_incomplete: false,
  latest_complete_month: '2003-12',
  latest_detection_local_date: '2003-12-31',
  latest_detection_utc: '2004-01-01T01:00:00Z',
  time_convention: 'local standard time, UTC-8',
  unit: 'cell-days (MODIS-equivalent)',
  watch_threshold: 90,
  limitations: [],
  example_areas: [],
  bounds_available: false,
}

function renderPage(ui = <MethodsPage />) {
  server.use(http.get(`${ORIGIN}/api/v1/meta`, () => HttpResponse.json(meta)))
  return render(<QueryProvider client={createQueryClient()}>{ui}</QueryProvider>)
}

function textOf(): string {
  return document.body.textContent.replace(/\s+/g, ' ')
}

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('MethodsPage', () => {
  it('shows the validation numbers from DATA_README exactly', () => {
    renderPage()
    expect(screen.getByTestId('validation-holdout').textContent).toBe(
      'Holdout error of the chosen model (quantile mapping): RMSE 22.2, bias 0.8, seasonality correlation 0.989.',
    )
    const switchover = screen.getByTestId('validation-switchover').textContent
    expect(switchover).toContain('383.7')
    expect(switchover).toContain('366.3')
    expect(switchover).toContain('-4.5%')
    expect(screen.getByTestId('validation-regions').textContent).toContain(
      '96 of 98 regions have validation metrics',
    )
    expect(screen.getByTestId('validation-regions').textContent).toContain('13 data-poor regions')
    expect(screen.getByTestId('validation-optimism').textContent).toContain('slightly optimistic')
    const table = screen.getByRole('table')
    expect(
      within(table).getByRole('row', { name: /quantile_map \(chosen\) 22\.2 0\.8 0\.989/ }),
    ).toBeTruthy()
    expect(within(table).getByRole('row', { name: /ratio_month 91\.0 -11\.8 0\.945/ })).toBeTruthy()
    expect(
      within(table).getByRole('row', { name: /log_regression 102\.3 -11\.4 0\.973/ }),
    ).toBeTruthy()
  })

  it('states the region, time convention, unit, harmonization scope, filters and source', () => {
    renderPage()
    const text = textOf()
    expect(text).toContain('California region')
    expect(text).not.toMatch(/California state/i)
    expect(text).not.toMatch(/clipped to the state|neighbouring areas/i)
    expect(text).toContain('fixed UTC-8')
    expect(text).toContain('no daylight saving')
    expect(text).toContain('cell-days')
    expect(text).toContain('One cell-day is one 1 km cell')
    expect(text).toContain('Harmonization applies to the monthly counts only')
    expect(text).toContain('raw filtered detections')
    expect(text).toContain('not individually harmonized')
    expect(text).toContain('Low-confidence detections were dropped')
    expect(text).toContain('type 0')
    expect(text).toContain('211 persistent static-source cells')
    expect(text).toContain('approximate')
    expect(text).toContain('NASA FIRMS')
    expect(text).toContain('Data build date: 2026-11-14')
    const link = screen.getByRole('link', { name: 'firms.modaps.eosdis.nasa.gov' })
    expect(link.getAttribute('href')).toBe('https://firms.modaps.eosdis.nasa.gov/')
  })

  it('lists every known limitation', () => {
    renderPage()
    const list = screen.getByTestId('limitations-list')
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(LIMITATIONS.length)
    const text = list.textContent
    for (const phrase of [
      'Calibration assumes the overlap period represents the earlier regime',
      'Terra and Aqua overpass times drift',
      'VIIRS constellation changed in 2018 and 2023',
      'Pre-2012 small fires are undercounted',
      'Cloud and smoke reduce detections',
      'Near-real-time filtering is approximate',
      'latest month is incomplete and provisional',
      'never plotted as a full month',
      'quantile mapping can turn small counts into zero',
      'Before Aqua started, only Terra provides coverage',
      '96 of 98 regions have validation metrics',
      'slightly optimistic',
    ]) {
      expect(text).toContain(phrase)
    }
  })

  it('renders docs/methodology.md and links back to the calendar', () => {
    renderPage()
    const doc = screen.getByTestId('methodology-document')
    expect(within(doc).getByRole('heading', { name: 'Counting unit' })).toBeTruthy()
    expect(doc.textContent).toContain('MODIS-equivalent')
    expect(screen.getByRole('link', { name: 'Back to the calendar' }).getAttribute('href')).toBe(
      '/',
    )
  })

  it('keeps the Methods link in the header, marked as the current page', async () => {
    renderPage()
    const nav = screen.getByRole('navigation', { name: 'Primary' })
    const link = within(nav).getByRole('link', { name: 'Methods' })
    expect(link.getAttribute('href')).toBe('/methods')
    expect(link.getAttribute('aria-current')).toBe('page')
    expect((await screen.findByText('Data to December 2003')).textContent).toBe(
      'Data to December 2003',
    )
  })

  it('has no axe violations', async () => {
    const { container } = renderPage()
    await screen.findByText('Data to December 2003')
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('AppRoutes', () => {
  it('matches /methods with or without a trailing slash and nothing else', () => {
    expect(isMethodsPath('/methods')).toBe(true)
    expect(isMethodsPath('/methods/')).toBe(true)
    expect(isMethodsPath('/')).toBe(false)
    expect(isMethodsPath('/methods-old')).toBe(false)
    expect(isMethodsPath('/a/methods')).toBe(false)
  })

  it('shows the methods page at /methods', () => {
    window.history.replaceState(null, '', '/methods')
    renderPage(<AppRoutes />)
    expect(screen.getByRole('heading', { name: 'Methods and data' })).toBeTruthy()
  })
})

describe('renderMarkdown', () => {
  it('renders headings, lists, bold, code and safe links, and drops unsafe links', () => {
    const { container } = render(
      <div>
        {renderMarkdown(
          '# Title\n\n## Head\n\nText **bold** `code` [ok](https://example.org) [bad](javascript:alert(1))\n\n- one\n- two',
        )}
      </div>,
    )
    expect(container.querySelector('h3')?.textContent).toBe('Head')
    expect(container.querySelector('h1')).toBeNull()
    expect(container.querySelector('strong')?.textContent).toBe('bold')
    expect(container.querySelector('code')?.textContent).toBe('code')
    expect(container.querySelectorAll('li')).toHaveLength(2)
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(['https://example.org'])
  })
})

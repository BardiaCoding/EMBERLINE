import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import fc from 'fast-check'
import { axe } from 'vitest-axe'
import { AppShell } from '@/components/AppShell'
import { basemapStyleFor } from './basemapStyle'
import { applyTheme, readStoredTheme, THEME_STORAGE_KEY, type ThemeChoice } from './theme'
import { ThemeToggle } from './ThemeToggle'

const root = document.documentElement
beforeEach(() => {
  window.localStorage.clear()
  root.classList.remove('light', 'dark')
})

describe('ThemeToggle', () => {
  it('is a named radiogroup with System checked by default', () => {
    render(<ThemeToggle />)
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'System' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: 'Dark' }).getAttribute('aria-checked')).toBe('false')
  })

  it('applies and saves a choice, and clears the saved value for System', async () => {
    const user = userEvent.setup()
    render(<ThemeToggle />)
    await user.click(screen.getByRole('radio', { name: 'Dark' }))
    expect(root.classList.contains('dark')).toBe(true)
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    await user.click(screen.getByRole('radio', { name: 'Light' }))
    expect(root.classList.contains('dark')).toBe(false)
    expect(root.classList.contains('light')).toBe(true)
    await user.click(screen.getByRole('radio', { name: 'System' }))
    expect(root.classList.contains('light')).toBe(false)
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
  })

  it('restores the saved choice on a later visit', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    render(<ThemeToggle />)
    expect(screen.getByRole('radio', { name: 'Dark' }).getAttribute('aria-checked')).toBe('true')
  })

  it('moves with the arrow keys', () => {
    render(<ThemeToggle />)
    fireEvent.keyDown(screen.getByRole('radio', { name: 'System' }), { key: 'ArrowRight' })
    expect(screen.getByRole('radio', { name: 'Light' }).getAttribute('aria-checked')).toBe('true')
  })

  it('has a header control and no axe violations', async () => {
    const { container } = render(<AppShell latestMonth="2026-11" />)
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeTruthy()
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('stored theme', () => {
  it('falls back to system for unknown values and blocked storage', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'purple')
    expect(readStoredTheme()).toBe('system')
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(readStoredTheme()).toBe('system')
    spy.mockRestore()
  })

  it('applyTheme leaves exactly the class of the choice', () => {
    fc.assert(
      fc.property(fc.constantFrom<ThemeChoice>('light', 'dark', 'system'), (choice) => {
        applyTheme(choice)
        const expected = choice === 'system' ? [] : [choice]
        expect([...root.classList].filter((c) => c === 'light' || c === 'dark')).toEqual(expected)
      }),
    )
  })
})

describe('basemap style', () => {
  it('darkens the tiles in the dark theme only', () => {
    expect(JSON.stringify(basemapStyleFor(false))).not.toContain('raster-brightness-max')
    expect(JSON.stringify(basemapStyleFor(true))).toContain('raster-brightness-max')
  })
})

describe('CSS and HTML source', () => {
  const web = path.resolve(import.meta.dirname, '../../..')
  const html = readFileSync(path.join(web, 'index.html'), 'utf8')
  const css = readFileSync(path.join(web, 'src/styles/index.css'), 'utf8')

  it('sets the saved theme in an inline script before the app bundle', () => {
    expect(html.indexOf(THEME_STORAGE_KEY)).toBeGreaterThan(-1)
    expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('type="module"'))
    expect(html).toMatch(/classList\.add/)
  })

  it('keeps the page from scrolling sideways and stacks below 768 px', () => {
    expect(css).toMatch(/overflow-x:\s*clip/)
    expect(css).toMatch(/min-width:\s*0/)
    expect(css).toMatch(/'controls' 'map' 'results'/)
  })
})

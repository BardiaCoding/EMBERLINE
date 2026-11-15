import { useCallback, useSyncExternalStore } from 'react'

/** The three choices of the theme control. `system` follows the OS colour-scheme preference. */
export type ThemeChoice = 'light' | 'dark' | 'system'

/** localStorage key. The inline script in `index.html` reads the same key (keep both in step). */
export const THEME_STORAGE_KEY = 'hfc-theme'
export const THEME_CHOICES: readonly ThemeChoice[] = ['light', 'dark', 'system']

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === 'light' || value === 'dark' || value === 'system'
}

/** The saved choice. Storage that is missing, blocked or holds another value gives `system`. */
export function readStoredTheme(): ThemeChoice {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isThemeChoice(value) ? value : 'system'
  } catch {
    return 'system'
  }
}

/** Sets or clears the `.light` / `.dark` class on `<html>`. `system` leaves the CSS media query in charge. */
export function applyTheme(choice: ThemeChoice): void {
  const classes = document.documentElement.classList
  classes.remove('light', 'dark')
  if (choice !== 'system') classes.add(choice)
}

/** Saves and applies a choice. A storage failure still applies the theme for this visit. */
export function saveTheme(choice: ThemeChoice): void {
  try {
    if (choice === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY)
    else window.localStorage.setItem(THEME_STORAGE_KEY, choice)
  } catch {
    // Blocked storage: the choice lasts until the page closes.
  }
  applyTheme(choice)
  listeners.forEach((l) => {
    l()
  })
}

const listeners = new Set<() => void>()

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_STORAGE_KEY || e.key === null) {
      applyTheme(readStoredTheme())
      onChange()
    }
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('storage', onStorage)
  }
}

/** The current choice and a setter. */
export function useTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const choice = useSyncExternalStore(subscribe, readStoredTheme, () => 'system' as const)
  const set = useCallback((next: ThemeChoice) => {
    saveTheme(next)
  }, [])
  return [choice, set]
}

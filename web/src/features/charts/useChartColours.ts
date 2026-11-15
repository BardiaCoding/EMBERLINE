import { useSyncExternalStore } from 'react'
import { CHART_COLOURS_DARK, CHART_COLOURS_LIGHT, type ChartColours } from '@/styles/palettes'

const DARK_QUERY = '(prefers-color-scheme: dark)'

/** True when the dark theme applies: the `.dark` class, or the OS preference without a `.light` class. */
export function isDarkTheme(): boolean {
  const classes = document.documentElement.classList
  if (classes.contains('dark')) return true
  if (classes.contains('light')) return false
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches
}

function subscribe(onChange: () => void): () => void {
  const media = typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null
  media?.addEventListener('change', onChange)
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => {
    media?.removeEventListener('change', onChange)
    observer.disconnect()
  }
}

/**
 * The chart colour set of the current theme. A canvas cannot read CSS variables, so the
 * colours are literal values from `styles/palettes.ts`. Follows the OS preference and the
 * `.dark` and `.light` classes on `<html>`.
 */
export function useChartColours(): ChartColours {
  return useIsDarkTheme() ? CHART_COLOURS_DARK : CHART_COLOURS_LIGHT
}
/** True while the dark theme applies; re-renders when it changes. */
export function useIsDarkTheme(): boolean {
  return useSyncExternalStore(subscribe, isDarkTheme, () => false)
}

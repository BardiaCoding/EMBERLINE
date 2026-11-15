import { useEffect, type RefObject } from 'react'

/** Name of the CSS custom property that `CalendarGrid` reads to size its scroll region. */
export const RESULTS_ABOVE_CALENDAR_VAR = '--results-above-calendar'

/**
 * Space above the Calendar scroll region, in px: the distance from the top of the page to the
 * bottom edge of `above` (the app header, the summary cards, the tabs). Rounded up.
 */
export function measureAboveCalendar(above: HTMLElement): number {
  return Math.ceil(above.getBoundingClientRect().bottom + window.scrollY)
}

/**
 * Publishes `--results-above-calendar` on `target` (for example the `ResultsPanel` root) and
 * keeps it current with a `ResizeObserver` on `above`, so the Calendar scroll region fills the
 * rest of the viewport (`100dvh - var(--results-above-calendar)`) and the cards and the newest
 * year rows fit without page scrolling (requirement 26.11). The property is removed on unmount.
 * Where `ResizeObserver` does not exist, the value is set once and on window resize.
 */
export function useResultsAboveCalendar(
  above: RefObject<HTMLElement | null>,
  target: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const aboveEl = above.current
    const targetEl = target.current
    if (aboveEl === null || targetEl === null) return undefined

    const update = (): void => {
      targetEl.style.setProperty(RESULTS_ABOVE_CALENDAR_VAR, `${measureAboveCalendar(aboveEl)}px`)
    }
    update()

    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(aboveEl)
    window.addEventListener('resize', update)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', update)
      targetEl.style.removeProperty(RESULTS_ABOVE_CALENDAR_VAR)
    }
  }, [above, target])
}

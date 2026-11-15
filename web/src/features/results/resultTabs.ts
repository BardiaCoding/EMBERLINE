/** The views of the results panel (design.md section 11.1). Recent is the last 7 days of raw detections (task 26.1). */
export const RESULT_TABS = [
  { id: 'calendar', label: 'Calendar' },
  { id: 'trends', label: 'Trends' },
  { id: 'season', label: 'Season' },
  { id: 'recent', label: 'Recent' },
] as const

export type ResultsTabId = (typeof RESULT_TABS)[number]['id']

/** Id of the tab button. `prefix` is unique per tab set (`useId`). */
export function tabElementId(prefix: string, id: ResultsTabId): string {
  return `${prefix}-tab-${id}`
}

/** Id of the tab panel that the tab controls. */
export function panelElementId(prefix: string, id: ResultsTabId): string {
  return `${prefix}-panel-${id}`
}

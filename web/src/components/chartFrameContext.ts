import { createContext, useContext } from 'react'

/** Element ids that `ChartFrame` gives to its chart, so the chart can name and describe itself. */
export type ChartFrameIds = {
  /** Id of the chart title (the accessible name of the chart). */
  titleId: string
  /** Id of the text summary (the accessible description of the chart). */
  summaryId: string
}

export const ChartFrameContext = createContext<ChartFrameIds | null>(null)

/** The ids of the enclosing `ChartFrame`, or null outside one. */
export function useChartFrameIds(): ChartFrameIds | null {
  return useContext(ChartFrameContext)
}

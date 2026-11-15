// Unified binning for comparison mode (requirements 19.4, 19.5).
// Both panels get one colour scale computed from the union of the two datasets, so the same
// colour means the same value in both panels and one legend serves both.
import type { CalendarOut } from '@/lib/api'
import {
  buildCalendarModel,
  countEdges,
  ANOMALY_EDGES,
  diffEdges,
  diffLimitOf,
  type CalendarModel,
  type CalendarOptions,
  type CalendarView,
} from '@/lib/binning'

export type UnifiedBinningInput = {
  result1: CalendarOut
  result2: CalendarOut
  view: CalendarView
  options1?: CalendarOptions
  options2?: CalendarOptions
}

export type UnifiedBinningOutput = {
  /** Calendar model for the first dataset, classed with the shared edges */
  model1: CalendarModel
  /** Calendar model for the second dataset, classed with the shared edges */
  model2: CalendarModel
  /** The shared inner edges used for both models */
  unifiedEdges: number[]
  /** Whether any cell with a value to class is displayed in either panel */
  hasData: boolean
}

/**
 * The values of a model that set its colour scale: displayed, non-provisional non-zero counts
 * (counts view) or month-to-month differences (diff view). The anomaly view has fixed edges.
 */
function scaleValues(model: CalendarModel, view: CalendarView): number[] {
  const out: number[] = []
  for (const row of model.rows) {
    for (const cell of row.cells) {
      if (cell.value === null || cell.provisional) continue
      if (view === 'counts' && cell.value > 0) out.push(cell.value)
      if (view === 'diff' && cell.diff !== null) out.push(cell.diff)
    }
  }
  return out
}

/**
 * Builds two calendar models that share one colour scale.
 *
 * Each panel is built once on its own to find the values that set its scale, then again with
 * the other panel's values added (`CalendarOptions.sharedScale`). Both then compute their
 * edges from the same union, so the edges are identical:
 * - Counts view: type-7 quantile edges of all non-zero displayed counts of both panels.
 * - Anomaly view: the fixed `ANOMALY_EDGES`.
 * - Diff view: symmetric bins from the 95th percentile of all absolute differences.
 */
export function buildUnifiedCalendarModels({
  result1,
  result2,
  view,
  options1,
  options2,
}: UnifiedBinningInput): UnifiedBinningOutput {
  const alone1 = buildCalendarModel(result1, view, options1)
  const alone2 = buildCalendarModel(result2, view, options2)
  if (view === 'anomaly') {
    return {
      model1: alone1,
      model2: alone2,
      unifiedEdges: [...ANOMALY_EDGES],
      hasData: alone1.total > 0 || alone2.total > 0,
    }
  }
  const values1 = scaleValues(alone1, view)
  const values2 = scaleValues(alone2, view)
  const all = [...values1, ...values2]
  let unifiedEdges: number[] = []
  if (view === 'counts') {
    unifiedEdges = countEdges(all)
  } else {
    const limit = diffLimitOf(all)
    unifiedEdges = limit > 0 ? diffEdges(limit) : []
  }
  return {
    model1: buildCalendarModel(result1, view, { ...options1, sharedScale: values2 }),
    model2: buildCalendarModel(result2, view, { ...options2, sharedScale: values1 }),
    unifiedEdges,
    hasData: all.length > 0,
  }
}

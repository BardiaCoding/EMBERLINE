// Feature: harmonized-fire-calendar, Property 45: Calendar binning is monotone and centred
// Validates: Requirements 15.2, 15.11, 15.13, 19.4
// Inputs are synthetic (TEST FIXTURE, not NASA data).
import * as fc from 'fast-check'
import { calendarResultWithAnomalies, withAnomalies } from '@/test/arbitraries'
import { BLUE_ORANGE_NEUTRAL_INDEX } from '@/styles/palettes'
import { ANOMALY_EDGES, buildCalendarModel, type CalendarCell, type CalendarView } from './binning'

const RUNS = { numRuns: 200 }
const VIEWS: readonly CalendarView[] = ['counts', 'anomaly', 'diff']
const TOP = 8

const displayed = (cells: CalendarCell[]): CalendarCell[] =>
  cells.filter((c) => c.value !== null && !c.provisional)

/** The quantity each view classifies: count, percent difference or month-to-month difference. */
function scoreOf(view: CalendarView, cell: CalendarCell): number | null {
  if (view === 'counts') return cell.value
  if (view === 'diff') return cell.diff
  return cell.data?.anomaly?.percent ?? null
}

/** A larger score never gets a lower class, over every pair of classified cells. */
function expectMonotone(view: CalendarView, cells: CalendarCell[]): void {
  const scored = cells.flatMap((c) => {
    const score = scoreOf(view, c)
    return c.classIndex === null || score === null ? [] : [{ score, cls: c.classIndex }]
  })
  scored.sort((a, b) => a.score - b.score)
  for (let i = 1; i < scored.length; i += 1) {
    expect(scored[i]?.cls ?? 0).toBeGreaterThanOrEqual(scored[i - 1]?.cls ?? 0)
  }
}

describe('Property 45: Calendar binning is monotone and centred', () => {
  it('never puts a larger value in a lower bin, in every view', () => {
    fc.assert(
      fc.property(calendarResultWithAnomalies(), ({ result, options }) => {
        for (const view of VIEWS) {
          const model = buildCalendarModel(result, view, options)
          expectMonotone(
            view,
            model.rows.flatMap((r) => r.cells),
          )
          // The class index points at a bin of the model, and bin edges ascend.
          for (const cell of model.rows.flatMap((r) => r.cells)) {
            if (cell.classIndex !== null) expect(model.bins[cell.classIndex]).toBeDefined()
          }
          expect([...model.edges].sort((a, b) => a - b)).toEqual(model.edges)
        }
      }),
      RUNS,
    )
  })

  it('classifies the anomaly view by the 9 fixed percent bins, with the bin of zero neutral', () => {
    fc.assert(
      fc.property(calendarResultWithAnomalies(), ({ result, options }) => {
        const model = buildCalendarModel(result, 'anomaly', options)
        expect(model.edges).toEqual([...ANOMALY_EDGES])
        expect(model.bins).toHaveLength(9)
        const neutral = model.bins[BLUE_ORANGE_NEUTRAL_INDEX]
        expect(model.bins.filter((b) => b.neutral).map((b) => b.index)).toEqual([
          BLUE_ORANGE_NEUTRAL_INDEX,
        ])
        // The neutral bin is [-10, +10), so it contains zero.
        expect(neutral?.lower).toBe(-10)
        expect(neutral?.upper).toBe(10)

        for (const cell of displayed(model.rows.flatMap((r) => r.cells))) {
          const percent = cell.data?.anomaly?.percent
          if (percent === undefined) continue
          if (percent === null) {
            // Median 0: top bin when count > 0, neutral bin when count = 0.
            expect(cell.baselineMedian).toBe(0)
            expect(cell.classIndex).toBe(cell.value !== null && cell.value > 0 ? TOP : 4)
          } else {
            expect(cell.classIndex).toBe(ANOMALY_EDGES.filter((e) => percent >= e).length)
            if (percent >= -10 && percent < 10) expect(bin(model, cell)?.neutral).toBe(true)
          }
        }
      }),
      RUNS,
    )
  })

  it('keeps a zero month-to-month difference in the neutral bin, which contains zero', () => {
    fc.assert(
      fc.property(calendarResultWithAnomalies(), ({ result, options }) => {
        const model = buildCalendarModel(result, 'diff', options)
        const cells = displayed(model.rows.flatMap((r) => r.cells)).filter((c) => c.diff !== null)
        const limit = model.diffLimit ?? 0
        if (limit > 0) {
          expect(model.bins).toHaveLength(9)
          const neutral = model.bins[BLUE_ORANGE_NEUTRAL_INDEX]
          expect(neutral?.neutral).toBe(true)
          expect(neutral?.lower ?? 0).toBeLessThan(0)
          expect(neutral?.upper ?? 0).toBeGreaterThan(0)
          // Symmetric edges: edge k is the negative of edge 7 - k.
          model.edges.forEach((e, i) => {
            expect(e).toBeCloseTo(-(model.edges[model.edges.length - 1 - i] ?? 0), 9)
          })
        } else {
          expect(model.bins).toHaveLength(1)
          expect(model.bins[0]?.neutral).toBe(true)
        }
        for (const cell of cells) {
          expect(cell.classIndex).not.toBeNull()
          if (cell.diff === 0) expect(bin(model, cell)?.neutral).toBe(true)
        }
      }),
      RUNS,
    )
  })

  it('gives zero the lowest class and any non-zero count a higher class in the counts view', () => {
    fc.assert(
      fc.property(calendarResultWithAnomalies(), ({ result, options }) => {
        const model = buildCalendarModel(result, 'counts', options)
        for (const cell of displayed(model.rows.flatMap((r) => r.cells))) {
          if (cell.value === 0) expect(cell.classIndex).toBe(0)
          else expect(cell.classIndex ?? 0).toBeGreaterThanOrEqual(1)
        }
      }),
      RUNS,
    )
  })

  it('leaves the provisional month out of the edges, and gives it no class in any view', () => {
    fc.assert(
      fc.property(calendarResultWithAnomalies(), ({ result, options }) => {
        // Same result, but the provisional months hold a huge count.
        const inflated = withAnomalies({
          ...result,
          months: result.months.map((m) => (m.provisional ? { ...m, harmonized: 10_000_000 } : m)),
        })
        for (const view of VIEWS) {
          const a = buildCalendarModel(result, view, options)
          const b = buildCalendarModel(inflated, view, options)
          expect(b.edges).toEqual(a.edges)
          expect(b.diffLimit).toEqual(a.diffLimit)
          expect(b.bins.map((x) => [x.lower, x.upper, x.cells])).toEqual(
            a.bins.map((x) => [x.lower, x.upper, x.cells]),
          )
          const cellsA = a.rows.flatMap((r) => r.cells)
          const cellsB = b.rows.flatMap((r) => r.cells)
          cellsA.forEach((cell, i) => {
            if (cell.provisional) {
              expect(cell.classIndex).toBeNull()
              expect(cell.colour).toBeNull()
              expect(cellsB[i]?.classIndex).toBeNull()
            } else {
              expect(cellsB[i]?.classIndex).toBe(cell.classIndex)
            }
          })
        }
      }),
      RUNS,
    )
  })
})

function bin(
  model: ReturnType<typeof buildCalendarModel>,
  cell: CalendarCell,
): ReturnType<typeof buildCalendarModel>['bins'][number] | undefined {
  return cell.classIndex === null ? undefined : model.bins[cell.classIndex]
}

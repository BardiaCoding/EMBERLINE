// fast-check generators for the front-end property tests (design.md, "Applicable properties").
// Synthetic values only. TEST FIXTURE, not NASA data. Never shown in the app.
import * as fc from 'fast-check'
import type { CalendarOut, MonthOut } from '@/lib/api'
import type { CalendarOptions } from '@/lib/binning'
import { coverage, month as fixtureMonth } from '@/lib/binning.fixtures'
import type { AreaGeometry } from '@/lib/areaGeometry'
import type { AppState, UrlArea, UrlCompare, UrlView } from '@/lib/urlState'

const pad = (n: number, width = 2): string => String(n).padStart(width, '0')

/** Month index: `year * 12 + (month - 1)`. */
const indexOf = (year: number, month: number): number => year * 12 + (month - 1)
const yearOfIndex = (index: number): number => Math.floor(index / 12)
const monthOfIndex = (index: number): number => (index % 12) + 1
const keyOfIndex = (index: number): string =>
  `${pad(yearOfIndex(index), 4)}-${pad(monthOfIndex(index))}`

/** Days in month `month` (1 to 12) of `year`, without `Date` arithmetic on the local clock. */
export function daysInMonthOf(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
    return leap ? 29 : 28
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

/** A harmonized count rounded to 1 decimal, zero-heavy. */
const count = (): fc.Arbitrary<number> =>
  fc.oneof(
    { weight: 3, arbitrary: fc.constant(0) },
    { weight: 5, arbitrary: fc.integer({ min: 1, max: 50_000 }).map((n) => n / 10) },
  )

/** How a range end falls inside its month: on the boundary or partway. */
const dayPosition = fc.constantFrom('boundary', 'boundary', 'partway')

/** A `YYYY-MM-DD` date string of a real calendar date, years 2000 to 2030. */
export function isoDate(): fc.Arbitrary<string> {
  return fc
    .tuple(
      fc.integer({ min: 2000, max: 2030 }),
      fc.integer({ min: 1, max: 12 }),
      fc.integer({ min: 0, max: 30 }),
    )
    .map(([y, m, d]) => `${pad(y, 4)}-${pad(m)}-${pad(1 + (d % daysInMonthOf(y, m)))}`)
}

export type CalendarScenario = {
  result: CalendarOut
  /** The options `buildCalendarModel` gets: Date_Range, record start and latest month. */
  options: Required<Omit<CalendarOptions, 'sharedScale'>>
}

/**
 * A Calendar API result with the options of its query. The result holds every month from the
 * record start to the latest month, so a month is missing only where the record has none.
 * It also holds some months outside the record or the Date_Range. Counts are zero-heavy,
 * baseline medians are zero in some months, and the latest month is sometimes provisional.
 * The Date_Range may start or end before the record, after the latest month, or partway
 * through a month.
 */
export function calendarResult(): fc.Arbitrary<CalendarScenario> {
  const layout = fc.record({
    recordStart: fc.integer({ min: indexOf(2000, 11), max: indexOf(2003, 12) }),
    recordLength: fc.integer({ min: 0, max: 72 }),
    startOffset: fc.integer({ min: -18, max: 80 }),
    rangeLength: fc.integer({ min: 0, max: 60 }),
    startPosition: dayPosition,
    endPosition: dayPosition,
    startDay: fc.integer({ min: 0, max: 30 }),
    endDay: fc.integer({ min: 0, max: 30 }),
    provisionalLatest: fc.boolean(),
  })

  return layout.chain((l) => {
    const latest = l.recordStart + l.recordLength
    const startIdx = l.recordStart + l.startOffset
    const endIdx = startIdx + l.rangeLength
    const from = Math.min(startIdx, l.recordStart) - 2
    const to = Math.max(endIdx, latest) + 2
    const span = to - from + 1

    const startYear = yearOfIndex(startIdx)
    const startMonth = monthOfIndex(startIdx)
    const endYear = yearOfIndex(endIdx)
    const endMonth = monthOfIndex(endIdx)
    const startDays = daysInMonthOf(startYear, startMonth)
    const endDays = daysInMonthOf(endYear, endMonth)
    const startDay = l.startPosition === 'boundary' ? 1 : 1 + (l.startDay % startDays)
    let endDay = l.endPosition === 'boundary' ? endDays : 1 + (l.endDay % endDays)
    if (startIdx === endIdx && endDay < startDay) endDay = startDay

    const spec = fc.record({ value: count(), extra: fc.boolean() })
    const medians = fc.array(fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 5000 })), {
      minLength: 12,
      maxLength: 12,
    })

    return fc
      .tuple(fc.array(spec, { minLength: span, maxLength: span }), medians)
      .map(([specs, medianValues]): CalendarScenario => {
        const months: MonthOut[] = []
        const latestKey = keyOfIndex(latest)
        specs.forEach((s, i) => {
          const idx = from + i
          const inRecord = idx >= l.recordStart && idx <= latest
          if (!inRecord && !s.extra) return
          const isLatest = idx === latest
          months.push(
            fixtureMonth(yearOfIndex(idx), monthOfIndex(idx), s.value, {
              provisional: isLatest && l.provisionalLatest,
            }),
          )
        })
        const result: CalendarOut = {
          months,
          years: [],
          baseline_by_month: medianValues.map((median, i) => ({
            month: i + 1,
            median,
            p10: 0,
            p90: median + 1,
            mean: median,
            std: 0,
            n_years: 20,
          })),
          baseline_year: null,
          coverage: coverage(),
          n_cells: 5,
          notice: null,
          provisional_months: l.provisionalLatest ? [latestKey] : [],
          clipped_percent: null,
          area_km2: null,
        }
        return {
          result,
          options: {
            range: {
              start: `${pad(startYear, 4)}-${pad(startMonth)}-${pad(startDay)}`,
              end: `${pad(endYear, 4)}-${pad(endMonth)}-${pad(endDay)}`,
            },
            recordStart: keyOfIndex(l.recordStart),
            latestMonth: latestKey,
          },
        }
      })
  })
}

/**
 * Set the `anomaly` of every month of `result` from its baseline median, as the API does:
 * `absolute = harmonized - median`, `percent = absolute / median * 100`, and `percent = null`
 * when the median is 0. Synthetic values. TEST FIXTURE, not NASA data.
 */
export function withAnomalies(result: CalendarOut): CalendarOut {
  const medians = new Map(result.baseline_by_month.map((b) => [b.month, b.median]))
  return {
    ...result,
    months: result.months.map((m) => {
      const median = medians.get(m.month) ?? 0
      const absolute = m.harmonized - median
      const percent = median === 0 ? null : (absolute / median) * 100
      return {
        ...m,
        anomaly: {
          absolute,
          percent,
          percent_text: percent === null ? 'no typical fires in this month' : null,
          zscore: 0.5,
          percentile_rank: 60,
          baseline_start_year: 2000,
          baseline_end_year: 2025,
          n_years: 20,
        },
      }
    }),
  }
}

/** `calendarResult()` with the anomaly of each month set from the baseline medians. */
export function calendarResultWithAnomalies(): fc.Arbitrary<CalendarScenario> {
  return calendarResult().map(({ result, options }) => ({
    result: withAnomalies(result),
    options,
  }))
}

/**
 * `calendarResult()` with some months of the result removed at random, so a month inside the
 * record and the Date_Range can have no data (and its next month has no previous month).
 * Synthetic values. TEST FIXTURE, not NASA data.
 */
export function calendarResultWithGaps(): fc.Arbitrary<CalendarScenario> {
  return calendarResult().chain(({ result, options }) =>
    fc
      .array(fc.integer({ min: 0, max: 3 }), {
        minLength: result.months.length,
        maxLength: result.months.length,
      })
      // One month in four is dropped.
      .map((drops): CalendarScenario => ({
        result: { ...result, months: result.months.filter((_, i) => drops[i] !== 0) },
        options,
      })),
  )
}

// ---------------------------------------------------------------------------------------------
// URL state (task 24.2). Synthetic values. TEST FIXTURE, not NASA data.
// ---------------------------------------------------------------------------------------------

const lonArb = fc.double({ min: -180, max: 180, noNaN: true, noDefaultInfinity: true })
const latArb = fc.double({ min: -90, max: 90, noNaN: true, noDefaultInfinity: true })
const positionArb = fc.tuple(lonArb, latArb)

/**
 * A Polygon or MultiPolygon with at most `maxVertices` positions in total (default 1000, the
 * limit of the geometry code). Rings are not checked for validity: the code only stores them.
 */
export function urlGeometry(maxVertices = 1000): fc.Arbitrary<AreaGeometry> {
  const ring = (max: number): fc.Arbitrary<[number, number][]> =>
    fc.array(positionArb, { minLength: 1, maxLength: max })
  const polygon = (max: number): fc.Arbitrary<[number, number][][]> =>
    fc.array(ring(max), { minLength: 1, maxLength: 3 })
  // Up to 3 rings of `perRing` vertices each, 3 polygons at most: 9 rings.
  const perRing = Math.max(1, Math.floor(maxVertices / 9))
  return fc.oneof(
    polygon(perRing).map((coordinates): AreaGeometry => ({ type: 'Polygon', coordinates })),
    fc
      .array(polygon(perRing), { minLength: 1, maxLength: 3 })
      .map((coordinates): AreaGeometry => ({ type: 'MultiPolygon', coordinates })),
    // One ring right at the vertex limit.
    ring(maxVertices).map((r): AreaGeometry => ({ type: 'Polygon', coordinates: [r] })),
  )
}

const shareIdArb = fc.stringMatching(/^[A-Za-z0-9_-]{1,16}$/)

/** A region, a drawn geometry or a share id. */
export function urlArea(): fc.Arbitrary<UrlArea> {
  return fc.oneof(
    fc.constant<UrlArea>({ kind: 'region' }),
    urlGeometry().map((geometry): UrlArea => ({ kind: 'geom', geometry })),
    shareIdArb.map((id): UrlArea => ({ kind: 'share', id })),
  )
}

/** Two ISO dates with `start <= end`. */
function orderedDates(): fc.Arbitrary<[string, string]> {
  return fc.tuple(isoDate(), isoDate()).map(([a, b]) => (a <= b ? [a, b] : [b, a]))
}

/** A valid `AppState` for `encodeState` / `decodeState` (design.md section 11.2). */
export function appState(): fc.Arbitrary<AppState> {
  const compare = fc.oneof(
    fc.constant<UrlCompare>({ mode: 'none' }),
    fc
      .tuple(urlArea(), fc.boolean())
      .map(([area2, perArea]): UrlCompare => ({ mode: 'area', area2, perArea })),
    orderedDates().map(([start2, end2]): UrlCompare => ({ mode: 'period', start2, end2 })),
  )
  const baseline = fc
    .tuple(fc.integer({ min: 1900, max: 2200 }), fc.integer({ min: 1900, max: 2200 }))
    .map(([a, b]): [number, number] => (a <= b ? [a, b] : [b, a]))
  return fc
    .record({
      area: urlArea(),
      dates: orderedDates(),
      view: fc.constantFrom<UrlView>('counts', 'anomaly', 'diff'),
      compare,
      baseline: fc.option(baseline, { nil: undefined }),
      year: fc.option(fc.integer({ min: 1900, max: 2200 }), { nil: undefined }),
      seasonStart: fc.option(fc.integer({ min: 1, max: 12 }), { nil: undefined }),
      tab: fc.option(fc.stringMatching(/^[a-z][a-z0-9_-]{0,23}$/), { nil: undefined }),
      cell: fc.option(
        fc
          .tuple(fc.integer({ min: 2000, max: 2026 }), fc.integer({ min: 1, max: 12 }))
          .map(([year, month]) => `${year}-${String(month).padStart(2, '0')}`),
        { nil: undefined },
      ),
    })
    .map(({ dates, ...rest }): AppState => {
      const state: AppState = {
        area: rest.area,
        start: dates[0],
        end: dates[1],
        view: rest.view,
        compare: rest.compare,
      }
      if (rest.baseline !== undefined) state.baseline = rest.baseline
      if (rest.year !== undefined) state.year = rest.year
      if (rest.seasonStart !== undefined) state.seasonStart = rest.seasonStart
      if (rest.tab !== undefined) state.tab = rest.tab
      if (rest.cell !== undefined) state.cell = rest.cell
      return state
    })
}

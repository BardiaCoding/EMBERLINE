// Calendar model and colour classes (design.md section 11.4, requirements 15.1, 15.4, 15.6,
// 15.7, 15.11, 15.12). Pure functions, no I/O, no browser clock. Counts are harmonized
// cell-days per month (MODIS-equivalent). Months follow local standard time at a fixed UTC-8.
// Three views: counts (sequential, quantile classes), anomaly (percent difference from the
// Baseline median, 9 fixed bins) and diff (month-to-month difference, 9 symmetric bins).
import type { CalendarOut, MonthOut } from '@/lib/api'
import { firstDayOfMonth, lastDayOfMonth, monthOf, type DateRange } from '@/lib/dates'
import {
  formatCount,
  formatMonth,
  formatPercentDifference,
  formatSignedCount,
  isRealDate,
  MISSING,
  monthName,
  NO_TYPICAL_FIRES,
  TIME_CONVENTION,
  UNIT_CELL_DAYS,
} from '@/lib/format'
import { BLUE_ORANGE_DIVERGING, BLUE_ORANGE_NEUTRAL_INDEX, cividisClasses } from '@/styles/palettes'

/** Views of the Calendar (requirement 15.2, 15.3). */
export type CalendarView = 'counts' | 'anomaly' | 'diff'

/** The views in the order of the view switcher, with their visible names. */
export const CALENDAR_VIEWS: readonly { id: CalendarView; label: string }[] = [
  { id: 'counts', label: 'Counts' },
  { id: 'anomaly', label: 'Anomaly' },
  { id: 'diff', label: 'Month to month' },
]

/** `no_data`: outside the record, the latest month or the Date_Range. `zero`: exactly 0. */
export type CellState = 'no_data' | 'zero' | 'value'

/** First month with the native-to-calibrated switch (requirement 15.9). */
export const SWITCHOVER_MONTH = '2012-01'

/** Number of classes for non-zero counts (requirement 15.11). */
export const COUNT_CLASSES = 7

/**
 * Inner edges of the 9 fixed percent-difference bins of the anomaly view (requirement 15.11).
 * A percent difference `p` is in class `k` when `ANOMALY_EDGES[k - 1] <= p < ANOMALY_EDGES[k]`,
 * so class 4 is the neutral bin `[-10, +10)`.
 */
export const ANOMALY_EDGES: readonly number[] = [-75, -50, -25, -10, 10, 25, 50, 100]

/** Number of classes of the anomaly and difference views. */
export const DIVERGING_CLASSES = 9

/** Quantile of the absolute month-to-month differences that sets the limits of the diff view. */
export const DIFF_LIMIT_QUANTILE = 0.95

export type CalendarOptions = {
  /**
   * The Date_Range of the query, `YYYY-MM-DD` in local standard time. Months outside it are
   * `no_data`, and a start or end partway through a month marks that month as a whole-month
   * month. When missing, the range is the first to the last month present in the result.
   */
  range?: DateRange
  /** First month of the record, `YYYY-MM`. Months before it are `no_data`. */
  recordStart?: string
  /** Latest month with data, `YYYY-MM`. Later months are `no_data`; the latest month is marked. */
  latestMonth?: string
  /**
   * Comparison mode: values of the other panel that also set the colour scale, so both panels
   * use one set of edges (requirement 19.4). Counts view: the other panel's non-zero displayed
   * counts. Diff view: its displayed month-to-month differences. Ignored in the anomaly view
   * (its edges are fixed). Cells are still classed and counted from this panel's own values.
   */
  sharedScale?: readonly number[]
}

export type TextTone = 'light' | 'dark'

export type CalendarBin = {
  /**
   * Counts view: 0 for the zero class, 1 and up for classes of non-zero counts, lowest first.
   * Anomaly and diff views: 0 (lowest) to 8 (highest), neutral at 4.
   */
  index: number
  kind: 'zero' | 'range'
  /** Inclusive lower edge (cell-days, or percent in the anomaly view). Null for the zero class and for the lowest class of a diverging view. */
  lower: number | null
  /** Exclusive upper edge. Null for the zero class and the top class. */
  upper: number | null
  /** Largest displayed count, set on the top class of the counts view only. */
  max: number | null
  /** Text for the legend and the table, at the same rounding as the data table. */
  label: string
  colour: string
  /** The bin that contains zero, in the diverging views. Always false in the counts view. */
  neutral: boolean
  /** Text colour that reads on `colour`: `light` text on dark fills, `dark` on light fills. */
  textTone: TextTone
  /** Number of displayed cells in this class. */
  cells: number
}

export type CalendarCell = {
  /** `YYYY-MM` */
  key: string
  year: number
  month: number
  state: CellState
  /** Harmonized count in cell-days, or null for `no_data`. */
  value: number | null
  /**
   * Colour class, an index into `CalendarModel.bins`. Null for `no_data`, the provisional
   * month, and cells the active view cannot classify (no baseline, no previous month).
   */
  classIndex: number | null
  /** Fill colour of the class. Null when there is no class (no fill). */
  colour: string | null
  textTone: TextTone | null
  /** Provisional month: count to date, no colour class, no anomaly (requirement 15.28). */
  provisional: boolean
  /** The latest month with data, when it lies inside the Date_Range (requirement 15.16). */
  latest: boolean
  /** The Date_Range starts or ends partway through this month (requirement 15.12). */
  wholeMonth: boolean
  /** 2012-01, where `source_flag` changes from native to calibrated. */
  switchover: boolean
  /** Baseline median for this calendar month, or null when the API sent none. */
  baselineMedian: number | null
  /**
   * Month-to-month difference `x[y, m] - x[y, m-1]` in cell-days (January uses the previous
   * December). Null for `no_data`, for the provisional month, and when the previous month is
   * not displayed with data or is provisional (requirement 15.3).
   */
  diff: number | null
  /**
   * Shown with the hatched no-data pattern in the active view: `no_data` in every view, and
   * in the diff view also a month whose previous month has no data.
   */
  hatched: boolean
  /** Short text on the face of the cell in the active view (count, signed percent or signed difference). */
  face: string | null
  /** The API month behind the cell, or null for `no_data`. */
  data: MonthOut | null
}

export type CalendarRow = {
  year: number
  /** January to December, always 12 cells. */
  cells: CalendarCell[]
  /** Sum of the displayed monthly counts of the year (requirement 15.6). Null if none shown. */
  total: number | null
  /** The total includes a provisional month. */
  totalProvisional: boolean
}

export type CalendarModel = {
  view: CalendarView
  /** One row per year of the Date_Range, newest first. */
  rows: CalendarRow[]
  /** Baseline median for January to December (12 values), the summary row. */
  baselineMedians: (number | null)[]
  /** Colour classes, class 0 first. */
  bins: CalendarBin[]
  /**
   * Inner edges between classes, ascending. Counts view: edges between non-zero classes, at 1
   * decimal. Anomaly view: `ANOMALY_EDGES`. Diff view: 8 edges, or none when every displayed
   * difference is 0.
   */
  edges: number[]
  /** Diff view: the limit, the 95th percentile of the absolute differences. Otherwise null. */
  diffLimit: number | null
  /** Variable name for the legend. */
  variable: string
  unit: string
  timeConvention: string
  /** Sum of all displayed counts (provisional month included, labelled by `hasProvisional`). */
  total: number
  /** Month with the highest count among displayed, non-provisional months, or null. */
  peak: { year: number; month: number; value: number } | null
  hasProvisional: boolean
  hasWholeMonth: boolean
  hasLatest: boolean
  hasSwitchover: boolean
  hasNoData: boolean
}

const MONTHS = 12

export const CALENDAR_VARIABLE = 'Harmonized monthly count of burning activity'
export const COUNTS_UNIT = 'cell-days per month (MODIS-equivalent)'
export const ANOMALY_VARIABLE =
  'Percent difference from the baseline median of the same calendar month'
export const ANOMALY_UNIT = 'percent'
export const DIFF_VARIABLE = 'Month-to-month difference of the harmonized count'
export const DIFF_UNIT = `${UNIT_CELL_DAYS} per month, change from the previous month`

const VIEW_TEXT: Record<CalendarView, { variable: string; unit: string }> = {
  counts: { variable: CALENDAR_VARIABLE, unit: COUNTS_UNIT },
  anomaly: { variable: ANOMALY_VARIABLE, unit: ANOMALY_UNIT },
  diff: { variable: DIFF_VARIABLE, unit: DIFF_UNIT },
}

// ---------------------------------------------------------------------------
// Quantiles and classes

/**
 * Type-7 quantile (the default of R and NumPy): linear interpolation between the order
 * statistics at position (n - 1) * p. `sorted` must be ascending and non-empty, `p` in 0 to 1.
 */
export function quantileType7(sorted: readonly number[], p: number): number {
  const n = sorted.length
  if (n === 0) throw new RangeError('quantileType7 needs at least one value')
  const h = (n - 1) * Math.min(1, Math.max(0, p))
  const lo = Math.floor(h)
  const a = sorted[lo] ?? 0
  const b = sorted[Math.min(lo + 1, n - 1)] ?? a
  return a + (h - lo) * (b - a)
}

const round1 = (x: number): number => Math.round(x * 10) / 10

/**
 * Inner edges of the 7 classes of non-zero counts: type-7 quantiles at 1/7 to 6/7, rounded
 * to 1 decimal (the rounding of the data table, so edges and displayed values agree).
 * Duplicate edges collapse. An edge at or below the smallest value, or above the largest,
 * would give an empty class and is dropped. Returns `[]` for no values or one distinct value.
 */
export function countEdges(nonZeroValues: readonly number[]): number[] {
  if (nonZeroValues.length === 0) return []
  const sorted = [...nonZeroValues].sort((a, b) => a - b)
  const min = sorted[0] ?? 0
  const max = sorted[sorted.length - 1] ?? 0
  const edges: number[] = []
  for (let k = 1; k < COUNT_CLASSES; k += 1) {
    const edge = round1(quantileType7(sorted, k / COUNT_CLASSES))
    const previous = edges[edges.length - 1]
    if (edge <= min || edge > max) continue
    if (previous !== undefined && edge <= previous) continue
    edges.push(edge)
  }
  return edges
}

/**
 * Class of a count: 0 for exactly zero, otherwise 1 plus the number of edges at or below
 * the value. A larger value never gets a lower class.
 */
export function classifyCount(value: number, edges: readonly number[]): number {
  if (value === 0) return 0
  let index = 1
  for (const edge of edges) {
    if (value >= edge) index += 1
  }
  return index
}

type Rgb = readonly [number, number, number]

function parseColour(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function luminance([r, g, b]: Rgb): number {
  const lin = (v: number): number => {
    const s = v / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** Text tone with the higher WCAG contrast ratio on `colour` (a `#rrggbb` palette colour). */
export function textToneFor(colour: string): TextTone {
  const l = luminance(parseColour(colour))
  // Contrast with white is 1.05 / (l + 0.05), with black (l + 0.05) / 0.05.
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.05 ? 'light' : 'dark'
}

function binLabel(lower: number | null, upper: number | null, max: number | null): string {
  if (lower === null) return '0'
  if (upper !== null) return `${formatCount(lower)} to under ${formatCount(upper)}`
  return `${formatCount(lower)} to ${formatCount(max)}`
}

// ---------------------------------------------------------------------------
// Anomaly and difference views

/** Class of `value` among `edges`: the number of edges at or below it. Larger never gives lower. */
export function classifyByEdges(value: number, edges: readonly number[]): number {
  let index = 0
  for (const edge of edges) {
    if (value >= edge) index += 1
  }
  return index
}

/**
 * Class (0 to 8) of a percent difference in the anomaly view. `percent` is null when the
 * Baseline median is 0 (then the percent difference is undefined): the cell goes to the top
 * bin when the count is above 0 and to the neutral bin (the one containing zero) when it is 0
 * (requirement 15.13).
 */
export function classifyAnomaly(percent: number | null, count: number): number {
  if (percent === null) return count > 0 ? ANOMALY_EDGES.length : BLUE_ORANGE_NEUTRAL_INDEX
  return classifyByEdges(percent, ANOMALY_EDGES)
}

/**
 * The 8 inner edges of the diff view: 9 equal bins over `[-limit, +limit]`, symmetric around 0,
 * with the end bins open (values beyond the limits are clamped into them). Edge `k` is
 * `limit * (2k - 9) / 9`, so the edges are exact negatives of each other and the middle bin
 * `[-limit/9, +limit/9)` contains zero. Needs `limit > 0`.
 */
export function diffEdges(limit: number): number[] {
  return Array.from({ length: DIVERGING_CLASSES - 1 }, (_, i) => (limit * (2 * (i + 1) - 9)) / 9)
}

/**
 * The limit of the diff view: the type-7 95th percentile of the absolute differences, or 0
 * when there are none.
 */
export function diffLimitOf(differences: readonly number[]): number {
  if (differences.length === 0) return 0
  const sorted = differences.map((d) => Math.abs(d)).sort((a, b) => a - b)
  return quantileType7(sorted, DIFF_LIMIT_QUANTILE)
}

/** Decimals that tell the edges of a view with this limit apart: 1, or more for a tiny limit. */
function edgeDecimals(limit: number): number {
  const step = limit / DIVERGING_CLASSES
  return step >= 0.5 ? 1 : step >= 0.05 ? 2 : 3
}

function signedText(value: number, decimals: number): string {
  const text = Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  const isZero = Number(text.replaceAll(',', '')) === 0
  if (isZero) return text
  return value < 0 ? `-${text}` : `+${text}`
}

function divergingLabel(
  index: number,
  edges: readonly number[],
  format: (edge: number) => string,
): string {
  const lower = edges[index - 1]
  const upper = edges[index]
  if (lower === undefined && upper !== undefined) return `below ${format(upper)}`
  if (lower !== undefined && upper === undefined) return `${format(lower)} and above`
  if (lower !== undefined && upper !== undefined) {
    return `${format(lower)} to under ${format(upper)}`
  }
  return '0'
}

function divergingBins(edges: readonly number[], format: (edge: number) => string): CalendarBin[] {
  return BLUE_ORANGE_DIVERGING.map((colour, index) => ({
    index,
    kind: 'range' as const,
    lower: edges[index - 1] ?? null,
    upper: edges[index] ?? null,
    max: null,
    label: divergingLabel(index, edges, format),
    colour,
    neutral: index === BLUE_ORANGE_NEUTRAL_INDEX,
    textTone: textToneFor(colour),
    cells: 0,
  }))
}

type ViewClasses = { bins: CalendarBin[]; edges: number[]; diffLimit: number | null }

function paint(cell: CalendarCell, bin: CalendarBin | undefined, index: number): void {
  if (bin === undefined) return
  bin.cells += 1
  cell.classIndex = index
  cell.colour = bin.colour
  cell.textTone = bin.textTone
}

function countsClasses(scaled: CalendarCell[], shared: readonly number[] = []): ViewClasses {
  const nonZero = [
    ...scaled.flatMap((c) => (c.value !== null && c.value > 0 ? [c.value] : [])),
    ...shared.filter((v) => v > 0),
  ]
  const edges = countEdges(nonZero)
  const classCount = 1 + (nonZero.length > 0 ? edges.length + 1 : 0)
  const colours = cividisClasses(Math.max(classCount, 2)).slice(0, classCount)
  const maxValue = nonZero.length > 0 ? Math.max(...nonZero) : null

  const bins: CalendarBin[] = colours.map((colour, index) => {
    const lower =
      index === 0 ? null : index === 1 ? Math.min(...nonZero) : (edges[index - 2] ?? null)
    const isTop = index === classCount - 1 && index > 0
    const upper = index === 0 || isTop ? null : (edges[index - 1] ?? null)
    const max = isTop ? maxValue : null
    return {
      index,
      kind: index === 0 ? 'zero' : 'range',
      lower,
      upper,
      max,
      label: binLabel(lower, upper, max),
      colour,
      neutral: false,
      textTone: textToneFor(colour),
      cells: 0,
    }
  })
  for (const cell of scaled) {
    if (cell.value === null) continue
    const index = classifyCount(cell.value, edges)
    paint(cell, bins[index], index)
  }
  return { bins, edges, diffLimit: null }
}

function anomalyClasses(scaled: CalendarCell[]): ViewClasses {
  const edges = [...ANOMALY_EDGES]
  const bins = divergingBins(edges, (edge) => `${signedText(edge, 0)}%`)
  for (const cell of scaled) {
    const anomaly = cell.data?.anomaly
    if (cell.value === null || anomaly === undefined || anomaly === null) continue
    const index = classifyAnomaly(anomaly.percent, cell.value)
    paint(cell, bins[index], index)
  }
  return { bins, edges, diffLimit: null }
}

function diffClasses(scaled: CalendarCell[], shared: readonly number[] = []): ViewClasses {
  const withDiff = scaled.filter((c) => c.diff !== null)
  const limit = diffLimitOf([
    ...withDiff.flatMap((c) => (c.diff === null ? [] : [c.diff])),
    ...shared,
  ])
  if (!(limit > 0)) {
    // Every displayed difference is 0 (or none): one neutral class.
    const neutral = divergingBins([], () => '0')
      .slice(BLUE_ORANGE_NEUTRAL_INDEX, BLUE_ORANGE_NEUTRAL_INDEX + 1)
      .map((bin) => ({ ...bin, index: 0, label: '0 (no change)' }))
    for (const cell of withDiff) paint(cell, neutral[0], 0)
    return { bins: neutral, edges: [], diffLimit: 0 }
  }
  const edges = diffEdges(limit)
  const decimals = edgeDecimals(limit)
  const bins = divergingBins(edges, (edge) => signedText(edge, decimals))
  for (const cell of withDiff) {
    if (cell.diff === null) continue
    const index = classifyByEdges(cell.diff, edges)
    paint(cell, bins[index], index)
  }
  return { bins, edges, diffLimit: limit }
}

/** Signed short text for a cell face, for example `+25` or `-3.5`; 0 gives `0`. */
function signedCompact(value: number): string {
  const magnitude = compactCount(Math.abs(value))
  if (magnitude === '0' || magnitude === '0.0') return '0'
  return `${value < 0 ? '-' : '+'}${magnitude}`
}

/** Signed short percent for a cell face, for example `+25%`, `-60%` or `+12k%`. */
function signedCompactPercent(percent: number): string {
  const magnitude = Math.abs(percent)
  const text =
    magnitude >= 1000 ? `${Math.round(magnitude / 1000)}k` : String(Math.round(magnitude))
  return text === '0' ? '0%' : `${percent < 0 ? '-' : '+'}${text}%`
}

function faceText(view: CalendarView, cell: CalendarCell): string | null {
  if (cell.value === null) return null
  if (cell.provisional || view === 'counts') return compactCount(cell.value)
  if (view === 'diff') return cell.diff === null ? null : signedCompact(cell.diff)
  const anomaly = cell.data?.anomaly
  if (anomaly === undefined || anomaly === null) return compactCount(cell.value)
  // Baseline median 0: no percent, so the face shows the signed absolute difference.
  return anomaly.percent === null
    ? signedCompact(anomaly.absolute)
    : signedCompactPercent(anomaly.percent)
}

function previousKey(year: number, month: number): string {
  return month === 1 ? keyOf(year - 1, MONTHS) : keyOf(year, month - 1)
}

// ---------------------------------------------------------------------------
// Model

const keyOf = (year: number, month: number): string =>
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`

function validMonth(m: MonthOut): boolean {
  return (
    Number.isInteger(m.year) &&
    Number.isInteger(m.month) &&
    m.month >= 1 &&
    m.month <= MONTHS &&
    Number.isFinite(m.harmonized)
  )
}

function rangeOf(months: Map<string, MonthOut>, given: DateRange | undefined): DateRange | null {
  if (given !== undefined) {
    return isRealDate(given.start) && isRealDate(given.end) ? given : null
  }
  const keys = [...months.keys()].sort()
  const first = keys[0]
  const last = keys[keys.length - 1]
  if (first === undefined || last === undefined) return null
  return { start: firstDayOfMonth(first), end: lastDayOfMonth(last) }
}

/**
 * Build the Calendar model of a view: `counts`, `anomaly` or `diff`.
 *
 * - One row per year from the first to the last year of the Date_Range, newest first, and 12
 *   month cells per row (requirement 15.1).
 * - A month is `no_data` when it is outside the Date_Range, before `recordStart`, after
 *   `latestMonth`, or missing from the result. It is never shown as zero (15.7).
 * - Count 0 is state `zero` and class 0, the lowest class. Non-zero counts get classes 1 and
 *   up from type-7 quantile edges of the displayed non-zero counts (15.11). The provisional
 *   month is left out of the edges and has no class and no fill (15.28).
 * - Each row has a total, the sum of its displayed months, and the model has a baseline
 *   median per calendar month (15.6).
 * - A Date_Range that starts or ends partway through a month marks that whole month (15.12).
 * - Anomaly view: the class of a cell is the bin of the API percent difference among the 9
 *   fixed bins. A month with Baseline median 0 has no percent: it goes to the top bin when
 *   its count is above 0 and to the neutral bin when it is 0 (15.13).
 * - Diff view: `diff = x[y, m] - x[y, m-1]` (January uses the previous December). The 9 bins
 *   are symmetric around 0 up to the 95th percentile of the absolute differences; a month
 *   whose previous month has no data gets the no-data pattern (15.3, 15.11).
 * - In every view the provisional month has no class, no fill and no anomaly, and does not
 *   enter the bin edges (15.28).
 */
export function buildCalendarModel(
  result: CalendarOut,
  view: CalendarView = 'counts',
  options: CalendarOptions = {},
): CalendarModel {
  const byKey = new Map<string, MonthOut>()
  for (const m of result.months) {
    if (validMonth(m)) byKey.set(keyOf(m.year, m.month), m)
  }

  const range = rangeOf(byKey, options.range)
  const startMonth = range === null ? null : monthOf(range.start)
  const endMonth = range === null ? null : monthOf(range.end)
  const wholeMonths = new Set<string>()
  if (range !== null && startMonth !== null && endMonth !== null) {
    if (range.start !== firstDayOfMonth(range.start)) wholeMonths.add(startMonth)
    if (range.end !== lastDayOfMonth(endMonth)) wholeMonths.add(endMonth)
  }

  const provisionalKeys = new Set(result.provisional_months)
  const latestMonth = options.latestMonth ?? [...provisionalKeys].sort().pop() ?? null

  const medians: (number | null)[] = Array.from({ length: MONTHS }, () => null)
  for (const b of result.baseline_by_month) {
    if (
      Number.isInteger(b.month) &&
      b.month >= 1 &&
      b.month <= MONTHS &&
      Number.isFinite(b.median)
    ) {
      medians[b.month - 1] = b.median
    }
  }

  const inRange = (key: string): boolean =>
    startMonth !== null && endMonth !== null && key >= startMonth && key <= endMonth
  const hasData = (key: string): boolean =>
    byKey.has(key) &&
    inRange(key) &&
    (options.recordStart === undefined || key >= options.recordStart) &&
    (options.latestMonth === undefined || key <= options.latestMonth)

  // First pass: the cells, without classes.
  const startYear = startMonth === null ? 0 : Number(startMonth.slice(0, 4))
  const endYear = endMonth === null ? -1 : Number(endMonth.slice(0, 4))
  const rows: CalendarRow[] = []
  for (let year = endYear; year >= startYear; year -= 1) {
    const cells: CalendarCell[] = []
    for (let month = 1; month <= MONTHS; month += 1) {
      const key = keyOf(year, month)
      const data = hasData(key) ? (byKey.get(key) ?? null) : null
      const provisional = data !== null && (data.provisional || provisionalKeys.has(key))
      cells.push({
        key,
        year,
        month,
        state: data === null ? 'no_data' : data.harmonized === 0 ? 'zero' : 'value',
        value: data === null ? null : data.harmonized,
        classIndex: null,
        colour: null,
        textTone: null,
        provisional,
        latest: data !== null && latestMonth === key,
        wholeMonth: data !== null && wholeMonths.has(key),
        switchover: data !== null && key === SWITCHOVER_MONTH,
        baselineMedian: medians[month - 1] ?? null,
        diff: null,
        hatched: data === null,
        face: null,
        data,
      })
    }
    rows.push({ year, cells, total: null, totalProvisional: false })
  }
  const allCells = rows.flatMap((r) => r.cells)

  // Second pass: month-to-month differences and the text on the face of each cell.
  const cellByKey = new Map(allCells.map((c) => [c.key, c]))
  for (const cell of allCells) {
    if (cell.value !== null && !cell.provisional) {
      const previous = cellByKey.get(previousKey(cell.year, cell.month))
      if (previous !== undefined && previous.value !== null && !previous.provisional) {
        cell.diff = cell.value - previous.value
      }
    }
    cell.hatched =
      cell.state === 'no_data' || (view === 'diff' && !cell.provisional && cell.diff === null)
    cell.face = faceText(view, cell)
  }

  // Colour classes from the displayed, non-provisional months.
  const scaled = allCells.filter((c) => c.value !== null && !c.provisional)
  const { bins, edges, diffLimit } =
    view === 'anomaly'
      ? anomalyClasses(scaled)
      : view === 'diff'
        ? diffClasses(scaled, options.sharedScale)
        : countsClasses(scaled, options.sharedScale)

  // Totals and peak.
  let total = 0
  let peak: CalendarModel['peak'] = null
  for (const row of rows) {
    const shown = row.cells.filter((c) => c.value !== null)
    row.total = shown.length === 0 ? null : shown.reduce((s, c) => s + (c.value ?? 0), 0)
    row.totalProvisional = shown.some((c) => c.provisional)
    total += row.total ?? 0
  }
  for (const row of [...rows].reverse()) {
    for (const c of row.cells) {
      if (c.value === null || c.provisional || c.value <= 0) continue
      if (peak === null || c.value > peak.value)
        peak = { year: c.year, month: c.month, value: c.value }
    }
  }

  return {
    view,
    rows,
    baselineMedians: medians,
    bins,
    edges,
    diffLimit,
    variable: VIEW_TEXT[view].variable,
    unit: VIEW_TEXT[view].unit,
    timeConvention: TIME_CONVENTION,
    total,
    peak,
    hasProvisional: allCells.some((c) => c.provisional),
    hasWholeMonth: allCells.some((c) => c.wholeMonth),
    hasLatest: allCells.some((c) => c.latest),
    hasSwitchover: allCells.some((c) => c.switchover),
    hasNoData: allCells.some((c) => c.state === 'no_data'),
  }
}

// ---------------------------------------------------------------------------
// Text helpers shared by the grid and the table

/** Marker names of a cell, in the order the table Status column lists them. */
export function cellStatuses(cell: CalendarCell): string[] {
  const out: string[] = []
  if (cell.provisional) out.push('Provisional')
  if (cell.wholeMonth) out.push('Whole month')
  if (cell.latest) out.push('Latest month')
  if (cell.switchover) out.push('Switchover (native to calibrated)')
  return out
}

/** Short count for the face of a cell: 1 decimal below 10, whole numbers above, `12k` from 10,000. */
export function compactCount(value: number): string {
  if (value === 0) return '0'
  if (value < 10) return formatCount(value)
  if (value < 10_000) return Math.round(value).toLocaleString('en-US')
  return `${Math.round(value / 1000)}k`
}

/**
 * Accessible name of a cell, for example `August 2020: 1,234.5 cell-days (MODIS-equivalent),
 * provisional`. In the anomaly and diff views the name also gives the signed percent or
 * difference, so the colour class is never the only cue.
 */
export function cellAriaLabel(cell: CalendarCell, view: CalendarView = 'counts'): string {
  const when = formatMonth(cell.year, cell.month)
  if (cell.value === null) return `${when}: no data`
  const parts = [`${when}: ${formatCount(cell.value)} ${UNIT_CELL_DAYS}`]
  if (!cell.provisional && view === 'anomaly') {
    const anomaly = cell.data?.anomaly
    if (anomaly !== undefined && anomaly !== null) {
      parts.push(
        anomaly.percent === null
          ? `${NO_TYPICAL_FIRES}, ${formatSignedCount(anomaly.absolute)} ${UNIT_CELL_DAYS} from the baseline median`
          : `${formatPercentDifference(anomaly.percent)} from the baseline median`,
      )
    }
  }
  if (!cell.provisional && view === 'diff') {
    parts.push(
      cell.diff === null
        ? 'no month-to-month difference, the previous month has no data'
        : `${formatSignedCount(cell.diff)} ${UNIT_CELL_DAYS} from the previous month`,
    )
  }
  if (cell.provisional) parts.push('provisional, count to date')
  if (cell.wholeMonth) parts.push('whole month')
  if (cell.latest) parts.push('latest month')
  if (cell.switchover) parts.push('switchover month, native to calibrated')
  return parts.join(', ')
}

/** Signed z-score to 2 decimals, or a dash when it is not defined (standard deviation 0). */
export function formatZScore(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return MISSING
  const text = Math.abs(value).toFixed(2)
  return text === '0.00' ? text : `${value < 0 ? '-' : '+'}${text}`
}

/** Keys of the values of `describeCell`, so help controls can attach to a term. */
export type CellFieldKey =
  | 'month'
  | 'harmonized'
  | 'source_flag'
  | 'calib_model'
  | 'provenance'
  | 'baseline_median'
  | 'absolute'
  | 'percent'
  | 'zscore'
  | 'percentile_rank'
  | 'month_to_month'
  | 'interval'
  | 'status'

export type CellField = { key: CellFieldKey; label: string; value: string }

export type CellDescription = {
  /** `August 2020`, or a dash when the cell has no month. */
  title: string
  /** The cell has a month with data. */
  hasData: boolean
  provisional: boolean
  /** Fields in display order. A no-data cell has only the month and the status. */
  fields: CellField[]
  /** Plain text of all fields, one per line, for assistive technology and tests. */
  text: string
}

/**
 * One description of a cell, used by the tooltip and the Detail_Panel (design.md 11.4):
 * month, year, harmonized count (1 decimal), `source_flag`, `calib_model`, `provenance`,
 * Baseline median, absolute and percent difference, z-score, percentile rank, the
 * month-to-month difference, the provisional state, and the interval line only when both
 * bounds are non-null (requirements 15.5, 15.13, 15.17). Percent difference with a Baseline
 * median of 0 reads "no typical fires in this month" and the absolute difference and
 * percentile rank stay. The provisional month has no anomaly fields. Never shows infinity.
 */
export function describeCell(model: CalendarModel, cell: CalendarCell): CellDescription {
  const title = formatMonth(cell.year, cell.month)
  const data = cell.data
  const month: CellField = {
    key: 'month',
    label: 'Month',
    value: `${title}, ${model.timeConvention}`,
  }
  const textOf = (value: string | null | undefined): string =>
    value === null || value === undefined || value === '' ? MISSING : value
  const fields: CellField[] = [month]

  if (data === null || cell.value === null) {
    fields.push({ key: 'status', label: 'Status', value: 'No data' })
  } else {
    fields.push(
      {
        key: 'harmonized',
        label: 'Harmonized count',
        value: `${formatCount(cell.value)} ${UNIT_CELL_DAYS}`,
      },
      { key: 'source_flag', label: 'Source flag', value: textOf(data.source_flag) },
      { key: 'calib_model', label: 'Calibration model', value: textOf(data.calib_model) },
      { key: 'provenance', label: 'Provenance', value: textOf(data.provenance) },
      {
        key: 'baseline_median',
        label: 'Baseline median',
        value:
          cell.baselineMedian === null
            ? MISSING
            : `${formatCount(cell.baselineMedian)} ${UNIT_CELL_DAYS}`,
      },
    )
    const anomaly = cell.provisional ? null : (data.anomaly ?? null)
    if (!cell.provisional) {
      fields.push(
        {
          key: 'absolute',
          label: 'Difference from baseline median',
          value:
            anomaly === null ? MISSING : `${formatSignedCount(anomaly.absolute)} ${UNIT_CELL_DAYS}`,
        },
        {
          key: 'percent',
          label: 'Percent difference',
          // A null percent means the Baseline median is 0: say so, never show infinity.
          value: anomaly === null ? MISSING : formatPercentDifference(anomaly.percent),
        },
        {
          key: 'zscore',
          label: 'Z-score',
          value: anomaly === null ? MISSING : formatZScore(anomaly.zscore),
        },
        {
          key: 'percentile_rank',
          label: 'Percentile rank (0 to 100)',
          value: anomaly === null ? MISSING : formatCount(anomaly.percentile_rank),
        },
        {
          key: 'month_to_month',
          label: 'Change from the previous month',
          value: cell.diff === null ? MISSING : `${formatSignedCount(cell.diff)} ${UNIT_CELL_DAYS}`,
        },
      )
    }
    if (
      data.lower_bound !== null &&
      data.lower_bound !== undefined &&
      data.upper_bound !== null &&
      data.upper_bound !== undefined
    ) {
      fields.push({
        key: 'interval',
        label: 'Uncertainty interval',
        value: `${formatCount(data.lower_bound)} to ${formatCount(data.upper_bound)} ${UNIT_CELL_DAYS}`,
      })
    }
    const statuses = cellStatuses(cell)
    fields.push({
      key: 'status',
      label: 'Status',
      value: cell.provisional
        ? `Provisional: count to date of an incomplete month, no anomaly${
            statuses.length > 1 ? `. Also: ${statuses.slice(1).join(', ')}` : ''
          }`
        : statuses.length === 0
          ? 'Complete'
          : statuses.join(', '),
    })
  }
  return {
    title,
    hasData: data !== null && cell.value !== null,
    provisional: cell.provisional,
    fields,
    text: fields.map((f) => `${f.label}: ${f.value}`).join('\n'),
  }
}

/** Month abbreviation (`Jan`) for column headers. */
export function monthAbbreviation(month: number): string {
  const name = monthName(month)
  return name === MISSING ? MISSING : name.slice(0, 3)
}

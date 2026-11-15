// URL state of the app (requirements 14.5, 19.1 to 19.3, 19.8; design.md section 11.2).
// Pure functions, no I/O, no browser clock and no `window`: the caller passes the query string
// in and writes the result out with `history.replaceState`. Dates are `YYYY-MM-DD`, local
// standard time, UTC-8. Coordinates are EPSG:4326 (longitude, latitude) in degrees.
import { areaGeometrySchema, type AreaGeometry } from './areaGeometry'
import { validateDateRange, type DateRange, type DateRecord } from './dates'
import { formatDateRange, isRealDate } from './format'
import { MAX_VERTICES } from './geometryPrecheck'

/** Query parameter names (design.md section 11.2). */
export const FROM_PARAM = 'from'
export const TO_PARAM = 'to'

export type UrlRangeResolution = {
  /** The Date_Range to use: the one in the URL when valid, else the fallback. */
  range: DateRange
  /** True when the range came from the URL. */
  fromUrl: boolean
  /** Short notice for the user when the URL held an unusable range, else null. */
  notice: string | null
}

/**
 * Reads `from` and `to` from a query string (with or without the leading `?`).
 * Returns null for a parameter that is absent. An empty value counts as present.
 */
export function readRangeParams(search: string): { from: string | null; to: string | null } {
  const params = new URLSearchParams(search)
  return { from: params.get(FROM_PARAM), to: params.get(TO_PARAM) }
}

/**
 * Resolves the Date_Range of a page address (requirements 14.5, 14.8, 14.9).
 *
 * - No `from` and no `to`: the fallback (the default range), no notice.
 * - Both present and a valid range inside `record`: that range.
 * - Anything else (one parameter missing, not a real date, start after end, outside the
 *   record): the fallback and a notice. The result never holds an invalid range.
 */
export function resolveUrlRange(
  search: string,
  record: DateRecord,
  fallback: DateRange,
): UrlRangeResolution {
  const { from, to } = readRangeParams(search)
  if (from === null && to === null) return { range: fallback, fromUrl: false, notice: null }
  const checked = validateDateRange(from ?? '', to ?? '', record)
  if (checked.ok) return { range: checked.range, fromUrl: true, notice: null }
  return {
    range: fallback,
    fromUrl: false,
    notice: `The dates in the page address could not be used, so the default range is shown: ${formatDateRange(fallback.start, fallback.end)}.`,
  }
}

/**
 * The query string for `range`, keeping every other parameter of `search` unchanged.
 * Returns `?...` or an empty string. `resolveUrlRange` reads back what this writes.
 */
export function serializeRangeParams(search: string, range: DateRange): string {
  const params = new URLSearchParams(search)
  params.set(FROM_PARAM, range.start)
  params.set(TO_PARAM, range.end)
  return `?${params.toString()}`
}

// ---------------------------------------------------------------------------------------------
// Full app state: encodeState and decodeState (task 24.1)
// ---------------------------------------------------------------------------------------------

export type UrlView = 'counts' | 'anomaly' | 'diff'
export const URL_VIEWS: readonly UrlView[] = ['counts', 'anomaly', 'diff']

export type UrlArea =
  { kind: 'region' } | { kind: 'geom'; geometry: AreaGeometry } | { kind: 'share'; id: string }

export type UrlCompare =
  | { mode: 'none' }
  | { mode: 'area'; area2: UrlArea; perArea: boolean }
  | { mode: 'period'; start2: string; end2: string }

/** Everything the page address holds (design.md section 11.2). */
export type AppState = {
  area: UrlArea
  start: string
  end: string
  /** User baseline years `[first, last]`, inclusive. */
  baseline?: [number, number]
  view: UrlView
  compare: UrlCompare
  year?: number
  /** First month (1 to 12) of the season tracker. */
  seasonStart?: number
  tab?: string
  cell?: string
}

export type RejectedParam = { param: string; reason: string }
export type DecodedState = { state: AppState; rejected: RejectedParam[] }

export type DecodeOptions = {
  /** Date_Range used when `from` and `to` are absent or unusable. */
  fallback: DateRange
  /** When given, the range must also lie inside this record. */
  record?: DateRecord
  /** When given, `tab` must be one of these ids. */
  tabs?: readonly string[]
}

/** Every parameter the app owns. Other parameters in the address are left alone. */
export const MANAGED_PARAMS = [
  'a',
  's',
  'from',
  'to',
  'bl',
  'v',
  'cmp',
  'a2',
  'from2',
  'to2',
  'pa',
  'y',
  'ss',
  'tab',
  'cell',
] as const

const SHARE_ID = /^[A-Za-z0-9_-]{1,16}$/
const TAB_ID = /^[a-z][a-z0-9_-]{0,23}$/
const BASE64URL = /^[A-Za-z0-9_-]*$/
/** Longest geometry code accepted: far above 1000 vertices, so a hostile code stays cheap. */
const MAX_CODE_LENGTH = 20_000
const SCALE = 1e6

// Geometry code. Layout (varints, all non-negative integers):
//   kind (0 Polygon, 1 MultiPolygon), [polygon count], per polygon: ring count, per ring:
//   vertex count, then lon and lat of every vertex as round(x * 1e6), each the difference to
//   the same axis of the previous vertex (the first to 0), zigzag mapped. Bytes are base64url.

function zigzag(n: number): number {
  return n >= 0 ? 2 * n : -2 * n - 1
}
function unzigzag(n: number): number {
  return n % 2 === 0 ? n / 2 : -(n + 1) / 2
}

function writeVarint(out: number[], value: number): void {
  let v = value
  while (v >= 128) {
    out.push((v % 128) + 128)
    v = Math.floor(v / 128)
  }
  out.push(v)
}

function toBase64Url(bytes: readonly number[]): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): number[] | null {
  if (!BASE64URL.test(text) || text.length % 4 === 1) return null
  const padded =
    text.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (text.length % 4)) % 4)
  try {
    const binary = atob(padded)
    return Array.from(binary, (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

/** Encodes a Polygon or MultiPolygon as a URL-safe code. Coordinates keep 6 decimals. */
export function encodeGeometry(geometry: AreaGeometry): string {
  const out: number[] = []
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  writeVarint(out, geometry.type === 'Polygon' ? 0 : 1)
  if (geometry.type === 'MultiPolygon') writeVarint(out, polygons.length)
  let prevX = 0
  let prevY = 0
  for (const rings of polygons) {
    writeVarint(out, rings.length)
    for (const ring of rings) {
      writeVarint(out, ring.length)
      for (const [lon, lat] of ring) {
        const x = Math.round(lon * SCALE)
        const y = Math.round(lat * SCALE)
        writeVarint(out, zigzag(x - prevX))
        writeVarint(out, zigzag(y - prevY))
        prevX = x
        prevY = y
      }
    }
  }
  return toBase64Url(out)
}

class Reader {
  private pos = 0
  private readonly bytes: readonly number[]
  constructor(bytes: readonly number[]) {
    this.bytes = bytes
  }
  get remaining(): number {
    return this.bytes.length - this.pos
  }
  varint(): number {
    let value = 0
    let factor = 1
    for (let i = 0; i < 6; i += 1) {
      const byte = this.bytes[this.pos]
      if (byte === undefined) throw new Error('truncated')
      this.pos += 1
      value += (byte % 128) * factor
      if (byte < 128) return value
      factor *= 128
    }
    throw new Error('varint too long')
  }
}

/**
 * Decodes a geometry code. Returns the geometry or a reason. The result is limited to
 * `MAX_VERTICES` vertices and valid coordinate ranges; shape rules (self-intersection and so on)
 * are left to the normal area check.
 */
export function decodeGeometry(
  code: string,
): { ok: true; geometry: AreaGeometry } | { ok: false; reason: string } {
  if (code.length === 0 || code.length > MAX_CODE_LENGTH) return { ok: false, reason: 'bad_length' }
  const bytes = fromBase64Url(code)
  if (bytes === null) return { ok: false, reason: 'bad_encoding' }
  const reader = new Reader(bytes)
  try {
    const kind = reader.varint()
    if (kind !== 0 && kind !== 1) return { ok: false, reason: 'unknown_type' }
    const polygonCount = kind === 1 ? reader.varint() : 1
    let vertices = 0
    let x = 0
    let y = 0
    const polygons: [number, number][][][] = []
    // Every count below is bounded by the bytes left (a vertex takes at least 2 bytes, a ring
    // or polygon at least 1), so a forged count cannot make the loops run long.
    if (polygonCount < 1 || polygonCount > reader.remaining)
      return { ok: false, reason: 'bad_count' }
    for (let p = 0; p < polygonCount; p += 1) {
      const ringCount = reader.varint()
      if (ringCount < 1 || ringCount > reader.remaining) return { ok: false, reason: 'bad_count' }
      const rings: [number, number][][] = []
      for (let r = 0; r < ringCount; r += 1) {
        const n = reader.varint()
        vertices += n
        if (n < 1 || vertices > MAX_VERTICES || 2 * n > reader.remaining) {
          return { ok: false, reason: vertices > MAX_VERTICES ? 'too_many_vertices' : 'bad_count' }
        }
        const ring: [number, number][] = []
        for (let i = 0; i < n; i += 1) {
          x += unzigzag(reader.varint())
          y += unzigzag(reader.varint())
          const lon = x / SCALE
          const lat = y / SCALE
          if (!(lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90)) {
            return { ok: false, reason: 'coordinate_out_of_range' }
          }
          ring.push([lon, lat])
        }
        rings.push(ring)
      }
      polygons.push(rings)
    }
    if (reader.remaining !== 0) return { ok: false, reason: 'trailing_bytes' }
    const candidate =
      kind === 0
        ? { type: 'Polygon', coordinates: polygons[0] }
        : { type: 'MultiPolygon', coordinates: polygons }
    const parsed = areaGeometrySchema.safeParse(candidate)
    return parsed.success
      ? { ok: true, geometry: parsed.data }
      : { ok: false, reason: 'not_a_polygon' }
  } catch {
    return { ok: false, reason: 'truncated' }
  }
}

/**
 * The managed query parameters of `state`, as `a=...&from=...`. Defaults are left out: the
 * full region, view `counts`, no comparison. A geometry is stored under `a` (or `s` for a share
 * id). The second area of a comparison is stored under `a2` as a geometry code, or as
 * `s:<id>` for a share id; no `a2` means the full region.
 */
export function encodeState(state: AppState): string {
  const params = new URLSearchParams()
  if (state.area.kind === 'geom') params.set('a', encodeGeometry(state.area.geometry))
  else if (state.area.kind === 'share') params.set('s', state.area.id)
  params.set('from', state.start)
  params.set('to', state.end)
  if (state.baseline !== undefined) params.set('bl', `${state.baseline[0]}-${state.baseline[1]}`)
  if (state.view !== 'counts') params.set('v', state.view)
  if (state.compare.mode === 'area') {
    params.set('cmp', 'area')
    const a2 = state.compare.area2
    if (a2.kind === 'geom') params.set('a2', encodeGeometry(a2.geometry))
    else if (a2.kind === 'share') params.set('a2', `s:${a2.id}`)
    if (state.compare.perArea) params.set('pa', '1')
  } else if (state.compare.mode === 'period') {
    params.set('cmp', 'period')
    params.set('from2', state.compare.start2)
    params.set('to2', state.compare.end2)
  }
  if (state.year !== undefined) params.set('y', String(state.year))
  if (state.seasonStart !== undefined) params.set('ss', String(state.seasonStart))
  if (state.tab !== undefined) params.set('tab', state.tab)
  if (state.cell !== undefined) params.set('cell', state.cell)
  return params.toString()
}

/** `search` with every managed parameter replaced by those of `state`; other parameters stay. */
export function serializeState(search: string, state: AppState): string {
  const params = new URLSearchParams(search)
  for (const name of MANAGED_PARAMS) params.delete(name)
  const managed = encodeState(state)
  const kept = params.toString()
  const all = [managed, kept].filter((part) => part.length > 0).join('&')
  return all.length === 0 ? '' : `?${all}`
}

const INTEGER = /^\d{1,4}$/

function parseYear(text: string): number | null {
  if (!INTEGER.test(text)) return null
  const n = Number(text)
  return n >= 1900 && n <= 2200 ? n : null
}

function decodeAreaCode(code: string): { ok: true; area: UrlArea } | { ok: false; reason: string } {
  const decoded = decodeGeometry(code)
  return decoded.ok ? { ok: true, area: { kind: 'geom', geometry: decoded.geometry } } : decoded
}

/**
 * Reads the app state from a query string (with or without `?`). Never throws. Each parameter
 * is checked on its own: an unusable one is listed in `rejected` and replaced by its default
 * (requirement 19.8), the rest are kept. `from` and `to` are checked as a pair.
 */
export function decodeState(search: string, options: DecodeOptions): DecodedState {
  const params = new URLSearchParams(search)
  const rejected: RejectedParam[] = []
  const reject = (param: string, reason: string): void => {
    rejected.push({ param, reason })
  }

  // Area: `a` (geometry code) wins over `s` (share id).
  let area: UrlArea = { kind: 'region' }
  const a = params.get('a')
  const s = params.get('s')
  if (a !== null) {
    const out = decodeAreaCode(a)
    if (out.ok) area = out.area
    else reject('a', out.reason)
    if (s !== null) reject('s', 'ignored_because_a_is_present')
  } else if (s !== null) {
    if (SHARE_ID.test(s)) area = { kind: 'share', id: s }
    else reject('s', 'bad_share_id')
  }

  // Date_Range, as a pair.
  let { start, end } = options.fallback
  const from = params.get('from')
  const to = params.get('to')
  if (from !== null || to !== null) {
    const f = from ?? ''
    const t = to ?? ''
    let reason: string | null = null
    if (!isRealDate(f) || !isRealDate(t)) reason = 'not_a_date'
    else if (f > t) reason = 'start_after_end'
    else if (options.record !== undefined && !validateDateRange(f, t, options.record).ok) {
      reason = 'outside_record'
    }
    if (reason === null) {
      start = f
      end = t
    } else {
      if (from !== null) reject('from', reason)
      if (to !== null) reject('to', reason)
      // A missing partner of a rejected pair is reported too, so the notice names both.
      if (from === null) reject('from', 'missing')
      if (to === null) reject('to', 'missing')
    }
  }

  let baseline: [number, number] | undefined
  const bl = params.get('bl')
  if (bl !== null) {
    const m = /^(\d{4})-(\d{4})$/.exec(bl)
    const first = m === null ? null : parseYear(m[1] ?? '')
    const last = m === null ? null : parseYear(m[2] ?? '')
    if (first !== null && last !== null && first <= last) baseline = [first, last]
    else reject('bl', 'bad_baseline')
  }

  let view: UrlView = 'counts'
  const v = params.get('v')
  if (v !== null) {
    const known = URL_VIEWS.find((id) => id === v)
    if (known !== undefined) view = known
    else reject('v', 'unknown_view')
  }

  // Comparison.
  let compare: UrlCompare = { mode: 'none' }
  const cmp = params.get('cmp')
  const a2 = params.get('a2')
  const from2 = params.get('from2')
  const to2 = params.get('to2')
  const pa = params.get('pa')
  if (cmp === 'area') {
    let area2: UrlArea = { kind: 'region' }
    let ok = true
    if (a2 !== null) {
      if (a2.startsWith('s:')) {
        const id = a2.slice(2)
        if (SHARE_ID.test(id)) area2 = { kind: 'share', id }
        else {
          ok = false
          reject('a2', 'bad_share_id')
        }
      } else {
        const out = decodeAreaCode(a2)
        if (out.ok) area2 = out.area
        else {
          ok = false
          reject('a2', out.reason)
        }
      }
    }
    let perArea = false
    if (pa !== null) {
      if (pa === '1' || pa === '0') perArea = pa === '1'
      else reject('pa', 'bad_flag')
    }
    if (ok) compare = { mode: 'area', area2, perArea }
    else reject('cmp', 'second_area_unusable')
  } else if (cmp === 'period') {
    if (from2 !== null && to2 !== null && isRealDate(from2) && isRealDate(to2) && from2 <= to2) {
      compare = { mode: 'period', start2: from2, end2: to2 }
    } else {
      reject('cmp', 'period_unusable')
      if (from2 !== null) reject('from2', 'bad_period')
      if (to2 !== null) reject('to2', 'bad_period')
    }
  } else if (cmp !== null && cmp !== 'none') {
    reject('cmp', 'unknown_mode')
  }

  let year: number | undefined
  const y = params.get('y')
  if (y !== null) {
    const n = parseYear(y)
    if (n === null) reject('y', 'bad_year')
    else year = n
  }

  let seasonStart: number | undefined
  const ss = params.get('ss')
  if (ss !== null) {
    const n = /^\d{1,2}$/.test(ss) ? Number(ss) : 0
    if (n >= 1 && n <= 12) seasonStart = n
    else reject('ss', 'bad_month')
  }

  let tab: string | undefined
  const tabText = params.get('tab')
  if (tabText !== null) {
    const known = options.tabs === undefined || options.tabs.includes(tabText)
    if (TAB_ID.test(tabText) && known) tab = tabText
    else reject('tab', 'unknown_tab')
  }

  let cell: string | undefined
  const cellText = params.get('cell')
  if (cellText !== null) {
    // Validate cell format with parseCellId instead of just regex pattern
    if (parseCellId(cellText) !== null) cell = cellText
    else reject('cell', 'bad_cell')
  }

  const state: AppState = { area, start, end, view, compare }
  if (baseline !== undefined) state.baseline = baseline
  if (year !== undefined) state.year = year
  if (seasonStart !== undefined) state.seasonStart = seasonStart
  if (tab !== undefined) state.tab = tab
  if (cell !== undefined) state.cell = cell
  return { state, rejected }
}

/**
 * One notice for the user listing what the address held that could not be used, or null.
 * A bad date pair keeps the sentence that names the default range.
 */
export function rejectedNotice(
  rejected: readonly RejectedParam[],
  fallback: DateRange,
): string | null {
  if (rejected.length === 0) return null
  const dateRejected = rejected.some((r) => r.param === 'from' || r.param === 'to')
  const others = [...new Set(rejected.map((r) => r.param))].filter(
    (p) => p !== 'from' && p !== 'to',
  )
  const parts: string[] = []
  if (dateRejected) {
    parts.push(
      `The dates in the page address could not be used, so the default range is shown: ${formatDateRange(fallback.start, fallback.end)}.`,
    )
  }
  if (others.length > 0) {
    parts.push(
      `Some settings in the page address could not be used and were replaced by their defaults: ${others.join(', ')}.`,
    )
  }
  return parts.join(' ')
}

// ---------------------------------------------------------------------------------------------
// Cell selection helpers (task 28.9)
// ---------------------------------------------------------------------------------------------

/**
 * Formats a calendar cell identifier as `YYYY-MM` for the URL `cell` parameter.
 */
export function formatCellId(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

/**
 * Parses a calendar cell identifier from the URL `cell` parameter.
 * Returns `{ year, month }` for a valid cell id, or null for invalid format or out-of-range month.
 */
export function parseCellId(cellId: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{1,2})$/.exec(cellId)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12) return null
  return { year, month }
}

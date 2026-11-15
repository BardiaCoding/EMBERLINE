// Client-side pre-check of a Selection_Area (requirements 11.7, 13.1, 13.4, 13.9). It only
// saves a round trip: the server (`hotspots.geometry.validate_selection`) decides every case.
// The pre-check must therefore never reject a shape the server accepts, and it reports only
// the five reasons in `PRECHECK_REASONS`. Malformed input and a shape outside the region are
// left to the server. The vectors in `tests/data/selection_vectors.json` are checked in
// `geometryPrecheck.test.ts`.
//
// Order of checks (same as the server, first failure wins): too many vertices, coordinate
// range, too few distinct vertices, zero area, self-intersection. All coordinates are EPSG:4326
// (longitude, latitude).

export const MAX_VERTICES = 1000
export const MIN_DISTINCT_VERTICES = 3
/** Smallest convex-hull area of a ring, in square degrees (about 0.1 m by 0.1 m). */
export const ZERO_AREA_TOLERANCE_DEG2 = 1e-12

export const PRECHECK_REASONS = [
  'too_many_vertices',
  'coordinate_out_of_range',
  'too_few_vertices',
  'zero_area',
  'self_intersection',
] as const
export type PrecheckReason = (typeof PRECHECK_REASONS)[number]

export type PrecheckResult =
  | { ok: true; vertexCount: number | null }
  | { ok: false; reason: PrecheckReason; vertexCount: number }

type Pt = readonly [number, number]
type Ring = readonly Pt[]
type PolygonRings = readonly Ring[]

function isNumber(value: unknown): value is number {
  return typeof value === 'number'
}

function parsePosition(value: unknown): Pt | null {
  if (!Array.isArray(value) || (value.length !== 2 && value.length !== 3)) return null
  const [lon, lat] = value as unknown[]
  if (!isNumber(lon) || !isNumber(lat)) return null
  if (value.length === 3 && !isNumber((value as unknown[])[2])) return null
  return [lon, lat]
}

function parsePolygon(value: unknown): PolygonRings | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const rings: Ring[] = []
  for (const ring of value as unknown[]) {
    if (!Array.isArray(ring)) return null
    const points: Pt[] = []
    for (const position of ring as unknown[]) {
      const p = parsePosition(position)
      if (p === null) return null
      points.push(p)
    }
    rings.push(points)
  }
  return rings
}

function parsePolygons(geometry: unknown): PolygonRings[] | null {
  if (typeof geometry !== 'object' || geometry === null) return null
  const { type, coordinates } = geometry as { type?: unknown; coordinates?: unknown }
  if (type === 'Polygon') {
    const polygon = parsePolygon(coordinates)
    return polygon === null ? null : [polygon]
  }
  if (type === 'MultiPolygon') {
    if (!Array.isArray(coordinates) || coordinates.length === 0) return null
    const polygons: PolygonRings[] = []
    for (const part of coordinates as unknown[]) {
      const polygon = parsePolygon(part)
      if (polygon === null) return null
      polygons.push(polygon)
    }
    return polygons
  }
  return null
}

// --- geometry helpers --------------------------------------------------------------------

const COLLINEAR_SIN = 1e-12

/** Sign of the turn a to b to c: 1 left, -1 right, 0 collinear within a relative tolerance. */
function orient(a: Pt, b: Pt, c: Pt): -1 | 0 | 1 {
  const abx = b[0] - a[0]
  const aby = b[1] - a[1]
  const acx = c[0] - a[0]
  const acy = c[1] - a[1]
  const cross = abx * acy - aby * acx
  const scale = Math.hypot(abx, aby) * Math.hypot(acx, acy)
  if (scale === 0 || Math.abs(cross) <= COLLINEAR_SIN * scale) return 0
  return cross > 0 ? 1 : -1
}

/** True when `p`, known to be collinear with a and b, lies within the segment ab. */
function withinSegment(a: Pt, b: Pt, p: Pt): boolean {
  return (
    p[0] >= Math.min(a[0], b[0]) &&
    p[0] <= Math.max(a[0], b[0]) &&
    p[1] >= Math.min(a[1], b[1]) &&
    p[1] <= Math.max(a[1], b[1])
  )
}

/** Closed segments ab and cd share at least one point. */
function segmentsTouch(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o1 = orient(a, b, c)
  const o2 = orient(a, b, d)
  const o3 = orient(c, d, a)
  const o4 = orient(c, d, b)
  if (o1 !== o2 && o3 !== o4) return true
  return (
    (o1 === 0 && withinSegment(a, b, c)) ||
    (o2 === 0 && withinSegment(a, b, d)) ||
    (o3 === 0 && withinSegment(c, d, a)) ||
    (o4 === 0 && withinSegment(c, d, b))
  )
}

/** The open segments cross at one point inside both (a proper crossing, not a touch). */
function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o1 = orient(a, b, c)
  const o2 = orient(a, b, d)
  const o3 = orient(c, d, a)
  const o4 = orient(c, d, b)
  return o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0 && o1 !== o2 && o3 !== o4
}

function samePoint(a: Pt, b: Pt): boolean {
  return a[0] === b[0] && a[1] === b[1]
}

/** Ring without consecutive duplicate positions (zero-length edges). */
function dedupe(ring: Ring): Pt[] {
  const out: Pt[] = []
  for (const p of ring) {
    const last = out[out.length - 1]
    if (last === undefined || !samePoint(last, p)) out.push(p)
  }
  return out
}

/** Area of the convex hull of the points (monotone chain), square degrees. */
function convexHullArea(points: readonly Pt[]): number {
  const sorted = [...points].sort((p, q) => p[0] - q[0] || p[1] - q[1])
  if (sorted.length < 3) return 0
  const cross = (o: Pt, a: Pt, b: Pt) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const build = (input: readonly Pt[]): Pt[] => {
    const hull: Pt[] = []
    for (const p of input) {
      for (;;) {
        const b = hull[hull.length - 1]
        const a = hull[hull.length - 2]
        if (a === undefined || b === undefined || cross(a, b, p) > 0) break
        hull.pop()
      }
      hull.push(p)
    }
    hull.pop()
    return hull
  }
  const hull = [...build(sorted), ...build([...sorted].reverse())]
  let twice = 0
  for (let i = 0; i < hull.length; i += 1) {
    const p = hull[i]
    const q = hull[(i + 1) % hull.length]
    if (p !== undefined && q !== undefined) twice += p[0] * q[1] - q[0] * p[1]
  }
  return Math.abs(twice) / 2
}

type Location = 'inside' | 'boundary' | 'outside'

/** Position of `p` relative to a closed ring (ray casting, boundary tested first). */
function locate(p: Pt, ring: Ring): Location {
  let inside = false
  for (let i = 0; i + 1 < ring.length; i += 1) {
    const a = ring[i]
    const b = ring[i + 1]
    if (a === undefined || b === undefined) continue
    if (orient(a, b, p) === 0 && withinSegment(a, b, p)) return 'boundary'
    if (a[1] > p[1] !== b[1] > p[1]) {
      const x = a[0] + ((p[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1])
      if (p[0] < x) inside = !inside
    }
  }
  return inside ? 'inside' : 'outside'
}

type Seg = { a: Pt; b: Pt }

function segmentsOf(ring: Ring): Seg[] {
  const segs: Seg[] = []
  for (let i = 0; i + 1 < ring.length; i += 1) {
    const a = ring[i]
    const b = ring[i + 1]
    if (a !== undefined && b !== undefined) segs.push({ a, b })
  }
  return segs
}

/** A ring crosses or touches itself, or doubles back along an edge. */
function ringIsNotSimple(ring: Ring): boolean {
  const segs = segmentsOf(dedupe(ring))
  const n = segs.length
  for (let i = 0; i < n; i += 1) {
    const s = segs[i]
    if (s === undefined) continue
    for (let j = i + 1; j < n; j += 1) {
      const t = segs[j]
      if (t === undefined) continue
      const adjacent = j === i + 1 || (i === 0 && j === n - 1)
      if (adjacent) {
        // The edges share one vertex. They overlap when they run back along the same line.
        const shared = j === i + 1 ? s.b : s.a
        const far1 = j === i + 1 ? s.a : s.b
        const far2 = j === i + 1 ? t.b : t.a
        const dot =
          (far1[0] - shared[0]) * (far2[0] - shared[0]) +
          (far1[1] - shared[1]) * (far2[1] - shared[1])
        if (orient(far1, shared, far2) === 0 && dot > 0) return true
      } else if (segmentsTouch(s.a, s.b, t.a, t.b)) {
        return true
      }
    }
  }
  return false
}

function ringsCross(r1: Ring, r2: Ring): boolean {
  const s1 = segmentsOf(dedupe(r1))
  const s2 = segmentsOf(dedupe(r2))
  return s1.some((s) => s2.some((t) => segmentsCross(s.a, s.b, t.a, t.b)))
}

/** Position of a ring vertex of `inner` relative to `outer`, over all vertices. */
function locations(inner: Ring, outer: Ring): Location[] {
  return inner.map((p) => locate(p, outer))
}

/** A hole sticks out of its shell, or two holes lie inside each other. */
function holesInvalid(polygon: PolygonRings): boolean {
  const [shell, ...holes] = polygon
  if (shell === undefined) return false
  for (const hole of holes) {
    if (locations(hole, shell).includes('outside')) return true
  }
  for (let i = 0; i < holes.length; i += 1) {
    for (let j = i + 1; j < holes.length; j += 1) {
      const a = holes[i]
      const b = holes[j]
      if (a === undefined || b === undefined) continue
      if (locations(b, a).includes('inside') || locations(a, b).includes('inside')) return true
    }
  }
  return false
}

/** True when a vertex of `shell` lies in the interior of `other` (inside its shell, not in a hole). */
function shellVertexInInterior(shell: Ring, other: PolygonRings): boolean {
  const [outer, ...holes] = other
  if (outer === undefined) return false
  return shell.some((p) => {
    if (locate(p, outer) !== 'inside') return false
    return holes.every((hole) => locate(p, hole) === 'outside')
  })
}

function selfIntersects(polygons: readonly PolygonRings[]): boolean {
  const allRings = polygons.flat()
  if (allRings.some(ringIsNotSimple)) return true
  for (let i = 0; i < allRings.length; i += 1) {
    for (let j = i + 1; j < allRings.length; j += 1) {
      const a = allRings[i]
      const b = allRings[j]
      if (a !== undefined && b !== undefined && ringsCross(a, b)) return true
    }
  }
  if (polygons.some(holesInvalid)) return true
  for (let i = 0; i < polygons.length; i += 1) {
    for (let j = 0; j < polygons.length; j += 1) {
      const p = polygons[i]
      const q = polygons[j]
      const shell = q?.[0]
      if (i !== j && p !== undefined && q !== undefined && shell !== undefined) {
        if (shellVertexInInterior(shell, p)) return true
      }
    }
  }
  return false
}

// --- entry point -------------------------------------------------------------------------

/**
 * Checks a GeoJSON Polygon or MultiPolygon before it is sent to `/selection/normalize`.
 *
 * Returns `{ok: false, reason}` for one of `PRECHECK_REASONS`. Returns `{ok: true}` for a valid
 * shape and for anything the server must judge: malformed input (wrong type, wrong nesting,
 * a ring that is not closed) and a shape outside the region extent.
 */
export function geometryPrecheck(geometry: unknown): PrecheckResult {
  const polygons = parsePolygons(geometry)
  if (polygons === null) return { ok: true, vertexCount: null }
  const rings = polygons.flat()
  const count = rings.reduce((sum, ring) => sum + ring.length, 0)
  const fail = (reason: PrecheckReason): PrecheckResult => ({
    ok: false,
    reason,
    vertexCount: count,
  })

  if (count > MAX_VERTICES) return fail('too_many_vertices')
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return fail('coordinate_out_of_range')
      if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return fail('coordinate_out_of_range')
    }
  }
  for (const ring of rings) {
    const distinct = new Set(ring.map(([lon, lat]) => `${lon},${lat}`))
    if (distinct.size < MIN_DISTINCT_VERTICES) return fail('too_few_vertices')
  }
  for (const ring of rings) {
    if (convexHullArea(ring) < ZERO_AREA_TOLERANCE_DEG2) return fail('zero_area')
  }
  for (const ring of rings) {
    const first = ring[0]
    const last = ring[ring.length - 1]
    // An open ring is malformed. The server reports it.
    if (ring.length < 4 || first === undefined || last === undefined || !samePoint(first, last)) {
      return { ok: true, vertexCount: count }
    }
  }
  if (selfIntersects(polygons)) return fail('self_intersection')
  return { ok: true, vertexCount: count }
}

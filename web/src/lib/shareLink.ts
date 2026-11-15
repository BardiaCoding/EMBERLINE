// Share links (requirements 19.6 and 19.7). The page address stays the source of truth: a link
// carries the whole state. When that address is longer than 2000 characters, the area is stored
// through the API and replaced by a short identifier (`s=`). When the API cannot store it, the
// area is simplified (Douglas-Peucker) until the address fits, and the largest displacement of
// any vertex is reported in metres. Coordinates are EPSG:4326 (longitude, latitude) in degrees.
import type { AreaGeometry } from './areaGeometry'
import { serializeState, type AppState } from './urlState'

/** Longest share URL, in characters (DEFAULT (confirm), requirement 19.6). */
export const SHARE_URL_LIMIT = 2000

const METRES_PER_DEGREE = 111_195 // mean Earth radius 6371.0088 km
const FIRST_TOLERANCE_M = 1
const TOLERANCE_GROWTH = 1.5
const MAX_TOLERANCE_M = 2_000_000

type Position = readonly [number, number]
type Ring = readonly Position[]
type Plane = { x: number; y: number }

function project(p: Position, lat0: number): Plane {
  return {
    x: p[0] * Math.cos((lat0 * Math.PI) / 180) * METRES_PER_DEGREE,
    y: p[1] * METRES_PER_DEGREE,
  }
}

function distanceToSegment(p: Plane, a: Plane, b: Plane): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  const t =
    lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Douglas-Peucker on an open polyline of projected points. Returns the kept indices. */
function douglasPeucker(points: readonly Plane[], tolerance: number): number[] {
  const keep = new Set<number>([0, points.length - 1])
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length > 0) {
    const [first, last] = stack.pop() ?? [0, 0]
    let worst = -1
    let worstDistance = tolerance
    const a = points[first]
    const b = points[last]
    if (a === undefined || b === undefined) continue
    for (let i = first + 1; i < last; i += 1) {
      const p = points[i]
      if (p === undefined) continue
      const d = distanceToSegment(p, a, b)
      if (d > worstDistance) {
        worst = i
        worstDistance = d
      }
    }
    if (worst >= 0) {
      keep.add(worst)
      stack.push([first, worst], [worst, last])
    }
  }
  return [...keep].sort((x, y) => x - y)
}

/**
 * Simplifies one closed ring. The ring is cut at its first vertex and at the vertex farthest
 * from it, so a closed ring never collapses to a line. Keeps at least 4 positions (3 distinct).
 */
function simplifyRing(ring: Ring, tolerance: number, lat0: number): Position[] {
  if (ring.length <= 4) return [...ring]
  const points = ring.map((p) => project(p, lat0))
  const first = points[0]
  if (first === undefined) return [...ring]
  let far = 1
  let farDistance = -1
  points.forEach((p, i) => {
    const d = Math.hypot(p.x - first.x, p.y - first.y)
    if (i > 0 && i < points.length - 1 && d > farDistance) {
      far = i
      farDistance = d
    }
  })
  const left = douglasPeucker(points.slice(0, far + 1), tolerance)
  const right = douglasPeucker(points.slice(far), tolerance).map((i) => i + far)
  const kept = [...new Set([...left, ...right])].sort((x, y) => x - y)
  const out = kept.map((i) => ring[i]).filter((p): p is Position => p !== undefined)
  return out.length >= 4 ? out : [...ring]
}

function geometryRings(geometry: AreaGeometry): Ring[] {
  return geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat()
}

function meanLatitude(geometry: AreaGeometry): number {
  let sum = 0
  let n = 0
  for (const ring of geometryRings(geometry)) {
    for (const p of ring) {
      sum += p[1]
      n += 1
    }
  }
  return n === 0 ? 0 : sum / n
}

/** Douglas-Peucker simplification of every ring, with `toleranceM` in metres. */
export function simplifyGeometry(geometry: AreaGeometry, toleranceM: number): AreaGeometry {
  const lat0 = meanLatitude(geometry)
  const ring = (r: Ring): [number, number][] =>
    simplifyRing(r, toleranceM, lat0).map((p) => [p[0], p[1]])
  if (geometry.type === 'Polygon') {
    return { type: 'Polygon', coordinates: geometry.coordinates.map(ring) }
  }
  return { type: 'MultiPolygon', coordinates: geometry.coordinates.map((p) => p.map(ring)) }
}

/**
 * The largest distance, in metres, from a vertex of `original` to the boundary of
 * `simplified` (the same rings, fewer vertices). Zero when nothing was removed.
 */
export function maxDisplacementMetres(original: AreaGeometry, simplified: AreaGeometry): number {
  const lat0 = meanLatitude(original)
  const before = geometryRings(original)
  const after = geometryRings(simplified)
  let worst = 0
  before.forEach((ring, index) => {
    const kept = (after[index] ?? []).map((p) => project(p, lat0))
    if (kept.length === 0) return
    for (const vertex of ring) {
      const p = project(vertex, lat0)
      let best = Infinity
      for (let i = 0; i + 1 < kept.length; i += 1) {
        const a = kept[i]
        const b = kept[i + 1]
        if (a !== undefined && b !== undefined) best = Math.min(best, distanceToSegment(p, a, b))
      }
      if (best === Infinity && kept[0] !== undefined) {
        best = Math.hypot(p.x - kept[0].x, p.y - kept[0].y)
      }
      worst = Math.max(worst, best)
    }
  })
  return worst
}

function vertexCount(geometry: AreaGeometry): number {
  return geometryRings(geometry).reduce((sum, r) => sum + r.length, 0)
}

export type ShareLinkOutcome =
  | { kind: 'full'; url: string }
  | { kind: 'stored'; url: string; id: string }
  | { kind: 'simplified'; url: string; maxDisplacementM: number; vertices: number }
  | { kind: 'too_long'; url: string }

export type ShareLinkInput = {
  /** Address up to the query string, for example `https://host/path`. */
  baseUrl: string
  /** The current query string; parameters the app does not manage are kept. */
  search: string
  state: AppState
  /** Stores the area through the API and returns its id. Rejects when that is not possible. */
  storeArea: (geometry: AreaGeometry) => Promise<string>
}

function urlFor(input: ShareLinkInput, state: AppState): string {
  return `${input.baseUrl}${serializeState(input.search, state)}`
}

/**
 * Builds the link to copy. Within 2000 characters the whole state is in the link. Beyond that,
 * the area is stored (`s=<id>`), and if that fails it is simplified until the link fits.
 */
export async function buildShareLink(input: ShareLinkInput): Promise<ShareLinkOutcome> {
  const full = urlFor(input, input.state)
  const area = input.state.area
  if (full.length <= SHARE_URL_LIMIT || area.kind !== 'geom') {
    return full.length <= SHARE_URL_LIMIT
      ? { kind: 'full', url: full }
      : { kind: 'too_long', url: full }
  }
  try {
    const id = await input.storeArea(area.geometry)
    const stored = urlFor(input, { ...input.state, area: { kind: 'share', id } })
    return { kind: 'stored', url: stored, id }
  } catch {
    // The store is not available: fall back to simplification (requirement 19.7).
  }
  let simplified = area.geometry
  for (
    let tolerance = FIRST_TOLERANCE_M;
    tolerance <= MAX_TOLERANCE_M;
    tolerance *= TOLERANCE_GROWTH
  ) {
    simplified = simplifyGeometry(area.geometry, tolerance)
    const url = urlFor(input, { ...input.state, area: { kind: 'geom', geometry: simplified } })
    if (url.length <= SHARE_URL_LIMIT) {
      return {
        kind: 'simplified',
        url,
        maxDisplacementM: maxDisplacementMetres(area.geometry, simplified),
        vertices: vertexCount(simplified),
      }
    }
  }
  return { kind: 'too_long', url: full }
}

/** One sentence for the user about the link that was copied. */
export function shareMessage(outcome: ShareLinkOutcome): string {
  switch (outcome.kind) {
    case 'full':
      return 'Link copied.'
    case 'stored':
      return 'Link copied. The area is stored on the server as a short link that works for 30 days.'
    case 'simplified': {
      const metres = Math.max(1, Math.round(outcome.maxDisplacementM))
      return `Link copied. The area was too detailed for a link and the server could not store it, so the shared area is simplified (${outcome.vertices} vertices). The largest vertex displacement is ${metres.toLocaleString('en-US')} m.`
    }
    case 'too_long':
      return 'The link is longer than 2000 characters and could not be shortened. It was copied anyway; some apps may cut it.'
  }
}

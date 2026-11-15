// Selection_Area geometry types and small pure helpers. Coordinates are EPSG:4326
// (longitude, latitude) in decimal degrees. Shapes arrive from Terra Draw, from the example
// areas in `/meta` and from `/selection/normalize`, all at a trust boundary, so they are parsed
// with zod before use.
import { z } from 'zod'

export type Extent = { west: number; south: number; east: number; north: number }

const positionSchema = z.tuple([z.number(), z.number()])
const ringSchema = z.array(positionSchema)

export const areaGeometrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Polygon'), coordinates: z.array(ringSchema) }),
  z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(z.array(ringSchema)) }),
])

/** A GeoJSON Polygon or MultiPolygon with 2-D positions (longitude, latitude). */
export type AreaGeometry = z.infer<typeof areaGeometrySchema>

/** Parses a GeoJSON geometry. Null when it is not a Polygon or MultiPolygon with numeric positions. */
export function parseAreaGeometry(value: unknown): AreaGeometry | null {
  const parsed = areaGeometrySchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

function rings(geometry: AreaGeometry): readonly (readonly [number, number])[][] {
  return geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat()
}

/** Bounding box of every position, or null for a geometry without positions. */
export function geometryBbox(geometry: AreaGeometry): Extent | null {
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  for (const ring of rings(geometry)) {
    for (const [lon, lat] of ring) {
      west = Math.min(west, lon)
      east = Math.max(east, lon)
      south = Math.min(south, lat)
      north = Math.max(north, lat)
    }
  }
  return Number.isFinite(west + east + south + north) ? { west, south, east, north } : null
}

/** Closed counter-clockwise rectangle polygon of a bounding box. */
export function bboxToGeometry(extent: Extent): AreaGeometry {
  const { west, south, east, north } = extent
  return {
    type: 'Polygon',
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  }
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/** True when both geometries have the same positions after rounding to `decimals` places. */
export function sameGeometry(a: AreaGeometry, b: AreaGeometry, decimals = 6): boolean {
  if (a.type !== b.type) return false
  const key = (g: AreaGeometry) =>
    JSON.stringify(g.coordinates, (_k, v: unknown) =>
      typeof v === 'number' ? round(v, decimals) : v,
    )
  return key(a) === key(b)
}

/** Bounding box to 5 decimal places, as west, south, east, north (requirement 12.4). */
export function formatBbox5(extent: Extent): string {
  const f = (v: number) => v.toFixed(5)
  return `west ${f(extent.west)}, south ${f(extent.south)}, east ${f(extent.east)}, north ${f(extent.north)}`
}

/** GeoJSON text of the geometry, for the clipboard. */
export function geometryToGeoJsonText(geometry: AreaGeometry): string {
  return JSON.stringify({ type: geometry.type, coordinates: geometry.coordinates })
}

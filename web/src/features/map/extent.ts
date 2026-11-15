import type { MetaOut } from '@/lib/api'
import { geometryBbox, type AreaGeometry } from '@/lib/areaGeometry'

/**
 * Pure helpers for the map view: the region extent, its outline and the map note.
 * No MapLibre import here, so everything in this file runs under jsdom.
 * CRS: EPSG:4326 (longitude, latitude in decimal degrees).
 */

export type Extent = { west: number; south: number; east: number; north: number }

/**
 * Fallback region extent, used only until `/api/v1/meta` answers or when it fails.
 * These are the values measured on the delivered files (lat 32.5 to 42.2, lon -124.4 to -114.0).
 * DEFAULT (confirm) until the data owner confirms. The FIRMS download request box
 * (lat 32.0 to 42.5, lon -125.0 to -113.0) is not the data extent and is never used here.
 */
export const DEFAULT_REGION_EXTENT: Readonly<Extent> = {
  west: -124.4,
  south: 32.5,
  east: -114.0,
  north: 42.2,
}

/** Region label. Never "California state": whether a state boundary mask was applied is unknown. */
export const DEFAULT_REGION_NAME = 'California region'

/** Requirement 11.18: states how a drawn shape is matched to cells. */
export const CELL_SELECTION_NOTE =
  'Results use the 0.1 degree cells whose centre lies inside your area'

/** True when the extent is finite, in range and ordered (west < east, south < north). */
export function isValidExtent(extent: Extent): boolean {
  const { west, south, east, north } = extent
  return (
    [west, south, east, north].every(Number.isFinite) &&
    west >= -180 &&
    east <= 180 &&
    south >= -90 &&
    north <= 90 &&
    west < east &&
    south < north
  )
}

/** Reads the `/meta` extent (west, south, east, north). Null when missing or invalid. */
export function extentFromMeta(meta: Pick<MetaOut, 'extent'> | null | undefined): Extent | null {
  if (!meta) return null
  const { west, south, east, north } = meta.extent
  const extent = { west, south, east, north }
  return isValidExtent(extent) ? extent : null
}

/** The extent to draw: the given one when valid, else the DEFAULT (confirm) fallback. */
export function resolveExtent(extent: Extent | null | undefined): Extent {
  return extent && isValidExtent(extent) ? extent : { ...DEFAULT_REGION_EXTENT }
}

/** MapLibre bounds as `[[west, south], [east, north]]`. */
export function extentBounds(extent: Extent): [[number, number], [number, number]] {
  return [
    [extent.west, extent.south],
    [extent.east, extent.north],
  ]
}

/** Closed counter-clockwise ring of the extent: SW, SE, NE, NW, SW. */
export function extentRing(extent: Extent): [number, number][] {
  const { west, south, east, north } = extent
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ]
}

export type ExtentOutline = {
  type: 'Feature'
  properties: { name: string }
  geometry: { type: 'Polygon'; coordinates: [number, number][][] }
}

/** GeoJSON polygon of the extent, drawn as the region outline. */
export function extentOutlineGeoJSON(
  extent: Extent,
  name: string = DEFAULT_REGION_NAME,
): ExtentOutline {
  return {
    type: 'Feature',
    properties: { name },
    geometry: { type: 'Polygon', coordinates: [extentRing(extent)] },
  }
}

/** One-line text of the extent for screen readers and the caption. */
export function formatExtent(extent: Extent): string {
  const lat = `lat ${extent.south.toFixed(1)} to ${extent.north.toFixed(1)}`
  const lon = `lon ${extent.west.toFixed(1)} to ${extent.east.toFixed(1)}`
  return `${lat}, ${lon} (EPSG:4326)`
}

/** Smallest width or height (degrees) the view is fitted to, so a tiny area is not zoomed to street level. */
export const MIN_FIT_SPAN_DEG = 0.2

/**
 * The extent the view should show: the bounding box of the selection when there is one, else
 * the region extent. A very small box is widened around its centre to `MIN_FIT_SPAN_DEG`.
 * Always valid (west < east, south < north), in (lon, lat) order, EPSG:4326.
 */
export function fitExtentFor(selection: AreaGeometry | null | undefined, region: Extent): Extent {
  const box = selection ? geometryBbox(selection) : null
  if (!box) return region
  const grow = (lo: number, hi: number): [number, number] => {
    if (hi - lo >= MIN_FIT_SPAN_DEG) return [lo, hi]
    const mid = (lo + hi) / 2
    return [mid - MIN_FIT_SPAN_DEG / 2, mid + MIN_FIT_SPAN_DEG / 2]
  }
  const [west, east] = grow(box.west, box.east)
  const [south, north] = grow(box.south, box.north)
  const fitted = { west, south, east, north }
  return isValidExtent(fitted) ? fitted : region
}

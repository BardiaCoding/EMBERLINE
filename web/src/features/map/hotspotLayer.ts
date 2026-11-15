import type { FeatureCollection, Point, Polygon } from 'geojson'
import { cividisClasses, SATELLITE_COLOURS, SATELLITE_FALLBACK_COLOUR } from '@/styles/palettes'
import type { MapCell, MapLayerOut, MapPoint } from './mapLayerApi'

/**
 * Pure helpers of the hotspot layer: GeoJSON, colour classes and the legend model. No MapLibre
 * import. The data are filtered raw detections, not harmonized (requirement 11.5).
 */

export const HOTSPOT_LAYER_LABEL = 'Hotspot detections: raw detections, not harmonized'

/** Number of density classes. */
export const DENSITY_CLASS_COUNT = 5

export type PointProps = { satellite: string; local_date: string; frp: number | null }
export type CellProps = { count: number; colour: string }

export function satelliteColour(satellite: string): string {
  return SATELLITE_COLOURS[satellite] ?? SATELLITE_FALLBACK_COLOUR
}

export function pointsGeoJSON(points: readonly MapPoint[]): FeatureCollection<Point, PointProps> {
  return {
    type: 'FeatureCollection',
    features: points.map((p) => ({
      type: 'Feature',
      properties: { satellite: p.satellite, local_date: p.local_date, frp: p.frp },
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    })),
  }
}

/** Colour of each satellite in the data, for the `match` expression and the legend. */
export function satellitesIn(points: readonly MapPoint[]): string[] {
  return [...new Set(points.map((p) => p.satellite))].sort()
}

export type DensityClass = {
  /** Smallest count of the class. */
  min: number
  /** Largest count of the class. */
  max: number
  colour: string
}

/**
 * Up to `DENSITY_CLASS_COUNT` classes of equal width over the range of the counts, on the
 * cividis palette (darkest = fewest). Fewer classes when the counts have fewer distinct values.
 * Each count belongs to exactly one class.
 */
export function densityClasses(cells: readonly MapCell[]): DensityClass[] {
  if (cells.length === 0) return []
  const counts = cells.map((c) => c.count)
  const lo = Math.min(...counts)
  const hi = Math.max(...counts)
  const n = Math.max(1, Math.min(DENSITY_CLASS_COUNT, hi - lo + 1))
  const colours = cividisClasses(n)
  const width = (hi - lo + 1) / n
  return colours.map((colour, i) => ({
    min: Math.round(lo + i * width),
    max: i === n - 1 ? hi : Math.round(lo + (i + 1) * width) - 1,
    colour,
  }))
}

export function classOf(count: number, classes: readonly DensityClass[]): DensityClass | undefined {
  return classes.find((c) => count >= c.min && count <= c.max) ?? classes[classes.length - 1]
}

/** Squares of `size` degrees around each cell centre, coloured by class. */
export function cellsGeoJSON(
  cells: readonly MapCell[],
  size: number,
  classes: readonly DensityClass[],
): FeatureCollection<Polygon, CellProps> {
  const h = size / 2
  return {
    type: 'FeatureCollection',
    features: cells.map((c) => ({
      type: 'Feature',
      properties: { count: c.count, colour: classOf(c.count, classes)?.colour ?? '' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [c.lon - h, c.lat - h],
            [c.lon + h, c.lat - h],
            [c.lon + h, c.lat + h],
            [c.lon - h, c.lat + h],
            [c.lon - h, c.lat - h],
          ],
        ],
      },
    })),
  }
}

export type HotspotLayerData = {
  mode: 'points' | 'density'
  points: FeatureCollection<Point, PointProps>
  cells: FeatureCollection<Polygon, CellProps>
}

export const EMPTY_HOTSPOT_LAYER: HotspotLayerData = {
  mode: 'points',
  points: { type: 'FeatureCollection', features: [] },
  cells: { type: 'FeatureCollection', features: [] },
}

export function hotspotLayerData(layer: MapLayerOut | null | undefined): HotspotLayerData {
  if (!layer) return EMPTY_HOTSPOT_LAYER
  if (layer.mode === 'points') {
    return { ...EMPTY_HOTSPOT_LAYER, mode: 'points', points: pointsGeoJSON(layer.points) }
  }
  const classes = densityClasses(layer.cells)
  return {
    ...EMPTY_HOTSPOT_LAYER,
    mode: 'density',
    cells: cellsGeoJSON(layer.cells, layer.cell_size_deg, classes),
  }
}

export type LegendModel =
  | { kind: 'points'; items: { label: string; colour: string }[] }
  | { kind: 'density'; items: { label: string; colour: string }[] }
  | { kind: 'empty' }

export function legendModel(layer: MapLayerOut): LegendModel {
  if (layer.total === 0) return { kind: 'empty' }
  if (layer.mode === 'points') {
    return {
      kind: 'points',
      items: satellitesIn(layer.points).map((s) => ({ label: s, colour: satelliteColour(s) })),
    }
  }
  return {
    kind: 'density',
    items: densityClasses(layer.cells).map((c) => ({
      label: c.min === c.max ? `${c.min}` : `${c.min} to ${c.max}`,
      colour: c.colour,
    })),
  }
}

import type { RecentOut, RecentPoint } from './recentApi'

/** Pure helpers of the Recent view. */

/** The stale-data notice shows when the data are more than `staleAfterDays` days old (20.3). */
export function isStale(dataAgeDays: number, staleAfterDays = 3): boolean {
  return dataAgeDays > staleAfterDays
}

/** True when the 7 days hold no detection (requirement 20.5). */
export function isEmptyWindow(recent: Pick<RecentOut, 'days'>): boolean {
  return recent.days.every((d) => d.count === 0)
}

/** Bar height as a share of the tallest bar, 0 to 1. All zeros give 0. */
export function barShare(count: number, max: number): number {
  return max <= 0 ? 0 : Math.min(1, Math.max(0, count / max))
}

export type ProjectedPoint = { x: number; y: number; point: RecentPoint }

/**
 * Plain equirectangular projection of the points into a `width` by `height` box, with a margin.
 * Longitude is scaled by the cosine of the mean latitude so shapes are not stretched. Empty input
 * gives an empty list. Coordinates are EPSG:4326 degrees.
 */
export function projectPoints(
  points: readonly RecentPoint[],
  width: number,
  height: number,
  margin = 8,
): ProjectedPoint[] {
  if (points.length === 0) return []
  const lats = points.map((p) => p.lat)
  const lons = points.map((p) => p.lon)
  const south = Math.min(...lats)
  const north = Math.max(...lats)
  const west = Math.min(...lons)
  const east = Math.max(...lons)
  const k = Math.cos((((south + north) / 2) * Math.PI) / 180)
  const spanX = Math.max((east - west) * k, 1e-6)
  const spanY = Math.max(north - south, 1e-6)
  const scale = Math.min((width - 2 * margin) / spanX, (height - 2 * margin) / spanY)
  const offX = (width - spanX * scale) / 2
  const offY = (height - spanY * scale) / 2
  return points.map((point) => ({
    x: offX + (point.lon - west) * k * scale,
    y: height - (offY + (point.lat - south) * scale),
    point,
  }))
}

/** Satellites in the points, sorted, with their point counts. */
export function satelliteCounts(points: readonly RecentPoint[]): [string, number][] {
  const tally = new Map<string, number>()
  for (const p of points) tally.set(p.satellite, (tally.get(p.satellite) ?? 0) + 1)
  return [...tally.entries()].sort(([a], [b]) => a.localeCompare(b))
}

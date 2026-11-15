// Plain-language messages for a rejected, clipped or empty Selection_Area (requirements 11.7,
// 11.8, 12.8, 13.1 to 13.5, 13.7). The reason codes are those of `hotspots.geometry` and
// `lib/geometryPrecheck.ts`. A message never repeats the submitted coordinates.
import type { Extent } from '@/features/map/extent'
import { MAX_VERTICES } from '@/lib/geometryPrecheck'
import { REGION_LABEL } from '@/lib/format'

/** The region extent as west, south, east and north in decimal degrees (requirement 13.2). */
export function extentText(extent: Extent): string {
  return `west ${extent.west}, south ${extent.south}, east ${extent.east}, north ${extent.north}`
}

export type MessageContext = {
  extent: Extent
  /** Number of vertices submitted, when known. */
  vertexCount?: number | null
}

/** Message for a validation reason code, or null for a code this app does not know. */
export function reasonMessage(reason: string, context: MessageContext): string | null {
  switch (reason) {
    case 'self_intersection':
      return 'The area outline crosses itself. Redraw it so that no lines cross.'
    case 'too_few_vertices':
      return 'The area needs at least 3 distinct vertices.'
    case 'zero_area':
      return 'The area has zero area because all its vertices lie on one line.'
    case 'too_many_vertices':
      return context.vertexCount === null || context.vertexCount === undefined
        ? `The area has too many vertices. The limit is ${MAX_VERTICES}, counted across all rings and parts.`
        : `The area has ${context.vertexCount} vertices. The limit is ${MAX_VERTICES}, counted across all rings and parts.`
    case 'coordinate_out_of_range':
      return 'Coordinates must be longitude -180 to 180 and latitude -90 to 90.'
    case 'malformed_geometry':
      return 'The area is not a valid polygon.'
    case 'outside_extent':
      return `The area is outside the ${REGION_LABEL} (${extentText(context.extent)}). Choose an area inside the dashed outline on the map.`
    case 'west_not_less_than_east':
      return 'West must be less than east.'
    case 'south_not_less_than_north':
      return 'South must be less than north.'
    case 'radius_out_of_range':
      return 'Radius must be between 1 and 500 km.'
    case 'malformed_geojson':
      return 'The file is not valid GeoJSON. Use a FeatureCollection, Feature or polygon geometry.'
    case 'no_polygon_features':
      return 'The GeoJSON holds no polygon features. Only Polygon and MultiPolygon shapes can be used.'
    case 'file_too_large':
      return 'The file is larger than 5 MB. Choose a smaller GeoJSON file.'
    default:
      return null
  }
}

/** Notice for a shape clipped to the region extent (requirement 13.3). */
export function clippingNotice(percent: number): string {
  const removed = percent < 0.05 ? 'less than 0.1' : percent.toFixed(1)
  return `Clipped to the ${REGION_LABEL}: ${removed} % of your area lay outside it and was removed.`
}

/** Notice for an area that holds no 0.1 degree cell centre (requirements 9.12, 12.8). */
export const NO_CELLS_NOTICE =
  'No 0.1 degree cell centre lies inside this area, so every count is zero. Try a larger area.'

export const PREVIOUS_AREA_KEPT = 'The previous area and its results are unchanged.'

/** Notice for a GeoJSON upload that held features other than polygons (requirement 12.5). */
export function ignoredFeaturesNotice(count: number): string {
  return count === 1
    ? '1 feature in the file is not a polygon and was ignored.'
    : `${count} features in the file are not polygons and were ignored.`
}

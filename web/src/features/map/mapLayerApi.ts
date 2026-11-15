import { useQuery } from '@tanstack/react-query'
import { apiPost, type ApiGeometry, type ApiRequestOptions } from '@/lib/api'

/**
 * Hotspot map layer API (`POST /api/v1/map-layer`, requirement 11.5). The detections are
 * filtered RAW detections, not harmonized. Days use fixed UTC-8. Coordinates are EPSG:4326.
 */

export type MapLayerRequest = {
  /** Selection_Area, or null for the full region. */
  geometry: ApiGeometry | null
  /** First local date, `YYYY-MM-DD` (UTC-8). */
  start: string
  /** Last local date, inclusive. */
  end: string
  /** Optional `YYYY-MM`: only that month of the range. */
  month?: string | null
}

export type MapPoint = {
  lat: number
  lon: number
  satellite: string
  /** Local date (UTC-8). */
  local_date: string
  /** Fire radiative power in MW, null when missing. */
  frp: number | null
}

export type MapCell = {
  /** Cell centre. */
  lat: number
  lon: number
  /** Raw cell-days (`raw_modis + raw_viirs`). Not harmonized. */
  count: number
  raw_modis: number
  raw_viirs: number
}

export type MapLayerOut = {
  mode: 'points' | 'density'
  /** Detections in the area and dates. */
  total: number
  max_points: number
  points: MapPoint[]
  cells: MapCell[]
  cell_size_deg: number
  label: string
  time_convention: string
  month: string | null
}

export function postMapLayer(
  request: MapLayerRequest,
  options?: Omit<ApiRequestOptions, 'method' | 'body'>,
) {
  return apiPost<MapLayerOut>('/api/v1/map-layer', request, options)
}

export function mapLayerQueryKey(request: MapLayerRequest) {
  return ['map-layer', request] as const
}

/** The hotspot layer of a query. Disabled while `request` is null. */
export function useMapLayerQuery(request: MapLayerRequest | null) {
  return useQuery<MapLayerOut>({
    queryKey: request === null ? ['map-layer', 'disabled'] : mapLayerQueryKey(request),
    queryFn: ({ signal }) => {
      if (request === null) throw new Error('Map layer query is disabled')
      return postMapLayer(request, { signal })
    },
    enabled: request !== null,
  })
}

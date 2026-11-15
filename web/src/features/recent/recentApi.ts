import { useQuery } from '@tanstack/react-query'
import { apiPost, type ApiGeometry, type ApiRequestOptions, type StatsOut } from '@/lib/api'

/**
 * Recent view API (`POST /api/v1/recent`, requirement 20). Every value is a count of filtered RAW
 * detections: not harmonized, not comparable across sensors. Days use fixed UTC-8.
 */
export type RecentRequest = {
  /** Selection_Area, or null for the full region. */
  geometry: ApiGeometry | null
  /** Optional baseline period for the monthly `watch` object. */
  baseline_years?: [number, number] | null
}

export type RecentDay = {
  /** Local date (UTC-8), `YYYY-MM-DD`. */
  date: string
  /** Raw detections of that day. */
  count: number
}

export type RecentPoint = {
  lat: number
  lon: number
  satellite: string
  /** As delivered. */
  source: string | null
  local_date: string
  /** True UTC instant. */
  acq_datetime_utc: string
  /** Fire radiative power in MW, null when missing. */
  frp: number | null
}

export type RecentOut = {
  window_start: string
  window_end: string
  days: RecentDay[]
  total: number
  points: RecentPoint[]
  points_omitted: number
  max_points: number
  latest_utc: string
  data_age_days: number
  stale_after_days: number
  watch: StatsOut['watch']
  label: string
  unit: string
  time_convention: string
}

/** The Recent view gives up after 10 seconds (requirement 20.6). DEFAULT (confirm). */
export const RECENT_TIMEOUT_MS = 10_000

export function postRecent(
  request: RecentRequest,
  options?: Omit<ApiRequestOptions, 'method' | 'body' | 'timeoutMs'>,
) {
  return apiPost<RecentOut>('/api/v1/recent', request, { ...options, timeoutMs: RECENT_TIMEOUT_MS })
}

export function recentQueryKey(request: RecentRequest) {
  return ['recent', request] as const
}

/** The last 7 local days of raw detections for an area. */
export function useRecentQuery(request: RecentRequest) {
  return useQuery<RecentOut>({
    queryKey: recentQueryKey(request),
    queryFn: ({ signal }) => postRecent(request, { signal }),
  })
}

// TanStack Query hooks for the API (design.md section 11.2). Each query key is the canonical
// query, so the same area and dates share one cache entry (requirement 28.4). The query
// client keeps previous data while a new query loads (`placeholderData: keepPreviousData`).
import { useQuery } from '@tanstack/react-query'
import {
  getHealth,
  getMeta,
  postCalendar,
  postSeason,
  postStats,
  type ApiGeometry,
  type CalendarOut,
  type CalendarRequest,
  type HealthOut,
  type MetaOut,
  type SeasonOut,
  type SeasonRequest,
  type StatsOut,
} from './api'
import type { DateRange } from './dates'

export const healthQueryKey = ['health'] as const
export const metaQueryKey = ['meta'] as const

/** Query key of a Calendar request. Object keys are hashed in sorted order by TanStack Query. */
export function calendarQueryKey(request: CalendarRequest) {
  return ['calendar', request] as const
}

/**
 * Calendar request for the full region: no geometry (the API uses the extent) and, by default,
 * no user baseline. The Date_Range is sent unchanged; the API answers in whole months.
 */
export function fullExtentCalendarRequest(
  range: DateRange,
  baselineYears: [number, number] | null = null,
): CalendarRequest {
  const request: CalendarRequest = { geometry: null, start: range.start, end: range.end }
  if (baselineYears !== null) request.baseline_years = baselineYears
  return request
}

/**
 * Calendar request for a Selection_Area. `geometry` is the clipped polygon returned by
 * `/selection/normalize`, or null for the full region (the default).
 */
export function areaCalendarRequest(
  range: DateRange,
  geometry: ApiGeometry | null,
  baselineYears: [number, number] | null = null,
): CalendarRequest {
  // The same body feeds /calendar, /stats, /season and the analytics CSV, so one baseline
  // applies everywhere. It is left out for the default (full record).
  const request: CalendarRequest = { geometry, start: range.start, end: range.end }
  if (baselineYears !== null) request.baseline_years = baselineYears
  return request
}

/** `GET /api/health`. A 503 error means the delivered data are missing (requirement 32.7). */
export function useHealthQuery() {
  return useQuery<HealthOut>({
    queryKey: healthQueryKey,
    queryFn: ({ signal }) => getHealth({ signal }),
  })
}

/** `GET /api/v1/meta`: region, record bounds, latest month. */
export function useMetaQuery() {
  return useQuery<MetaOut>({
    queryKey: metaQueryKey,
    queryFn: ({ signal }) => getMeta({ signal }),
  })
}

/**
 * A Calendar result with the Date_Range it answers. The Calendar model needs that range, and
 * while a new query loads the held (previous) result must keep its own range, not the new one.
 */
export type CalendarData = { range: DateRange; result: CalendarOut }

/** Query key of a stats request: the same canonical body as the Calendar request. */
export function statsQueryKey(request: CalendarRequest) {
  return ['stats', request] as const
}

/** A stats result with the Date_Range it answers (see `CalendarData`). */
export type StatsData = { range: DateRange; result: StatsOut }

/**
 * `POST /api/v1/stats`: key figures, rankings and the seasonal profile. Disabled while
 * `request` is null. Kept in step with `useCalendarQuery` by the caller (same request).
 */
export function useStatsQuery(request: CalendarRequest | null) {
  return useQuery<StatsData>({
    queryKey: request === null ? ['stats', 'disabled'] : statsQueryKey(request),
    queryFn: ({ signal }) => {
      if (request === null) throw new Error('Stats query is disabled')
      const { start, end } = request
      return postStats(request, { signal }).then((result) => ({
        range: { start, end },
        result,
      }))
    },
    enabled: request !== null,
  })
}

/** `POST /api/v1/calendar`. Disabled while `request` is null (no valid Date_Range yet). */
export function useCalendarQuery(request: CalendarRequest | null) {
  return useQuery<CalendarData>({
    queryKey: request === null ? ['calendar', 'disabled'] : calendarQueryKey(request),
    queryFn: ({ signal }) => {
      if (request === null) throw new Error('Calendar query is disabled')
      const { start, end } = request
      return postCalendar(request, { signal }).then((result) => ({
        range: { start, end },
        result,
      }))
    },
    enabled: request !== null,
  })
}

/** Query key of a season tracker request. */
export function seasonQueryKey(request: SeasonRequest) {
  return ['season', request] as const
}

/** `POST /api/v1/season`. Disabled while `request` is null (no valid Date_Range yet). */
export function useSeasonQuery(request: SeasonRequest | null) {
  return useQuery<SeasonOut>({
    queryKey: request === null ? ['season', 'disabled'] : seasonQueryKey(request),
    queryFn: ({ signal }) => {
      if (request === null) throw new Error('Season query is disabled')
      return postSeason(request, { signal })
    },
    enabled: request !== null,
  })
}

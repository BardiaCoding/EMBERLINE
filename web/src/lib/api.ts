import type { components } from './api.types'

/**
 * Typed fetch wrapper for the Hotspots API.
 *
 * - Every request is aborted after 30 s (Req 26.5, 28.6) with `AbortSignal.timeout`.
 * - Non-2xx responses are parsed as the error envelope of design.md section 10
 *   (`{"error": {"code", "message", "fields", "request_id"}}`). Bodies that are not the
 *   envelope (proxy pages, plain text) still produce an `ApiError`.
 * - Failures never throw anything but `ApiError`, except a caller-initiated abort, which
 *   is rethrown as the original `AbortError` so TanStack Query can treat it as a cancel.
 */

export type ErrorField = components['schemas']['ErrorField']
export type ErrorEnvelope = components['schemas']['ErrorOut']

/** Request timeout in milliseconds (Req 28.6, DEFAULT (confirm)). */
export const API_TIMEOUT_MS = 30_000

/** `http`: the API answered with a non-2xx status. */
export type ApiErrorKind = 'http' | 'timeout' | 'network' | 'invalid_response'

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  /** HTTP status, or null when no response arrived. */
  readonly status: number | null
  /** Envelope code, or a client code: `timeout`, `network_error`, `invalid_response`, `http_error`. */
  readonly code: string
  readonly fields: readonly ErrorField[]
  readonly requestId: string | null

  constructor(init: {
    kind: ApiErrorKind
    message: string
    code: string
    status?: number | null
    fields?: readonly ErrorField[]
    requestId?: string | null
    cause?: unknown
  }) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause })
    this.name = 'ApiError'
    this.kind = init.kind
    this.code = init.code
    this.status = init.status ?? null
    this.fields = init.fields ?? []
    this.requestId = init.requestId ?? null
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST'
  /** JSON-serialisable body. Sent with `Content-Type: application/json`. */
  body?: unknown
  /** Caller signal, for example the one TanStack Query passes to a query function. */
  signal?: AbortSignal
  /** Override of the 30 s timeout. Meant for the Recent view (10 s) and for tests. */
  timeoutMs?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseFields(value: unknown): ErrorField[] {
  if (!Array.isArray(value)) return []
  const fields: ErrorField[] = []
  for (const item of value as unknown[]) {
    if (isRecord(item) && typeof item.field === 'string' && typeof item.reason === 'string') {
      fields.push({ field: item.field, reason: item.reason })
    }
  }
  return fields
}

/** Returns the parsed envelope, or null when `value` does not have the envelope shape. */
export function parseErrorEnvelope(value: unknown): ErrorEnvelope['error'] | null {
  if (!isRecord(value) || !isRecord(value.error)) return null
  const { code, message, fields, request_id: requestId } = value.error
  if (typeof code !== 'string' || typeof message !== 'string') return null
  return {
    code,
    message,
    fields: parseFields(fields),
    request_id: typeof requestId === 'string' ? requestId : null,
  }
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

async function buildHttpError(response: Response): Promise<ApiError> {
  let text = ''
  try {
    text = await response.text()
  } catch {
    // The body could not be read. The status line is still enough for a message.
  }
  const envelope = parseErrorEnvelope(tryParseJson(text))
  if (envelope) {
    return new ApiError({
      kind: 'http',
      status: response.status,
      code: envelope.code,
      message: envelope.message,
      fields: envelope.fields,
      requestId: envelope.request_id,
    })
  }
  return new ApiError({
    kind: 'http',
    status: response.status,
    code: 'http_error',
    message: `The request failed with status ${response.status}.`,
  })
}

/** Resolves `path` against the page origin so relative `/api/...` paths also work outside a browser. */
function resolveUrl(path: string): string {
  const base = (globalThis.location as Location | undefined)?.href
  return base ? new URL(path, base).toString() : path
}

/**
 * Sends one JSON request and returns the parsed JSON body.
 * @throws ApiError for HTTP errors, timeouts, network failures and non-JSON success bodies.
 * @throws DOMException `AbortError` when `options.signal` aborts the request.
 */
export async function apiFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, timeoutMs = API_TIMEOUT_MS } = options
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal

  const headers: Record<string, string> = { Accept: 'application/json' }
  const init: RequestInit = { method, headers, signal: combined }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }

  try {
    const response = await fetch(resolveUrl(path), init)
    if (!response.ok) throw await buildHttpError(response)
    const text = await response.text()
    const data = tryParseJson(text)
    if (data === undefined) {
      throw new ApiError({
        kind: 'invalid_response',
        status: response.status,
        code: 'invalid_response',
        message: 'The server answered with a response that is not valid JSON.',
      })
    }
    return data as T
  } catch (error) {
    if (error instanceof ApiError) throw error
    // A timeout and a caller abort both abort the request. Tell them apart by which signal fired.
    if (timeoutSignal.aborted && !signal?.aborted) {
      throw new ApiError({
        kind: 'timeout',
        code: 'timeout',
        message: `The request timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
        cause: error,
      })
    }
    if (signal?.aborted) throw error
    throw new ApiError({
      kind: 'network',
      code: 'network_error',
      message: 'The request failed. Check your connection and try again.',
      cause: error,
    })
  }
}

export function apiGet<T>(path: string, options: Omit<ApiRequestOptions, 'method' | 'body'> = {}) {
  return apiFetch<T>(path, { ...options, method: 'GET' })
}

export function apiPost<T>(
  path: string,
  body: unknown,
  options: Omit<ApiRequestOptions, 'method' | 'body'> = {},
) {
  return apiFetch<T>(path, { ...options, method: 'POST', body })
}

// Typed endpoints available so far (design.md section 10). Others are added with their features.
export type MetaOut = components['schemas']['MetaOut']
export type CalendarRequest = components['schemas']['CalendarRequest']
export type CalendarOut = components['schemas']['CalendarOut']
export type AnomalyOut = components['schemas']['AnomalyOut']
export type MonthOut = components['schemas']['MonthOut']
export type YearOut = components['schemas']['YearOut']
export type CoverageOut = components['schemas']['CoverageOut']
export type StatsOut = components['schemas']['StatsOut']
export type StatsSummary = components['schemas']['StatsSummary']
export type CurrentMonthOut = components['schemas']['CurrentMonthOut']
export type CurrentYearOut = components['schemas']['CurrentYearOut']
export type RankedMonthOut = components['schemas']['RankedMonthOut']
export type RankedYearOut = components['schemas']['RankedYearOut']
export type SeasonalPointOut = components['schemas']['SeasonalPointOut']
export type BaselineOut = components['schemas']['BaselineOut']
export type BaselineStatsOut = components['schemas']['BaselineStatsOut']
export type HealthOut = components['schemas']['HealthOut']
export type ApiGeometry = components['schemas']['Geometry']
export type ExampleArea = components['schemas']['ExampleArea']
export type NormalizeRequest = components['schemas']['NormalizeIn']
export type CircleRequest = components['schemas']['CircleIn']
export type NormalizeOut = components['schemas']['NormalizeOut']

/** `GET /api/health`. Answers HTTP 503 (an `ApiError`) when the delivered data are missing. */
export function getHealth(options?: Omit<ApiRequestOptions, 'method' | 'body'>) {
  return apiGet<HealthOut>('/api/health', options)
}

export function getMeta(options?: Omit<ApiRequestOptions, 'method' | 'body'>) {
  return apiGet<MetaOut>('/api/v1/meta', options)
}

export function postCalendar(
  request: CalendarRequest,
  options?: Omit<ApiRequestOptions, 'method' | 'body'>,
) {
  return apiPost<CalendarOut>('/api/v1/calendar', request, options)
}

/**
 * `POST /api/v1/stats`: key figures, rankings and the seasonal profile for the same body as
 * `/calendar`. Counts are cell-days (MODIS-equivalent); days, months and years use UTC-8.
 */
export function postStats(
  request: CalendarRequest,
  options?: Omit<ApiRequestOptions, 'method' | 'body'>,
) {
  return apiPost<StatsOut>('/api/v1/stats', request, options)
}

/**
 * `POST /api/v1/selection/normalize`: validates a drawn or entered area, clips it to the region
 * extent and counts the cells inside. Send exactly one of `geometry`, `bbox`, `circle` or `geojson`. HTTP 422 with
 * code `invalid_geometry` or `outside_coverage` (an `ApiError`) when the area is rejected.
 */
export function postNormalizeSelection(
  request: NormalizeRequest,
  options?: Omit<ApiRequestOptions, 'method' | 'body'>,
) {
  return apiPost<NormalizeOut>('/api/v1/selection/normalize', request, options)
}

/** Body of `POST /api/v1/export/hotspots`: area (null = full region) and exact local dates. */
export type HotspotExportRequest = Pick<CalendarRequest, 'geometry' | 'start' | 'end'>

/** An accepted hotspot CSV response: the body stream and the file name from the server. */
export type HotspotExportStream = {
  body: ReadableStream<Uint8Array>
  /** Safe file name from the `Content-Disposition` header, or `hotspots.csv` when it has none. */
  filename: string
}

/** Used when the server sends no usable `Content-Disposition` file name. */
export const FALLBACK_EXPORT_FILENAME = 'hotspots.csv'

const MAX_FILENAME_CHARS = 150

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** Reduces a header value to a plain file name: no path, no control or reserved characters. */
function cleanFilename(raw: string): string | null {
  const base = raw.split(/[\\/]/).pop() ?? ''
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is removed
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').replace(/^[.\s]+|[\s]+$/g, '')
  if (cleaned === '') return null
  return cleaned.slice(0, MAX_FILENAME_CHARS)
}

/**
 * File name of a `Content-Disposition` header (RFC 6266). Prefers `filename*` (RFC 5987,
 * percent-encoded UTF-8) over `filename`, and returns a sanitised name, or null when the
 * header holds none. A path in the value is cut to its last segment.
 */
export function filenameFromContentDisposition(header: string | null): string | null {
  if (header === null) return null
  const extended = /filename\*\s*=\s*(?:[A-Za-z0-9-]+)?'[^']*'([^;]+)/i.exec(header)
  if (extended?.[1] !== undefined) {
    const name = cleanFilename(safeDecode(extended[1].trim()))
    if (name !== null) return name
  }
  const quoted = /filename\s*=\s*"((?:[^"\\]|\\.)*)"/i.exec(header)
  if (quoted?.[1] !== undefined) return cleanFilename(quoted[1].replace(/\\(.)/g, '$1'))
  const token = /filename\s*=\s*([^;\s]+)/i.exec(header)
  return token?.[1] === undefined ? null : cleanFilename(token[1])
}

/**
 * `POST /api/v1/export/hotspots`. Resolves as soon as the response headers have arrived with a
 * 2xx status; the CSV is then read from `body` by the caller. There is no 30 s timeout: a file
 * of up to 2,000,000 rows takes longer than that to stream (Req 17.3). Only `options.signal`
 * ends the request early. A non-2xx answer (for example 422 `export_too_large`) is parsed as
 * the error envelope and thrown as an `ApiError`.
 * @throws ApiError for HTTP errors, network failures and a response without a body.
 * @throws DOMException `AbortError` when `options.signal` aborts the request.
 */
export async function postHotspotExport(
  request: HotspotExportRequest,
  options: { signal?: AbortSignal } = {},
): Promise<HotspotExportStream> {
  const { signal } = options
  try {
    const response = await fetch(resolveUrl('/api/v1/export/hotspots'), {
      method: 'POST',
      headers: { Accept: 'text/csv, application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    })
    if (!response.ok) throw await buildHttpError(response)
    if (response.body === null) {
      throw new ApiError({
        kind: 'invalid_response',
        status: response.status,
        code: 'invalid_response',
        message: 'The server answered without a file.',
      })
    }
    const filename =
      filenameFromContentDisposition(response.headers.get('Content-Disposition')) ??
      FALLBACK_EXPORT_FILENAME
    return { body: response.body, filename }
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (signal?.aborted) throw error
    throw new ApiError({
      kind: 'network',
      code: 'network_error',
      message: 'The request failed. Check your connection and try again.',
      cause: error,
    })
  }
}

/**
 * Size estimate of the hotspot CSV of a query (requirement 17.11): the data rows the export
 * would write and the approximate file size in bytes. `over_limit` is true above `limit` rows,
 * where the export itself answers 422 `export_too_large`.
 */
export type HotspotEstimateOut = components['schemas']['HotspotEstimateOut']

/**
 * `POST /api/v1/export/hotspots/estimate`: same body as the export, no CSV is generated.
 * Aborted after 30 s like every other request (requirement 17.13), as an `ApiError` of kind
 * `timeout`. HTTP 422 `invalid_geometry` or `outside_coverage` (an `ApiError`) for a bad area.
 */
export function postHotspotEstimate(
  request: HotspotExportRequest,
  options?: Omit<ApiRequestOptions, 'method' | 'body'>,
) {
  return apiPost<HotspotEstimateOut>('/api/v1/export/hotspots/estimate', request, options)
}

export type SeasonRequest = components['schemas']['SeasonRequest']
export type SeasonOut = components['schemas']['SeasonOut']
/**
 * `POST /api/v1/season`: cumulative season curves against the p10 to p90 envelope (monthly).
 * Counts are cell-days (MODIS-equivalent); months use UTC-8. The in-progress season stops at the
 * latest complete month.
 */
export function postSeason(
  request: SeasonRequest,
  options?: Omit<ApiRequestOptions, 'method' | 'body'>,
) {
  return apiPost<SeasonOut>('/api/v1/season', request, options)
}

/** `POST /api/v1/share` answer: an id of at most 16 characters and the end of its 30 days. */
export type ShareCreatedOut = { id: string; expires_at: string }
/** `GET /api/v1/share/{id}` answer: the stored area (EPSG:4326). */
export type ShareOut = { id: string; geometry: unknown }

/**
 * `POST /api/v1/share`: stores a Selection_Area so a long page address can use a short id.
 * HTTP 503 `share_unavailable` (an `ApiError`) when the server has no share store, 429
 * `rate_limited` when too many were requested.
 */
export function postShare(
  geometry: ApiGeometry,
  options?: Omit<ApiRequestOptions, 'method' | 'body'>,
) {
  return apiPost<ShareCreatedOut>('/api/v1/share', { geometry }, options)
}

/** `GET /api/v1/share/{id}`: HTTP 404 (an `ApiError`) for an unknown or expired id. */
export function getShare(id: string, options?: Omit<ApiRequestOptions, 'method' | 'body'>) {
  return apiGet<ShareOut>(`/api/v1/share/${encodeURIComponent(id)}`, options)
}

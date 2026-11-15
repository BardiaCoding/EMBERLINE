import { delay, http, HttpResponse } from 'msw'
import { server } from '../test/server'
import {
  API_TIMEOUT_MS,
  ApiError,
  apiFetch,
  getMeta,
  parseErrorEnvelope,
  postCalendar,
  postNormalizeSelection,
} from './api'
import type { CalendarOut } from './api'

const ORIGIN = window.location.origin

async function catchError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('Expected the promise to reject')
}

describe('apiFetch success', () => {
  it('returns the parsed JSON body of a GET', async () => {
    server.use(
      http.get(`${ORIGIN}/api/v1/meta`, () => HttpResponse.json({ name: 'California region' })),
    )
    await expect(apiFetch('/api/v1/meta')).resolves.toEqual({ name: 'California region' })
  })

  it('sends a JSON body with a JSON content type on POST and keeps null bounds', async () => {
    const calendar: CalendarOut = {
      months: [
        {
          year: 2020,
          month: 8,
          harmonized: 12.5,
          raw_modis: 0,
          raw_viirs: 9,
          frp_sum_mw: null,
          source_flag: 'calibrated',
          calib_model: 'quantile_map',
          provenance: 'N20+SNPP',
          provisional: false,
          lower_bound: null,
          upper_bound: null,
          anomaly: null,
        },
      ],
      years: [],
      baseline_by_month: [],
      baseline_year: null,
      coverage: {
        first_month: null,
        last_month: null,
        n_months: 0,
        requested_start: null,
        requested_end: null,
        starts_mid_month: false,
        ends_mid_month: false,
        before_record: false,
        after_latest: false,
      },
      n_cells: 3,
      notice: null,
      provisional_months: [],
      clipped_percent: null,
      area_km2: null,
    }
    let seenBody: unknown
    let seenType: string | null = null
    server.use(
      http.post(`${ORIGIN}/api/v1/calendar`, async ({ request }) => {
        seenBody = await request.json()
        seenType = request.headers.get('content-type')
        return HttpResponse.json(calendar)
      }),
    )
    const request = { geometry: null, start: '2020-01-01', end: '2020-12-31' }
    const result = await postCalendar(request)
    expect(seenBody).toEqual(request)
    expect(seenType).toContain('application/json')
    expect(result.months[0]?.lower_bound).toBeNull()
  })

  it('exposes typed endpoint helpers', async () => {
    server.use(http.get(`${ORIGIN}/api/v1/meta`, () => HttpResponse.json({ name: 'x' })))
    await expect(getMeta()).resolves.toMatchObject({ name: 'x' })
  })
})

describe('apiFetch error envelope', () => {
  it('parses code, message, fields and request id from a 422', async () => {
    server.use(
      http.post(`${ORIGIN}/api/v1/calendar`, () =>
        HttpResponse.json(
          {
            error: {
              code: 'invalid_geometry',
              message: 'Polygon self-intersects.',
              fields: [{ field: 'geometry', reason: 'self_intersection' }],
              request_id: 'req-1',
            },
          },
          { status: 422 },
        ),
      ),
    )
    const error = await catchError(postCalendar({ geometry: null, start: 'a', end: 'b' }))
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      kind: 'http',
      status: 422,
      code: 'invalid_geometry',
      message: 'Polygon self-intersects.',
      fields: [{ field: 'geometry', reason: 'self_intersection' }],
      requestId: 'req-1',
    })
  })

  it('accepts an envelope without fields or request id', async () => {
    server.use(
      http.get(`${ORIGIN}/api/v1/meta`, () =>
        HttpResponse.json({ error: { code: 'internal_error', message: 'Oops' } }, { status: 500 }),
      ),
    )
    const error = await catchError(getMeta())
    expect(error).toMatchObject({
      status: 500,
      code: 'internal_error',
      fields: [],
      requestId: null,
    })
  })

  it('turns a non-JSON error body into a generic ApiError with the status', async () => {
    server.use(
      http.get(
        `${ORIGIN}/api/v1/meta`,
        () =>
          new HttpResponse('<html>Bad Gateway</html>', {
            status: 502,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    )
    const error = await catchError(getMeta())
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      kind: 'http',
      status: 502,
      code: 'http_error',
      fields: [],
      requestId: null,
    })
    expect((error as ApiError).message).toContain('502')
    expect((error as ApiError).message).not.toContain('<html>')
  })

  it('treats JSON that is not the envelope as a generic error', async () => {
    server.use(
      http.get(`${ORIGIN}/api/v1/meta`, () =>
        HttpResponse.json({ detail: 'nope' }, { status: 404 }),
      ),
    )
    await expect(getMeta()).rejects.toMatchObject({ status: 404, code: 'http_error' })
  })

  it('rejects a 200 response whose body is not JSON', async () => {
    server.use(
      http.get(`${ORIGIN}/api/v1/meta`, () => new HttpResponse('not json', { status: 200 })),
    )
    await expect(getMeta()).rejects.toMatchObject({
      kind: 'invalid_response',
      code: 'invalid_response',
    })
  })

  it('maps a network failure to a network ApiError', async () => {
    server.use(http.get(`${ORIGIN}/api/v1/meta`, () => HttpResponse.error()))
    await expect(getMeta()).rejects.toMatchObject({
      kind: 'network',
      code: 'network_error',
      status: null,
    })
  })
})

describe('parseErrorEnvelope', () => {
  it('returns null for values that are not envelopes', () => {
    expect(parseErrorEnvelope(null)).toBeNull()
    expect(parseErrorEnvelope([])).toBeNull()
    expect(parseErrorEnvelope({ error: 'x' })).toBeNull()
    expect(parseErrorEnvelope({ error: { code: 1, message: 'x' } })).toBeNull()
  })

  it('drops malformed field entries', () => {
    const parsed = parseErrorEnvelope({
      error: { code: 'c', message: 'm', fields: [{ field: 'a', reason: 'b' }, { field: 1 }, 'x'] },
    })
    expect(parsed?.fields).toEqual([{ field: 'a', reason: 'b' }])
  })
})

describe('apiFetch timeout and abort', () => {
  it('uses AbortSignal.timeout(30_000) by default', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout')
    server.use(http.get(`${ORIGIN}/api/v1/meta`, () => HttpResponse.json({})))
    await apiFetch('/api/v1/meta')
    expect(API_TIMEOUT_MS).toBe(30_000)
    expect(spy).toHaveBeenCalledWith(30_000)
    spy.mockRestore()
  })

  it('rejects with a timeout ApiError when the server does not answer in time', async () => {
    server.use(
      http.get(`${ORIGIN}/api/v1/slow`, async () => {
        await delay('infinite')
        return HttpResponse.json({})
      }),
    )
    const error = await catchError(apiFetch('/api/v1/slow', { timeoutMs: 50 }))
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ kind: 'timeout', code: 'timeout', status: null })
  })

  it('rethrows a caller abort as an AbortError, not as a timeout', async () => {
    server.use(
      http.get(`${ORIGIN}/api/v1/slow`, async () => {
        await delay('infinite')
        return HttpResponse.json({})
      }),
    )
    const controller = new AbortController()
    const pending = catchError(apiFetch('/api/v1/slow', { signal: controller.signal }))
    setTimeout(() => {
      controller.abort()
    }, 20)
    const error = await pending
    expect(error).not.toBeInstanceOf(ApiError)
    expect((error as Error).name).toBe('AbortError')
  })
})

describe('postNormalizeSelection', () => {
  it('posts exactly the given body to /selection/normalize and returns the clipped area', async () => {
    const bodies: unknown[] = []
    const out = {
      geometry: { type: 'Polygon', coordinates: [] },
      clipped: true,
      clipped_percent: 12.5,
      n_cells: 3,
      notice: null,
    }
    server.use(
      http.post(`${ORIGIN}/api/v1/selection/normalize`, async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json(out)
      }),
    )
    const bbox = { west: -121, south: 36, east: -119, north: 38 }
    await expect(postNormalizeSelection({ bbox })).resolves.toEqual(out)
    expect(bodies).toEqual([{ bbox }])
  })

  it('throws an ApiError with the field reasons for a 422', async () => {
    server.use(
      http.post(`${ORIGIN}/api/v1/selection/normalize`, () =>
        HttpResponse.json(
          {
            error: {
              code: 'outside_coverage',
              message: 'Outside.',
              fields: [{ field: 'geometry', reason: 'outside_extent' }],
            },
          },
          { status: 422 },
        ),
      ),
    )
    const error = await catchError(
      postNormalizeSelection({ geometry: { type: 'Polygon', coordinates: [] } }),
    )
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      status: 422,
      code: 'outside_coverage',
      fields: [{ field: 'geometry', reason: 'outside_extent' }],
    })
  })
})

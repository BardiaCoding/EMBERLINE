import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '@/test/server'
import { postStats } from './api'
import { statsResult } from './stats.fixtures'

// Synthetic values. TEST FIXTURE, not NASA data.
const ORIGIN = window.location.origin

describe('postStats', () => {
  it('posts the Calendar request body to /api/v1/stats and returns the parsed result', async () => {
    let seen: unknown = null
    server.use(
      http.post(`${ORIGIN}/api/v1/stats`, async ({ request }) => {
        seen = await request.json()
        return HttpResponse.json(statsResult({ n_cells: 7 }))
      }),
    )
    const out = await postStats({ geometry: null, start: '2002-01-01', end: '2002-12-31' })
    expect(seen).toEqual({ geometry: null, start: '2002-01-01', end: '2002-12-31' })
    expect(out.n_cells).toBe(7)
    expect(out.top_months).toEqual([])
  })

  it('throws an ApiError with the envelope code for a 422', async () => {
    server.use(
      http.post(`${ORIGIN}/api/v1/stats`, () =>
        HttpResponse.json(
          { error: { code: 'outside_coverage', message: 'Outside.', request_id: 'r1' } },
          { status: 422 },
        ),
      ),
    )
    await expect(
      postStats({ geometry: null, start: '2002-01-01', end: '2002-12-31' }),
    ).rejects.toMatchObject({ kind: 'http', status: 422, code: 'outside_coverage' })
  })
})

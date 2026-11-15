import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '@/test/server'
import { resolveSharedArea } from './sharedArea'

const AREA = {
  type: 'Polygon',
  coordinates: [
    [
      [-120, 37],
      [-119, 37],
      [-119, 38],
      [-120, 37],
    ],
  ],
}

describe('resolveSharedArea', () => {
  it('returns the stored geometry', async () => {
    server.use(
      http.get('*/api/v1/share/abc', () => HttpResponse.json({ id: 'abc', geometry: AREA })),
    )
    const out = await resolveSharedArea('abc')
    expect(out).toEqual({ ok: true, geometry: AREA })
  })

  it('names the parameter and the reason for an unknown or expired id', async () => {
    server.use(
      http.get('*/api/v1/share/gone', () =>
        HttpResponse.json(
          { error: { code: 'not_found', message: 'x', fields: [], request_id: 'r' } },
          { status: 404 },
        ),
      ),
    )
    const out = await resolveSharedArea('gone')
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.notice).toMatch(/\(s\).*unknown or has expired/)
  })

  it('reports a server failure and a stored area that is not valid', async () => {
    server.use(
      http.get('*/api/v1/share/down', () => HttpResponse.error()),
      http.get('*/api/v1/share/bad', () =>
        HttpResponse.json({ id: 'bad', geometry: { type: 'Point' } }),
      ),
    )
    const down = await resolveSharedArea('down')
    const bad = await resolveSharedArea('bad')
    expect(!down.ok && down.notice).toMatch(/did not answer/)
    expect(!bad.ok && bad.notice).toMatch(/not valid/)
  })
})

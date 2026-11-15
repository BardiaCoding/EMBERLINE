import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { AreaGeometry } from './areaGeometry'
import {
  buildShareLink,
  maxDisplacementMetres,
  SHARE_URL_LIMIT,
  shareMessage,
  simplifyGeometry,
} from './shareLink'
import { decodeState, type AppState } from './urlState'

// Synthetic shapes (TEST FIXTURE, not NASA data). A wavy circle with many vertices.
function wavyRing(n: number): [number, number][] {
  const ring: [number, number][] = []
  for (let i = 0; i < n; i += 1) {
    const angle = (2 * Math.PI * i) / n
    const r = 1 + 0.002 * Math.sin(40 * angle)
    ring.push([-120 + r * Math.cos(angle), 37 + r * Math.sin(angle)])
  }
  ring.push([...(ring[0] ?? [0, 0])] as [number, number])
  return ring
}
const BIG: AreaGeometry = { type: 'Polygon', coordinates: [wavyRing(900)] }
const SMALL: AreaGeometry = {
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

function stateOf(geometry: AreaGeometry): AppState {
  return {
    area: { kind: 'geom', geometry },
    start: '2020-01-01',
    end: '2020-12-31',
    view: 'counts',
    compare: { mode: 'none' },
  }
}
const BASE = 'https://example.test/app'

describe('simplifyGeometry and maxDisplacementMetres', () => {
  it('keeps closed rings and reports no displacement for tolerance 0', () => {
    const same = simplifyGeometry(BIG, 0)
    expect(maxDisplacementMetres(BIG, same)).toBeCloseTo(0, 3)
    const ring = simplifyGeometry(BIG, 500).coordinates[0] as [number, number][]
    expect(ring[0]).toEqual(ring[ring.length - 1])
    expect(ring.length).toBeGreaterThanOrEqual(4)
    expect(ring.length).toBeLessThan(901)
  })

  it('bounds the displacement by the tolerance (property)', () => {
    fc.assert(
      fc.property(fc.double({ min: 1, max: 5000, noNaN: true }), (tolerance) => {
        const simplified = simplifyGeometry(BIG, tolerance)
        // Small slack: the plane used for the check is the same, so the bound is tight.
        expect(maxDisplacementMetres(BIG, simplified)).toBeLessThanOrEqual(tolerance + 1e-6)
      }),
      { numRuns: 30 },
    )
  })
})

describe('buildShareLink', () => {
  const never = () => Promise.reject(new Error('not expected'))

  it('puts the whole state in a short link', async () => {
    const out = await buildShareLink({
      baseUrl: BASE,
      search: '',
      state: stateOf(SMALL),
      storeArea: never,
    })
    expect(out.kind).toBe('full')
    expect(out.url.length).toBeLessThanOrEqual(SHARE_URL_LIMIT)
  })

  it('stores a long area and uses s= with an id of at most 16 characters', async () => {
    const out = await buildShareLink({
      baseUrl: BASE,
      search: '',
      state: stateOf(BIG),
      storeArea: () => Promise.resolve('AbC_-123'),
    })
    expect(out.kind).toBe('stored')
    expect(out.url.length).toBeLessThanOrEqual(SHARE_URL_LIMIT)
    const decoded = decodeState(out.url.slice(out.url.indexOf('?')), {
      fallback: { start: '2000-11-01', end: '2000-11-30' },
    })
    expect(decoded.rejected).toEqual([])
    expect(decoded.state.area).toEqual({ kind: 'share', id: 'AbC_-123' })
    expect(decoded.state.start).toBe('2020-01-01')
  })

  it('simplifies when the store is unavailable and reports the displacement', async () => {
    const out = await buildShareLink({
      baseUrl: BASE,
      search: '',
      state: stateOf(BIG),
      storeArea: never,
    })
    expect(out.kind).toBe('simplified')
    if (out.kind !== 'simplified') return
    expect(out.url.length).toBeLessThanOrEqual(SHARE_URL_LIMIT)
    expect(out.maxDisplacementM).toBeGreaterThan(0)
    expect(shareMessage(out)).toMatch(/largest vertex displacement is [\d,]+ m/)
  })

  it('keeps parameters the app does not manage', async () => {
    const out = await buildShareLink({
      baseUrl: BASE,
      search: '?utm=1',
      state: stateOf(SMALL),
      storeArea: never,
    })
    expect(out.url).toContain('utm=1')
  })
})

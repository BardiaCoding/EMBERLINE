import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { RecentPoint } from './recentApi'
import { barShare, isEmptyWindow, isStale, projectPoints } from './recentModel'

const point = (lat: number, lon: number): RecentPoint => ({
  lat,
  lon,
  satellite: 'SNPP',
  source: null,
  local_date: '2026-11-10',
  acq_datetime_utc: '2026-11-10T20:00:00Z',
  frp: null,
})

describe('recentModel', () => {
  it('isStale is true only above the threshold', () => {
    expect(isStale(3)).toBe(false)
    expect(isStale(4)).toBe(true)
  })

  it('isEmptyWindow needs all zero days', () => {
    expect(isEmptyWindow({ days: [{ date: 'a', count: 0 }] })).toBe(true)
    expect(
      isEmptyWindow({
        days: [
          { date: 'a', count: 0 },
          { date: 'b', count: 1 },
        ],
      }),
    ).toBe(false)
  })

  it('barShare is 0 when all counts are 0', () => {
    expect(barShare(0, 0)).toBe(0)
    expect(barShare(2, 4)).toBe(0.5)
  })

  it('projected points stay inside the box', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.double({ min: 32.5, max: 42, noNaN: true }),
            fc.double({ min: -124, max: -114, noNaN: true }),
          ),
          {
            minLength: 1,
            maxLength: 30,
          },
        ),
        (coords) => {
          for (const p of projectPoints(
            coords.map(([la, lo]) => point(la, lo)),
            360,
            240,
          )) {
            expect(p.x).toBeGreaterThanOrEqual(-1e-6)
            expect(p.x).toBeLessThanOrEqual(360 + 1e-6)
            expect(p.y).toBeGreaterThanOrEqual(-1e-6)
            expect(p.y).toBeLessThanOrEqual(240 + 1e-6)
          }
        },
      ),
    )
  })
})

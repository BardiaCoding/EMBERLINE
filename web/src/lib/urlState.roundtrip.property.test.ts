// Feature: harmonized-fire-calendar, Property 42: URL state round trip
// Validates: Requirements 14.5, 19.1, 19.2, 19.3
// Synthetic states only. TEST FIXTURE, not NASA data.
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { AreaGeometry } from './areaGeometry'
import { decodeState, encodeState, type AppState, type UrlArea } from './urlState'
import { appState, urlGeometry } from '@/test/arbitraries'

const OPTIONS = { fallback: { start: '2000-11-01', end: '2000-11-30' } }
const TOLERANCE = 0.000001

function positions(g: AreaGeometry): [number, number][] {
  const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
  return polygons.flatMap((rings) => rings.flat())
}

/** Same shape (type, polygon, ring and vertex counts and order), coordinates within 1e-6. */
function expectSameGeometry(actual: AreaGeometry, expected: AreaGeometry): void {
  expect(actual.type).toBe(expected.type)
  const shape = (g: AreaGeometry): number[][][] =>
    (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map((p) => p.map((r) => [r.length]))
  expect(shape(actual)).toEqual(shape(expected))
  const a = positions(actual)
  const e = positions(expected)
  expect(a.length).toBe(e.length)
  a.forEach(([lon, lat], i) => {
    expect(Math.abs(lon - (e[i]?.[0] ?? NaN))).toBeLessThanOrEqual(TOLERANCE)
    expect(Math.abs(lat - (e[i]?.[1] ?? NaN))).toBeLessThanOrEqual(TOLERANCE)
  })
}

function expectSameArea(actual: UrlArea, expected: UrlArea): void {
  expect(actual.kind).toBe(expected.kind)
  if (expected.kind === 'share' && actual.kind === 'share') expect(actual.id).toBe(expected.id)
  if (expected.kind === 'geom' && actual.kind === 'geom') {
    expectSameGeometry(actual.geometry, expected.geometry)
  }
}

describe('Property 42: URL state round trip', () => {
  it('decodeState(encodeState(s)) returns the same state, with coordinates within 1e-6', () => {
    fc.assert(
      fc.property(appState(), (state: AppState) => {
        const { state: back, rejected } = decodeState(`?${encodeState(state)}`, OPTIONS)
        expect(rejected).toEqual([])
        expect(back.start).toBe(state.start)
        expect(back.end).toBe(state.end)
        expect(back.baseline).toEqual(state.baseline)
        expect(back.view).toBe(state.view)
        expect(back.year).toBe(state.year)
        expect(back.seasonStart).toBe(state.seasonStart)
        expect(back.tab).toBe(state.tab)
        expect(back.cell).toBe(state.cell)
        expectSameArea(back.area, state.area)
        expect(back.compare.mode).toBe(state.compare.mode)
        if (state.compare.mode === 'area' && back.compare.mode === 'area') {
          expect(back.compare.perArea).toBe(state.compare.perArea)
          expectSameArea(back.compare.area2, state.compare.area2)
        }
        if (state.compare.mode === 'period' && back.compare.mode === 'period') {
          expect(back.compare.start2).toBe(state.compare.start2)
          expect(back.compare.end2).toBe(state.compare.end2)
        }
      }),
    )
  })

  it('keeps vertex count and order for geometries of up to 1000 vertices', () => {
    fc.assert(
      fc.property(urlGeometry(), (geometry) => {
        const state: AppState = {
          area: { kind: 'geom', geometry },
          start: '2020-01-01',
          end: '2020-12-31',
          view: 'counts',
          compare: { mode: 'none' },
        }
        const { state: back, rejected } = decodeState(encodeState(state), OPTIONS)
        expect(rejected).toEqual([])
        expect(back.area.kind).toBe('geom')
        if (back.area.kind === 'geom') expectSameGeometry(back.area.geometry, geometry)
      }),
    )
  })
})

import fc from 'fast-check'
import { availableRecord } from './dates'
import { isoDate } from '@/test/arbitraries'
import {
  decodeGeometry,
  decodeState,
  encodeGeometry,
  encodeState,
  readRangeParams,
  rejectedNotice,
  resolveUrlRange,
  serializeRangeParams,
  serializeState,
  type AppState,
} from './urlState'
import type { AreaGeometry } from './areaGeometry'

// Synthetic record bounds for the tests. TEST FIXTURE, not NASA data.
const record = availableRecord('2000-11-01', '2026-11')
const fallback = { start: '2016-01-01', end: '2026-11-30' }

describe('resolveUrlRange', () => {
  it('uses the fallback without a notice when the URL has no range', () => {
    expect(resolveUrlRange('', record, fallback)).toEqual({
      range: fallback,
      fromUrl: false,
      notice: null,
    })
    expect(resolveUrlRange('?x=1', record, fallback).notice).toBeNull()
  })

  it('uses a valid range from the URL', () => {
    expect(resolveUrlRange('?from=2020-03-01&to=2021-06-30', record, fallback)).toEqual({
      range: { start: '2020-03-01', end: '2021-06-30' },
      fromUrl: true,
      notice: null,
    })
  })

  it.each([
    ['one parameter only', '?from=2020-03-01'],
    ['not a real date', '?from=2020-02-30&to=2021-01-01'],
    ['not a date at all', '?from=abc&to=def'],
    ['start after end', '?from=2021-01-01&to=2020-01-01'],
    ['before the record', '?from=1999-01-01&to=2020-01-01'],
    ['after the record', '?from=2020-01-01&to=2027-01-01'],
    ['empty values', '?from=&to='],
  ])('falls back with a notice for %s', (_name, search) => {
    const resolved = resolveUrlRange(search, record, fallback)
    expect(resolved.range).toEqual(fallback)
    expect(resolved.fromUrl).toBe(false)
    expect(resolved.notice).toContain('default range')
    expect(resolved.notice).toContain('2016-01-01 to 2026-11-30')
    expect(resolved.notice).toContain('local standard time, UTC-8')
  })
})

describe('serializeRangeParams', () => {
  it('writes from and to and keeps other parameters', () => {
    const search = serializeRangeParams('?tab=calendar&from=1999-01-01', {
      start: '2020-01-01',
      end: '2020-12-31',
    })
    const params = new URLSearchParams(search)
    expect(search.startsWith('?')).toBe(true)
    expect(params.get('from')).toBe('2020-01-01')
    expect(params.get('to')).toBe('2020-12-31')
    expect(params.get('tab')).toBe('calendar')
    expect(readRangeParams(search)).toEqual({ from: '2020-01-01', to: '2020-12-31' })
  })
})

describe('URL round trip', () => {
  it('reads back every valid range it wrote', () => {
    // **Validates: Requirements 14.5**
    const inRecord = isoDate().filter((d) => d >= record.first && d <= record.last)
    fc.assert(
      fc.property(inRecord, inRecord, (a, b) => {
        const range = a <= b ? { start: a, end: b } : { start: b, end: a }
        const resolved = resolveUrlRange(serializeRangeParams('', range), record, fallback)
        expect(resolved.range).toEqual(range)
        expect(resolved.fromUrl).toBe(true)
        expect(resolved.notice).toBeNull()
      }),
    )
  })
})

// Synthetic shapes. TEST FIXTURE, not NASA data.
const SQUARE: AreaGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [-121.123456, 36.5],
      [-119, 36.5],
      [-119, 38.000001],
      [-121.123456, 38.000001],
      [-121.123456, 36.5],
    ],
  ],
}
const MULTI: AreaGeometry = {
  type: 'MultiPolygon',
  coordinates: [
    SQUARE.coordinates,
    [
      [
        [-118, 34],
        [-117, 34],
        [-117, 35],
        [-118, 34],
      ],
    ],
  ],
}

describe('geometry code', () => {
  it('round-trips a Polygon and a MultiPolygon', () => {
    for (const g of [SQUARE, MULTI]) {
      const out = decodeGeometry(encodeGeometry(g))
      expect(out).toEqual({ ok: true, geometry: g })
    }
  })
  it('uses only URL-safe characters', () => {
    expect(encodeGeometry(MULTI)).toMatch(/^[A-Za-z0-9_-]+$/)
  })
  it.each([
    ['empty', ''],
    ['not base64url', 'a b!'],
    ['truncated', encodeGeometry(SQUARE).slice(0, 10)],
    ['trailing bytes', `${encodeGeometry(SQUARE)}AAAA`],
    ['unknown type', 'Cg'],
  ])('rejects %s', (_n, code) => {
    expect(decodeGeometry(code).ok).toBe(false)
  })
})

describe('encodeState and decodeState', () => {
  const state: AppState = {
    area: { kind: 'geom', geometry: SQUARE },
    start: '2005-01-01',
    end: '2010-12-31',
    baseline: [2001, 2020],
    view: 'anomaly',
    compare: { mode: 'period', start2: '2001-01-01', end2: '2002-12-31' },
    year: 2008,
    seasonStart: 7,
    tab: 'trends',
    cell: '2008-07',
  }
  const options = { fallback: { start: '2016-01-01', end: '2026-11-30' } }

  it('round-trips every parameter', () => {
    const out = decodeState(encodeState(state), options)
    expect(out.rejected).toEqual([])
    expect(out.state).toEqual(state)
  })
  it('round-trips an area comparison with per-area charts', () => {
    const s: AppState = {
      ...state,
      compare: { mode: 'area', area2: { kind: 'geom', geometry: MULTI }, perArea: true },
    }
    expect(decodeState(encodeState(s), options).state).toEqual(s)
    const share: AppState = {
      ...state,
      area: { kind: 'share', id: 'abc123' },
      compare: { mode: 'area', area2: { kind: 'share', id: 'xyz' }, perArea: false },
    }
    expect(decodeState(encodeState(share), options).state).toEqual(share)
  })
  it('leaves out defaults', () => {
    const q = encodeState({
      area: { kind: 'region' },
      start: '2005-01-01',
      end: '2010-12-31',
      view: 'counts',
      compare: { mode: 'none' },
    })
    expect(q).toBe('from=2005-01-01&to=2010-12-31')
  })
  it('uses the fallback range and defaults for an empty address', () => {
    expect(decodeState('', options)).toEqual({
      state: {
        area: { kind: 'region' },
        ...options.fallback,
        view: 'counts',
        compare: { mode: 'none' },
      },
      rejected: [],
    })
  })
  it('falls back per parameter and lists what it rejected', () => {
    const out = decodeState(
      '?v=sideways&bl=2020-2001&y=abc&ss=13&tab=nope&cell=%3Cb%3E&a=!!&from=2005-01-01&to=2006-01-01',
      { ...options, tabs: ['calendar', 'trends'] },
    )
    expect(out.rejected.map((r) => r.param).sort()).toEqual(
      ['a', 'bl', 'cell', 'ss', 'tab', 'v', 'y'].sort(),
    )
    expect(out.state).toEqual({
      area: { kind: 'region' },
      start: '2005-01-01',
      end: '2006-01-01',
      view: 'counts',
      compare: { mode: 'none' },
    })
  })
  it('rejects a date pair as a whole and a period comparison without dates', () => {
    const out = decodeState('?from=2005-01-01&cmp=period&from2=2001-01-01', options)
    expect(out.state.start).toBe('2016-01-01')
    expect(out.rejected.map((r) => r.param).sort()).toEqual(['cmp', 'from', 'from2', 'to'])
    expect(out.state.compare).toEqual({ mode: 'none' })
  })
  it('checks the record when given', () => {
    const out = decodeState('?from=1990-01-01&to=2005-01-01', { ...options, record })
    expect(out.rejected.map((r) => r.param)).toEqual(['from', 'to'])
  })
  it('prefers a over s', () => {
    const out = decodeState(`?a=${encodeGeometry(SQUARE)}&s=abc`, options)
    expect(out.state.area.kind).toBe('geom')
    expect(out.rejected.map((r) => r.param)).toEqual(['s'])
  })
})

describe('serializeState and rejectedNotice', () => {
  it('replaces managed parameters and keeps the others', () => {
    const q = serializeState('?keep=1&v=diff&tab=old&a=zzz', {
      area: { kind: 'region' },
      start: '2005-01-01',
      end: '2006-01-01',
      view: 'counts',
      compare: { mode: 'none' },
    })
    const p = new URLSearchParams(q)
    expect(p.get('keep')).toBe('1')
    expect(p.get('from')).toBe('2005-01-01')
    expect(p.has('v')).toBe(false)
    expect(p.has('tab')).toBe(false)
    expect(p.has('a')).toBe(false)
  })
  it('names rejected parameters and the default range', () => {
    const fb = { start: '2016-01-01', end: '2026-11-30' }
    expect(rejectedNotice([], fb)).toBeNull()
    const n = rejectedNotice(
      [
        { param: 'from', reason: 'x' },
        { param: 'v', reason: 'y' },
      ],
      fb,
    )
    expect(n).toContain('default range')
    expect(n).toContain('2016-01-01 to 2026-11-30')
    expect(n).toContain('v')
  })
})

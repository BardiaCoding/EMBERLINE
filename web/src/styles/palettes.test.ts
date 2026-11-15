import fc from 'fast-check'
import {
  BLUE_ORANGE_DIVERGING,
  BLUE_ORANGE_NEUTRAL_INDEX,
  CIVIDIS_STOPS,
  cividisClasses,
} from './palettes'

const HEX = /^#[0-9a-f]{6}$/

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16)
  const lin = (c: number): number => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
}

describe('palettes', () => {
  it('cividis has 10 valid stops that get lighter', () => {
    expect(CIVIDIS_STOPS).toHaveLength(10)
    const lum = CIVIDIS_STOPS.map(luminance)
    for (let i = 1; i < lum.length; i++) expect(lum[i]!).toBeGreaterThan(lum[i - 1]!)
    for (const c of CIVIDIS_STOPS) expect(c).toMatch(HEX)
  })

  it('cividisClasses returns n valid colours, darkest first, ending on the stops', () => {
    expect(cividisClasses(0)).toEqual([])
    expect(cividisClasses(2)).toEqual([CIVIDIS_STOPS[0], CIVIDIS_STOPS[9]])
    expect(cividisClasses(10)).toEqual([...CIVIDIS_STOPS])
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 40 }), (n) => {
        const out = cividisClasses(n)
        expect(out).toHaveLength(n)
        for (const c of out) expect(c).toMatch(HEX)
        const lum = out.map(luminance)
        for (let i = 1; i < lum.length; i++) expect(lum[i]!).toBeGreaterThanOrEqual(lum[i - 1]!)
      }),
    )
  })

  it('cividisClasses rejects a negative or fractional count', () => {
    expect(() => cividisClasses(-1)).toThrow(RangeError)
    expect(() => cividisClasses(2.5)).toThrow(RangeError)
  })

  it('blue-orange has 9 classes, a lightest neutral in the middle, darker toward both ends', () => {
    expect(BLUE_ORANGE_DIVERGING).toHaveLength(9)
    expect(BLUE_ORANGE_NEUTRAL_INDEX).toBe(4)
    const lum = BLUE_ORANGE_DIVERGING.map(luminance)
    const mid = BLUE_ORANGE_NEUTRAL_INDEX
    expect(Math.max(...lum)).toBe(lum[mid])
    for (let i = 1; i <= mid; i++) expect(lum[i]!).toBeGreaterThan(lum[i - 1]!)
    for (let i = mid + 1; i < lum.length; i++) expect(lum[i]!).toBeLessThan(lum[i - 1]!)
    for (const c of BLUE_ORANGE_DIVERGING) expect(c).toMatch(HEX)
  })

  it('blue-orange runs blue below and orange above the neutral class', () => {
    const channels = (hex: string): [number, number] => {
      const n = Number.parseInt(hex.slice(1), 16)
      return [(n >> 16) & 255, n & 255]
    }
    for (const c of BLUE_ORANGE_DIVERGING.slice(0, BLUE_ORANGE_NEUTRAL_INDEX)) {
      const [r, b] = channels(c)
      expect(b).toBeGreaterThan(r)
    }
    for (const c of BLUE_ORANGE_DIVERGING.slice(BLUE_ORANGE_NEUTRAL_INDEX + 1)) {
      const [r, b] = channels(c)
      expect(r).toBeGreaterThan(b)
    }
  })
})

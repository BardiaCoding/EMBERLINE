import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { validateCircleText, serverCircleErrors } from './circleInput'

const text = (lat: string, lon: string, radius_km: string) => ({ lat, lon, radius_km })

describe('validateCircleText', () => {
  it('accepts a circle inside the ranges', () => {
    expect(validateCircleText(text('36.5', '-120.5', '25'))).toEqual({
      ok: true,
      circle: { lat: 36.5, lon: -120.5, radius_km: 25 },
    })
  })

  it('accepts the radius limits 1 and 500 and rejects values just outside', () => {
    expect(validateCircleText(text('0', '0', '1')).ok).toBe(true)
    expect(validateCircleText(text('0', '0', '500')).ok).toBe(true)
    for (const radius of ['0.99', '500.01', '0', '-5']) {
      const result = validateCircleText(text('0', '0', radius))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.errors.radius_km).toBe('Radius must be between 1 and 500 km.')
    }
  })

  it('reports each bad field on its own', () => {
    const result = validateCircleText(text('95', 'abc', ''))
    expect(result).toEqual({
      ok: false,
      errors: {
        lat: 'Latitude must be between -90 and 90.',
        lon: 'Enter a number, for example 36.5.',
        radius_km: 'Enter a number, for example 36.5.',
      },
    })
  })

  it('accepts exactly the numbers inside the ranges (property)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -200, max: 200, noNaN: true }),
        fc.double({ min: -400, max: 400, noNaN: true }),
        fc.double({ min: -50, max: 700, noNaN: true }),
        (lat, lon, radius) => {
          const fixed = (v: number) => v.toFixed(4)
          const [a, o, r] = [Number(fixed(lat)), Number(fixed(lon)), Number(fixed(radius))]
          const expected = Math.abs(a) <= 90 && Math.abs(o) <= 180 && r >= 1 && r <= 500
          expect(validateCircleText(text(fixed(lat), fixed(lon), fixed(radius))).ok).toBe(expected)
        },
      ),
    )
  })
})

describe('serverCircleErrors', () => {
  it('maps circle.* fields to inputs and ignores the rest', () => {
    const errors = serverCircleErrors(
      [
        { field: 'circle.radius_km', reason: 'radius_out_of_range' },
        { field: 'circle', reason: 'outside_extent' },
      ],
      (reason) => `msg ${reason}`,
    )
    expect(errors).toEqual({ radius_km: 'msg radius_out_of_range' })
  })
})

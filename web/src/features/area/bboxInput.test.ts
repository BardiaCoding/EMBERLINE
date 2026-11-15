import fc from 'fast-check'
import {
  NOT_A_NUMBER,
  SOUTH_BEFORE_NORTH,
  WEST_BEFORE_EAST,
  serverBboxErrors,
  validateBboxText,
  type BboxText,
} from './bboxInput'

const text = (west: string, south: string, east: string, north: string): BboxText => ({
  west,
  south,
  east,
  north,
})

describe('validateBboxText', () => {
  it('accepts an ordered rectangle and trims spaces', () => {
    expect(validateBboxText(text(' -121.5 ', '36', '-119', '38.25'))).toEqual({
      ok: true,
      bbox: { west: -121.5, south: 36, east: -119, north: 38.25 },
    })
  })

  it('marks empty and non-numeric fields', () => {
    const result = validateBboxText(text('', 'abc', '1e3', '38'))
    expect(result).toEqual({
      ok: false,
      errors: { west: NOT_A_NUMBER, south: NOT_A_NUMBER, east: NOT_A_NUMBER },
    })
  })

  it('states the allowed range of each field outside it', () => {
    const result = validateBboxText(text('-181', '-91', '181', '91'))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.west).toMatch(/-180 and 180/)
    expect(result.errors.east).toMatch(/-180 and 180/)
    expect(result.errors.south).toMatch(/-90 and 90/)
    expect(result.errors.north).toMatch(/-90 and 90/)
  })

  it('marks both fields of a pair that is not ordered, west equal to east included', () => {
    const result = validateBboxText(text('-119', '38', '-119', '36'))
    expect(result).toEqual({
      ok: false,
      errors: {
        west: WEST_BEFORE_EAST,
        east: WEST_BEFORE_EAST,
        south: SOUTH_BEFORE_NORTH,
        north: SOUTH_BEFORE_NORTH,
      },
    })
  })

  it('accepts a rectangle iff every value is in range and each pair is ordered', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -200, max: 200, noNaN: true }),
        fc.double({ min: -100, max: 100, noNaN: true }),
        fc.double({ min: -200, max: 200, noNaN: true }),
        fc.double({ min: -100, max: 100, noNaN: true }),
        (west, south, east, north) => {
          const inputs = [west, south, east, north].map((v) => v.toFixed(5))
          const [w, s, e, n] = inputs.map(Number) as [number, number, number, number]
          const expected =
            Math.abs(w) <= 180 &&
            Math.abs(e) <= 180 &&
            Math.abs(s) <= 90 &&
            Math.abs(n) <= 90 &&
            w < e &&
            s < n
          const result = validateBboxText(text(inputs[0]!, inputs[1]!, inputs[2]!, inputs[3]!))
          expect(result.ok).toBe(expected)
        },
      ),
    )
  })
})

describe('serverBboxErrors', () => {
  it('maps bbox field errors to inputs and ignores other fields', () => {
    const errors = serverBboxErrors(
      [
        { field: 'bbox.west', reason: 'west_not_less_than_east' },
        { field: 'bbox', reason: 'outside_extent' },
        { field: 'geometry', reason: 'zero_area' },
      ],
      (reason) => `message for ${reason}`,
    )
    expect(errors).toEqual({ west: 'message for west_not_less_than_east' })
  })
})

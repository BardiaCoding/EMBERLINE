import { describe, expect, it } from 'vitest'
import { MAX_GEOJSON_BYTES, readGeoJsonFile } from './geojsonFile'

describe('readGeoJsonFile', () => {
  it('parses a JSON object', async () => {
    const file = new File(['{"type":"FeatureCollection","features":[]}'], 'a.geojson')
    expect(await readGeoJsonFile(file)).toEqual({
      ok: true,
      content: { type: 'FeatureCollection', features: [] },
    })
  })

  it('refuses a file over 5 MB without reading it', async () => {
    const file = new File(['{}'], 'big.geojson')
    Object.defineProperty(file, 'size', { value: MAX_GEOJSON_BYTES + 1 })
    const result = await readGeoJsonFile(file)
    expect(result).toMatchObject({ ok: false, reason: 'too_large' })
  })

  it('accepts a file of exactly 5 MB', async () => {
    const file = new File(['{}'], 'edge.geojson')
    Object.defineProperty(file, 'size', { value: MAX_GEOJSON_BYTES })
    expect((await readGeoJsonFile(file)).ok).toBe(true)
  })

  it.each([
    ['{nope', 'not_json'],
    ['[1,2]', 'not_object'],
    ['"text"', 'not_object'],
    ['null', 'not_object'],
  ])('refuses %s as %s', async (text, reason) => {
    expect(await readGeoJsonFile(new File([text], 'x.json'))).toMatchObject({ ok: false, reason })
  })
})

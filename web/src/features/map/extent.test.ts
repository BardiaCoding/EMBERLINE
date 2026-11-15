import fc from 'fast-check'
import { bboxToGeometry } from '@/lib/areaGeometry'
import {
  CELL_SELECTION_NOTE,
  DEFAULT_REGION_EXTENT,
  extentBounds,
  fitExtentFor,
  extentFromMeta,
  extentOutlineGeoJSON,
  formatExtent,
  isValidExtent,
  resolveExtent,
  type Extent,
} from './extent'

const orderedExtent = fc
  .tuple(
    fc.double({ min: -179, max: 178, noNaN: true }),
    fc.double({ min: -89, max: 88, noNaN: true }),
    fc.double({ min: 0.1, max: 1, noNaN: true }),
    fc.double({ min: 0.1, max: 1, noNaN: true }),
  )
  .map(([west, south, dx, dy]): Extent => ({ west, south, east: west + dx, north: south + dy }))

describe('region extent', () => {
  it('fallback is the measured extent, not the FIRMS request box', () => {
    expect(DEFAULT_REGION_EXTENT).toEqual({ west: -124.4, south: 32.5, east: -114.0, north: 42.2 })
    const { west, south, east, north } = DEFAULT_REGION_EXTENT
    expect([south, north]).not.toContain(32.0)
    expect([south, north]).not.toContain(42.5)
    expect([west, east]).not.toContain(-125.0)
    expect([west, east]).not.toContain(-113.0)
  })

  it('reads the extent from /meta', () => {
    const extent = extentFromMeta({
      extent: { south: 32.5, north: 42.2, west: -124.4, east: -114.0 },
    })
    expect(extent).toEqual({ west: -124.4, south: 32.5, east: -114.0, north: 42.2 })
  })

  it('returns null for a missing or invalid /meta extent', () => {
    expect(extentFromMeta(null)).toBeNull()
    expect(extentFromMeta(undefined)).toBeNull()
    expect(extentFromMeta({ extent: { south: 42, north: 32, west: -124, east: -114 } })).toBeNull()
  })

  it('resolveExtent falls back to the default for null and invalid extents', () => {
    expect(resolveExtent(null)).toEqual(DEFAULT_REGION_EXTENT)
    expect(resolveExtent({ west: 5, south: 0, east: 1, north: 1 })).toEqual(DEFAULT_REGION_EXTENT)
    const own = { west: -120, south: 35, east: -119, north: 36 }
    expect(resolveExtent(own)).toEqual(own)
  })

  it('formats the extent with one decimal and the CRS', () => {
    expect(formatExtent(DEFAULT_REGION_EXTENT)).toBe(
      'lat 32.5 to 42.2, lon -124.4 to -114.0 (EPSG:4326)',
    )
  })

  it('states the cell-centre rule', () => {
    expect(CELL_SELECTION_NOTE).toBe(
      'Results use the 0.1 degree cells whose centre lies inside your area',
    )
  })
})

describe('extent outline and bounds', () => {
  it('bounds are [[west, south], [east, north]]', () => {
    expect(extentBounds(DEFAULT_REGION_EXTENT)).toEqual([
      [-124.4, 32.5],
      [-114.0, 42.2],
    ])
  })

  it('outline is a closed polygon ring in lon/lat order', () => {
    const outline = extentOutlineGeoJSON(DEFAULT_REGION_EXTENT)
    expect(outline.geometry.type).toBe('Polygon')
    expect(outline.geometry.coordinates).toEqual([
      [
        [-124.4, 32.5],
        [-114.0, 32.5],
        [-114.0, 42.2],
        [-124.4, 42.2],
        [-124.4, 32.5],
      ],
    ])
    expect(outline.properties.name).toBe('California region')
  })

  it('outline of any valid extent is a closed 5-position ring that equals the bounds', () => {
    fc.assert(
      fc.property(orderedExtent, (extent) => {
        expect(isValidExtent(extent)).toBe(true)
        const ring = extentOutlineGeoJSON(extent).geometry.coordinates[0]!
        expect(ring).toHaveLength(5)
        expect(ring[0]).toEqual(ring[4])
        const lons = ring.map((p) => p[0])
        const lats = ring.map((p) => p[1])
        const [[w, s], [e, n]] = extentBounds(extent)
        expect([
          Math.min(...lons),
          Math.min(...lats),
          Math.max(...lons),
          Math.max(...lats),
        ]).toEqual([w, s, e, n])
      }),
    )
  })
})

describe('fitExtentFor', () => {
  const region = DEFAULT_REGION_EXTENT
  it('returns the region when there is no selection', () => {
    expect(fitExtentFor(null, region)).toEqual(region)
  })
  it('returns the selection bounding box in west, south, east, north order', () => {
    const box = { west: -121.2, south: 35.3, east: -118.9, north: 37.5 }
    expect(fitExtentFor(bboxToGeometry(box), region)).toEqual(box)
    expect(extentBounds(fitExtentFor(bboxToGeometry(box), region))[0]).toEqual([-121.2, 35.3])
  })
  it('widens a tiny selection to a valid extent', () => {
    const tiny = { west: -120, south: 36, east: -120, north: 36 }
    const out = fitExtentFor(bboxToGeometry(tiny), region)
    expect(isValidExtent(out)).toBe(true)
  })
})

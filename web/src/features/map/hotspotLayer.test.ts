import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  cellsGeoJSON,
  classOf,
  densityClasses,
  hotspotLayerData,
  legendModel,
  pointsGeoJSON,
  satelliteColour,
} from './hotspotLayer'
import type { MapCell, MapLayerOut, MapPoint } from './mapLayerApi'
import { SATELLITE_COLOURS, SATELLITE_FALLBACK_COLOUR } from '@/styles/palettes'

const cell = (count: number): MapCell => ({
  lat: 34.05,
  lon: -118.15,
  count,
  raw_modis: count,
  raw_viirs: 0,
})

const point = (satellite: string): MapPoint => ({
  lat: 34.5,
  lon: -118.5,
  satellite,
  local_date: '2020-07-10',
  frp: null,
})

const layer = (over: Partial<MapLayerOut>): MapLayerOut => ({
  mode: 'points',
  total: 0,
  max_points: 20000,
  points: [],
  cells: [],
  cell_size_deg: 0.1,
  label: 'Filtered raw detections, not harmonized',
  time_convention: 'local standard time, fixed UTC-8',
  month: null,
  ...over,
})

describe('hotspot layer helpers', () => {
  it('puts longitude first in point coordinates', () => {
    const fc1 = pointsGeoJSON([point('SNPP')])
    expect(fc1.features[0]!.geometry.coordinates).toEqual([-118.5, 34.5])
    expect(fc1.features[0]!.properties.local_date).toBe('2020-07-10')
  })

  it('colours known satellites and falls back for others', () => {
    expect(satelliteColour('Terra')).toBe(SATELLITE_COLOURS.Terra)
    expect(satelliteColour('Other')).toBe(SATELLITE_FALLBACK_COLOUR)
  })

  it('builds 0.1 degree squares around the cell centre', () => {
    const out = cellsGeoJSON([cell(3)], 0.1, densityClasses([cell(3)]))
    const ring = out.features[0]!.geometry.coordinates[0]!
    expect(ring[0]![0]).toBeCloseTo(-118.2)
    expect(ring[0]![1]).toBeCloseTo(34.0)
    expect(ring[2]![0]).toBeCloseTo(-118.1)
    expect(ring[2]![1]).toBeCloseTo(34.1)
    expect(ring).toHaveLength(5)
  })

  it('property: every count falls in exactly one density class', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 5000 }), { minLength: 1, maxLength: 60 }),
        (counts) => {
          const classes = densityClasses(counts.map(cell))
          expect(classes.length).toBeGreaterThan(0)
          for (const n of counts) {
            const hits = classes.filter((c) => n >= c.min && n <= c.max)
            expect(hits).toHaveLength(1)
            expect(classOf(n, classes)).toBe(hits[0])
          }
        },
      ),
    )
  })

  it('has no density classes without cells', () => {
    expect(densityClasses([])).toEqual([])
  })

  it('selects the layer data by mode', () => {
    const pts = hotspotLayerData(layer({ total: 1, points: [point('Aqua')] }))
    expect(pts.mode).toBe('points')
    expect(pts.points.features).toHaveLength(1)
    const dens = hotspotLayerData(layer({ mode: 'density', total: 30000, cells: [cell(4)] }))
    expect(dens.mode).toBe('density')
    expect(dens.cells.features).toHaveLength(1)
    expect(dens.points.features).toHaveLength(0)
    expect(hotspotLayerData(undefined).points.features).toHaveLength(0)
  })

  it('builds the legend model', () => {
    expect(legendModel(layer({}))).toEqual({ kind: 'empty' })
    const pts = legendModel(
      layer({ total: 2, points: [point('N20'), point('Aqua'), point('N20')] }),
    )
    expect(pts.kind === 'points' && pts.items.map((i) => i.label)).toEqual(['Aqua', 'N20'])
    const dens = legendModel(layer({ mode: 'density', total: 30000, cells: [cell(1), cell(9)] }))
    expect(dens.kind).toBe('density')
  })
})

describe('density GeoJSON validity', () => {
  it('gives every cell a non-empty colour and (lon, lat) corner order', () => {
    const cells = [
      { lat: 36.05, lon: -119.95, count: 1, raw_modis: 1, raw_viirs: 0 },
      { lat: 36.15, lon: -119.85, count: 600, raw_modis: 300, raw_viirs: 300 },
    ]
    const data = cellsGeoJSON(cells, 0.1, densityClasses(cells))
    for (const f of data.features) {
      expect(f.properties.colour).not.toBe('')
      const [lon = 0, lat = 0] = f.geometry.coordinates[0]?.[0] ?? []
      expect(lon).toBeLessThan(-100)
      expect(lat).toBeGreaterThan(30)
    }
  })
})

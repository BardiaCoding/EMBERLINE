import { render } from '@testing-library/react'
import { act } from 'react'
import { vi } from 'vitest'
import type { AreaGeometry } from '@/lib/areaGeometry'
import { SELECTION_COLOUR } from '@/styles/palettes'
import { MapCanvas, SELECTION_FILL_LAYER_ID, SELECTION_SOURCE_ID } from './MapCanvas'
import { DEFAULT_REGION_EXTENT } from './extent'
import type { DrawMode } from './selectionDrawing'

// jsdom has no WebGL, so MapLibre and Terra Draw are replaced by recording stubs.
const stubs = vi.hoisted(() => {
  type Listener = (...args: never[]) => void
  const log: string[] = []
  const maps: FakeMap[] = []
  const draws: FakeDraw[] = []

  class FakeMap {
    handlers: Record<string, () => void> = {}
    sources: Record<string, unknown> = {}
    layers: Record<string, unknown>[] = []
    constructor() {
      maps.push(this)
    }
    addControl() {}
    on(event: string, handler: () => void) {
      this.handlers[event] = handler
      return this
    }
    addSource(id: string, spec: unknown) {
      this.sources[id] = spec
    }
    addLayer(layer: Record<string, unknown>) {
      this.layers.push(layer)
    }
    getSource(id: string) {
      return id in this.sources
        ? { setData: (data: unknown) => (this.sources[id] = { data }) }
        : undefined
    }
    fitBounds() {}
    remove() {
      log.push('map.remove')
    }
  }

  class FakeDraw {
    listeners: Record<string, Listener> = {}
    features = new Map<string, { id: string; geometry: unknown }>()
    mode = 'static'
    enabled = false
    modes: { name: string; options: unknown }[]
    added: unknown[] = []
    updated: unknown[] = []
    nextId = 1
    constructor(options: { modes: { name: string; options: unknown }[] }) {
      this.modes = options.modes
      draws.push(this)
    }
    on(event: string, listener: Listener) {
      this.listeners[event] = listener
    }
    start() {
      this.enabled = true
    }
    stop() {
      log.push('draw.stop')
      this.enabled = false
    }
    getMode() {
      return this.mode
    }
    setMode(mode: string) {
      this.mode = mode
    }
    addFeatures(features: { geometry: unknown }[]) {
      this.added.push(...features)
      return features.map((f) => {
        const id = `f${this.nextId++}`
        this.features.set(id, { id, geometry: f.geometry })
        return { id, valid: true }
      })
    }
    removeFeatures(ids: string[]) {
      for (const id of ids) this.features.delete(id)
    }
    hasFeature(id: string) {
      return this.features.has(id)
    }
    getSnapshotFeature(id: string) {
      return this.features.get(id)
    }
    updateFeatureGeometry(id: string, geometry: unknown) {
      this.updated.push(geometry)
      const feature = this.features.get(id)
      if (feature) feature.geometry = geometry
    }
    /** Test helper: the user finished drawing a shape. */
    drawShape(mode: string, geometry: unknown) {
      const id = `d${this.nextId++}`
      this.features.set(id, { id, geometry })
      this.listeners.finish?.(id as never, { mode, action: 'draw' } as never)
      return id
    }
  }

  const named = (name: string) =>
    class {
      readonly name = name
      readonly options: unknown
      constructor(options: unknown) {
        this.options = options
      }
    }
  return {
    log,
    maps,
    draws,
    maplibre: {
      MapLibreMap: FakeMap,
      NavigationControl: class {
        readonly stub = true
      },
      ScaleControl: class {
        readonly stub = true
      },
    },
    terraDraw: {
      TerraDraw: FakeDraw,
      TerraDrawRectangleMode: named('rectangle'),
      TerraDrawPolygonMode: named('polygon'),
      TerraDrawSelectMode: named('select'),
    },
    adapter: {
      TerraDrawMapLibreGLAdapter: class {
        readonly stub = true
      },
    },
  }
})

vi.mock('maplibre-gl', () => stubs.maplibre)
vi.mock('terra-draw', () => stubs.terraDraw)
vi.mock('terra-draw-maplibre-gl-adapter', () => stubs.adapter)

const SQUARE: AreaGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [-121, 36],
      [-119, 36],
      [-119, 38],
      [-121, 38],
      [-121, 36],
    ],
  ],
}
const MOVED: AreaGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [-121, 36],
      [-118, 36],
      [-118, 38],
      [-121, 38],
      [-121, 36],
    ],
  ],
}
const MULTI: AreaGeometry = {
  type: 'MultiPolygon',
  coordinates: [
    SQUARE.coordinates,
    [
      [
        [-117, 36],
        [-116, 36],
        [-116, 37],
        [-117, 37],
        [-117, 36],
      ],
    ],
  ],
}

type Props = {
  selection?: AreaGeometry | null
  drawMode?: DrawMode | null
  onShapeFinished?: (g: AreaGeometry, a: 'draw' | 'edit') => Promise<boolean>
  onShapeDeleted?: () => void
}

function ui(props: Props) {
  return (
    <MapCanvas
      extent={{ ...DEFAULT_REGION_EXTENT }}
      regionName="California region"
      label="Map"
      {...props}
    />
  )
}

function load() {
  act(() => {
    stubs.maps[0]!.handlers.load?.()
  })
}

beforeEach(() => {
  stubs.log.length = 0
  stubs.maps.length = 0
  stubs.draws.length = 0
})

const keepAll = () => Promise.resolve(true)

describe('MapCanvas drawing', () => {
  it('is read-only without onShapeFinished: no Terra Draw, no selection layer', () => {
    render(ui({}))
    load()
    expect(stubs.draws).toHaveLength(0)
    expect(SELECTION_SOURCE_ID in stubs.maps[0]!.sources).toBe(false)
  })

  it('creates Terra Draw with rectangle, polygon and select modes after the map loads', () => {
    render(ui({ onShapeFinished: keepAll }))
    expect(stubs.draws).toHaveLength(0)
    load()
    const draw = stubs.draws[0]!
    expect(draw.modes.map((m) => m.name)).toEqual(['rectangle', 'polygon', 'select'])
    expect(draw.enabled).toBe(true)
    expect(draw.mode).toBe('static')
    expect(SELECTION_SOURCE_ID in stubs.maps[0]!.sources).toBe(true)
    const fill = stubs.maps[0]!.layers.find((l) => l.id === SELECTION_FILL_LAYER_ID)
    expect(fill).toMatchObject({ paint: { 'fill-color': SELECTION_COLOUR } })
  })

  it('switches drawing modes and falls back to select (shape present) or static (none)', () => {
    const props = { onShapeFinished: keepAll }
    const { rerender } = render(ui({ ...props, selection: SQUARE }))
    load()
    const draw = stubs.draws[0]!
    expect(draw.mode).toBe('select')
    rerender(ui({ ...props, selection: SQUARE, drawMode: 'rectangle' }))
    expect(draw.mode).toBe('rectangle')
    rerender(ui({ ...props, selection: SQUARE, drawMode: 'polygon' }))
    expect(draw.mode).toBe('polygon')
    rerender(ui({ ...props, selection: SQUARE, drawMode: null }))
    expect(draw.mode).toBe('select')
    rerender(ui({ ...props, selection: null, drawMode: null }))
    expect(draw.mode).toBe('static')
    expect(draw.features.size).toBe(0)
  })

  it('shows the selection on the layer and keeps one editable polygon in Terra Draw', () => {
    const props = { onShapeFinished: keepAll }
    const { rerender } = render(ui({ ...props, selection: null }))
    load()
    const draw = stubs.draws[0]!
    rerender(ui({ ...props, selection: SQUARE }))
    expect(stubs.maps[0]!.sources[SELECTION_SOURCE_ID]).toMatchObject({
      data: { features: [{ geometry: SQUARE }] },
    })
    expect(draw.features.size).toBe(1)
    rerender(ui({ ...props, selection: MOVED }))
    expect(draw.features.size).toBe(1)
    rerender(ui({ ...props, selection: MULTI }))
    // A MultiPolygon is only on the layer. Terra Draw holds single polygons.
    expect(draw.features.size).toBe(0)
    expect(stubs.maps[0]!.sources[SELECTION_SOURCE_ID]).toMatchObject({
      data: { features: [{ geometry: MULTI }] },
    })
  })

  it('does not rewrite the Terra Draw shape when the accepted shape equals it', () => {
    const props = { onShapeFinished: keepAll }
    const { rerender } = render(ui({ ...props, selection: SQUARE }))
    load()
    const draw = stubs.draws[0]!
    expect(draw.added).toHaveLength(1)
    rerender(ui({ ...props, selection: structuredClone(SQUARE) }))
    expect(draw.added).toHaveLength(1)
  })

  it('hands a finished drawing to onShapeFinished and removes it from the Terra Draw store', async () => {
    const onShapeFinished = vi.fn(keepAll)
    render(ui({ onShapeFinished }))
    load()
    const draw = stubs.draws[0]!
    const id = draw.drawShape('rectangle', SQUARE)
    expect(onShapeFinished).toHaveBeenCalledWith(SQUARE, 'draw')
    await vi.waitFor(() => {
      expect(draw.features.has(id)).toBe(false)
    })
  })

  it('reports an edit of the shape and restores the last accepted shape when the edit is rejected', async () => {
    let keep = false
    const onShapeFinished = vi.fn(() => Promise.resolve(keep))
    render(ui({ onShapeFinished, selection: SQUARE }))
    load()
    const draw = stubs.draws[0]!
    const [id] = [...draw.features.keys()]
    draw.features.get(id!)!.geometry = MOVED
    await act(async () => {
      draw.listeners.finish?.(id as never, { mode: 'select', action: 'dragCoordinate' } as never)
      await Promise.resolve()
    })
    expect(onShapeFinished).toHaveBeenCalledWith(MOVED, 'edit')
    await vi.waitFor(() => {
      expect(draw.updated).toEqual([SQUARE])
    })

    // An accepted edit is not restored.
    keep = true
    draw.updated.length = 0
    await act(async () => {
      draw.listeners.finish?.(id as never, { mode: 'select', action: 'dragFeature' } as never)
      await Promise.resolve()
    })
    expect(draw.updated).toEqual([])
  })

  it('ignores inserting a midpoint, which does not change the shape', () => {
    const onShapeFinished = vi.fn(keepAll)
    render(ui({ onShapeFinished, selection: SQUARE }))
    load()
    const draw = stubs.draws[0]!
    const [id] = [...draw.features.keys()]
    draw.listeners.finish?.(id as never, { mode: 'select', action: 'insertMidpoint' } as never)
    expect(onShapeFinished).not.toHaveBeenCalled()
  })

  it('reports a user delete of the shape, but not a change made through the API', () => {
    const onShapeDeleted = vi.fn()
    const { rerender } = render(ui({ onShapeFinished: keepAll, onShapeDeleted, selection: SQUARE }))
    load()
    const draw = stubs.draws[0]!
    const [id] = [...draw.features.keys()]
    draw.listeners.change?.([id] as never, 'delete' as never, { origin: 'api' } as never)
    expect(onShapeDeleted).not.toHaveBeenCalled()
    // Replacing the shape removes the old one through the API: not a user delete either.
    rerender(ui({ onShapeFinished: keepAll, onShapeDeleted, selection: MOVED }))
    expect(onShapeDeleted).not.toHaveBeenCalled()

    const [current] = [...draw.features.keys()]
    draw.listeners.change?.([current] as never, 'delete' as never, undefined as never)
    expect(onShapeDeleted).toHaveBeenCalledOnce()
  })

  it('stops Terra Draw before it removes the map', () => {
    const { unmount } = render(ui({ onShapeFinished: keepAll }))
    load()
    unmount()
    expect(stubs.log).toEqual(['draw.stop', 'map.remove'])
  })
})

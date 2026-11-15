import { render, screen } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { vi } from 'vitest'
import { BASEMAP_STYLE } from './basemap'
import { DEFAULT_REGION_EXTENT } from './extent'
import { MapView } from './MapView'

// jsdom has no WebGL, so MapLibre is replaced by a recording stub.
const maplibre = vi.hoisted(() => {
  type Handler = () => void
  const state = {
    options: [] as Record<string, unknown>[],
    sources: [] as { id: string; spec: unknown }[],
    layers: [] as Record<string, unknown>[],
    fitBounds: [] as unknown[][],
    setData: [] as unknown[],
    removed: 0,
  }
  class MapLibreMap {
    private handlers: Record<string, Handler> = {}
    constructor(options: Record<string, unknown>) {
      state.options.push(options)
    }
    addControl = vi.fn()
    on(event: string, handler: Handler) {
      this.handlers[event] = handler
      return this
    }
    fireLoad() {
      this.handlers.load?.()
    }
    addSource(id: string, spec: unknown) {
      state.sources.push({ id, spec })
    }
    addLayer(layer: Record<string, unknown>) {
      state.layers.push(layer)
    }
    getSource() {
      return { setData: (data: unknown) => state.setData.push(data) }
    }
    fitBounds(...args: unknown[]) {
      state.fitBounds.push(args)
    }
    remove() {
      state.removed += 1
    }
  }
  const instances: MapLibreMap[] = []
  const Tracked = class extends MapLibreMap {
    constructor(options: Record<string, unknown>) {
      super(options)
      instances.push(this)
    }
  }
  return {
    state,
    instances,
    module: {
      MapLibreMap: Tracked,
      NavigationControl: class {
        readonly stub = true
      },
      ScaleControl: class {
        readonly stub = true
      },
    },
  }
})

vi.mock('maplibre-gl', () => maplibre.module)

beforeEach(() => {
  maplibre.state.options.length = 0
  maplibre.state.sources.length = 0
  maplibre.state.layers.length = 0
  maplibre.state.fitBounds.length = 0
  maplibre.state.setData.length = 0
  maplibre.state.removed = 0
  maplibre.instances.length = 0
})

describe('MapView', () => {
  it('shows the cell-centre note and the full region as the selection', () => {
    render(<MapView />)
    expect(screen.getByTestId('map-note').textContent).toBe(
      'Results use the 0.1 degree cells whose centre lies inside your area',
    )
    expect(screen.getByTestId('map-selection').textContent).toBe(
      'Current selection: full California region',
    )
  })

  it('never says California state and never shows the FIRMS request box', () => {
    const { container } = render(<MapView />)
    const text = container.textContent
    expect(text).not.toMatch(/california state/i)
    expect(text).toContain('lat 32.5 to 42.2, lon -124.4 to -114.0')
    expect(text).not.toMatch(/42\.5|32\.0|-125|-113\.0/)
  })

  it('fits the initial view to the default extent when no extent is given', () => {
    render(<MapView />)
    expect(maplibre.state.options).toHaveLength(1)
    expect(maplibre.state.options[0]!.bounds).toEqual([
      [-124.4, 32.5],
      [-114.0, 42.2],
    ])
    expect(maplibre.state.options[0]!.style).toBe(BASEMAP_STYLE)
  })

  it('uses the extent from /meta and falls back for an invalid one', () => {
    const meta = { west: -120, south: 34, east: -118, north: 36 }
    const { unmount } = render(<MapView extent={meta} />)
    expect(maplibre.state.options[0]!.bounds).toEqual([
      [-120, 34],
      [-118, 36],
    ])
    unmount()
    render(<MapView extent={{ west: 1, south: 1, east: 0, north: 0 }} />)
    expect(maplibre.state.options[1]!.bounds).toEqual([
      [DEFAULT_REGION_EXTENT.west, DEFAULT_REGION_EXTENT.south],
      [DEFAULT_REGION_EXTENT.east, DEFAULT_REGION_EXTENT.north],
    ])
  })

  it('adds the extent outline once the map style has loaded', () => {
    render(<MapView />)
    maplibre.instances[0]!.fireLoad()
    expect(maplibre.state.sources).toHaveLength(1)
    const spec = maplibre.state.sources[0]!.spec as {
      type: string
      data: { geometry: { coordinates: number[][][] } }
    }
    expect(spec.type).toBe('geojson')
    expect(spec.data.geometry.coordinates[0]![0]).toEqual([-124.4, 32.5])
    expect(maplibre.state.layers[0]).toMatchObject({ type: 'line' })
  })

  it('refits and redraws only when an extent value changes', () => {
    const { rerender } = render(
      <MapView extent={{ west: -120, south: 34, east: -118, north: 36 }} />,
    )
    rerender(<MapView extent={{ west: -120, south: 34, east: -118, north: 36 }} />)
    expect(maplibre.state.fitBounds).toHaveLength(0)
    rerender(<MapView extent={{ west: -121, south: 34, east: -118, north: 36 }} />)
    expect(maplibre.state.fitBounds).toHaveLength(1)
    expect(maplibre.state.setData).toHaveLength(1)
    expect(maplibre.instances).toHaveLength(1)
  })

  it('removes the map on unmount', () => {
    const { unmount } = render(<MapView />)
    unmount()
    expect(maplibre.state.removed).toBe(1)
  })

  it('attributes OpenStreetMap and needs no token', () => {
    const source = BASEMAP_STYLE.sources.basemap as { attribution: string; tiles: string[] }
    expect(source.attribution).toContain('OpenStreetMap')
    expect(source.tiles.join()).not.toMatch(/token|key=|access_token/i)
  })

  it('has no accessibility violations', async () => {
    const { container } = render(<MapView />)
    expect(await axe(container)).toHaveNoViolations()
  })
})

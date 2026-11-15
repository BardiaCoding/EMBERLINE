import { render, waitFor } from '@testing-library/react'
import { act } from 'react'
import { vi } from 'vitest'
import { basemapStyleFor } from '@/features/theme/basemapStyle'
import { HOTSPOT_CELLS_SOURCE_ID, MapCanvas, OUTLINE_SOURCE_ID } from './MapCanvas'
import { DEFAULT_REGION_EXTENT } from './extent'
import { EMPTY_HOTSPOT_LAYER } from './hotspotLayer'
// jsdom has no WebGL, so MapLibre is replaced by a recording stub.
const stubs = vi.hoisted(() => {
  const maps: FakeMap[] = []
  class FakeMap {
    options: { style?: unknown }
    handlers: Record<string, () => void> = {}
    sources: Record<string, unknown> = {}
    styles: { style: unknown; options: unknown }[] = []
    constructor(options: { style?: unknown }) {
      this.options = options
      maps.push(this)
    }
    addControl() {}
    on(event: string, handler: () => void) {
      this.handlers[event] = handler
      return this
    }
    once(event: string, handler: () => void) {
      this.handlers[event] = handler
      return this
    }
    addSource(id: string, spec: unknown) {
      this.sources[id] = spec
    }
    addLayer() {}
    getSource(id: string) {
      return id in this.sources ? { setData: () => undefined } : undefined
    }
    setStyle(style: unknown, options: unknown) {
      this.styles.push({ style, options })
      this.sources = {} // a new style drops every source and layer
    }
    fitBounds() {}
    remove() {}
  }
  const Stub = function Stub() {} as unknown as new () => object
  return { maps, maplibre: { MapLibreMap: FakeMap, NavigationControl: Stub, ScaleControl: Stub } }
})
vi.mock('maplibre-gl', () => stubs.maplibre)
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}))
describe('MapCanvas basemap theme', () => {
  afterEach(() => {
    document.documentElement.classList.remove('dark', 'light')
    stubs.maps.length = 0
  })
  it('starts with the light style and swaps to the dark one, then adds the layers again', async () => {
    document.documentElement.classList.add('light')
    render(
      <MapCanvas
        extent={{ ...DEFAULT_REGION_EXTENT }}
        regionName="California region"
        label="Map"
        hotspots={EMPTY_HOTSPOT_LAYER}
      />,
    )
    const map = stubs.maps[0]!
    expect(map.options.style).toBe(basemapStyleFor(false))
    act(() => map.handlers.load?.())
    expect(OUTLINE_SOURCE_ID in map.sources).toBe(true)
    act(() => {
      document.documentElement.classList.replace('light', 'dark')
    })
    await waitFor(() => {
      expect(map.styles).toHaveLength(1)
    })
    expect(map.styles[0]!.style).toEqual(basemapStyleFor(true))
    expect(map.sources).toEqual({})
    act(() => map.handlers['style.load']?.())
    expect(OUTLINE_SOURCE_ID in map.sources).toBe(true)
    expect(HOTSPOT_CELLS_SOURCE_ID in map.sources).toBe(true)
  })
})

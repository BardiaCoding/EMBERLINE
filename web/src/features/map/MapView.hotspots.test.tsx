import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'
import { axe } from 'vitest-axe'
import { createQueryClient } from '@/lib/queryClient'
import { server } from '@/test/server'
import {
  HOTSPOT_CELLS_SOURCE_ID,
  HOTSPOT_POINTS_LAYER_ID,
  HOTSPOT_POINTS_SOURCE_ID,
} from './MapCanvas'
import { MapView } from './MapView'
import type { MapLayerOut } from './mapLayerApi'

// jsdom has no WebGL, so MapLibre is replaced by a recording stub.
const maplibre = vi.hoisted(() => {
  const state = {
    sources: [] as { id: string; spec: unknown }[],
    layers: [] as Record<string, unknown>[],
    setData: [] as { id: string; data: unknown }[],
  }
  class MapLibreMap {
    private handlers: Record<string, () => void> = {}
    addControl = vi.fn()
    on(event: string, handler: () => void) {
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
    getSource(id: string) {
      return { setData: (data: unknown) => state.setData.push({ id, data }) }
    }
    fitBounds = vi.fn()
    remove = vi.fn()
  }
  const instances: MapLibreMap[] = []
  const Tracked = class extends MapLibreMap {
    constructor() {
      super()
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

const base: MapLayerOut = {
  mode: 'points',
  total: 2,
  max_points: 20000,
  points: [
    { lat: 34.5, lon: -118.5, satellite: 'SNPP', local_date: '2020-07-10', frp: 12 },
    { lat: 34.6, lon: -118.6, satellite: 'Aqua', local_date: '2020-07-11', frp: null },
  ],
  cells: [],
  cell_size_deg: 0.1,
  label: 'Filtered raw detections, not harmonized',
  time_convention: 'local standard time, fixed UTC-8',
  month: null,
}

const request = { geometry: null, start: '2020-07-01', end: '2020-07-31' }

function renderView(layer: MapLayerOut | 'error') {
  const bodies: unknown[] = []
  server.use(
    http.post('/api/v1/map-layer', async ({ request: req }) => {
      bodies.push(await req.json())
      if (layer === 'error') {
        return HttpResponse.json(
          { error: { code: 'boom', message: 'Server error', fields: [], request_id: 'x' } },
          { status: 500 },
        )
      }
      return HttpResponse.json(layer)
    }),
  )
  const utils = render(
    <QueryClientProvider client={createQueryClient()}>
      <MapView hotspots={request} />
    </QueryClientProvider>,
  )
  return { ...utils, bodies }
}

beforeEach(() => {
  maplibre.state.sources.length = 0
  maplibre.state.layers.length = 0
  maplibre.state.setData.length = 0
  maplibre.instances.length = 0
})

describe('MapView hotspot layer', () => {
  it('labels the layer as raw detections, not harmonized, and shows the satellites', async () => {
    const { bodies } = renderView(base)
    expect(screen.getByTestId('hotspot-label').textContent).toMatch(
      /raw detections, not harmonized/i,
    )
    await screen.findByTestId('hotspot-summary')
    expect(screen.getByTestId('hotspot-summary').textContent).toContain('2 detections')
    const items = screen.getAllByRole('listitem').map((li) => li.textContent)
    expect(items).toEqual(['Aqua', 'SNPP'])
    expect(screen.getByTestId('hotspot-time').textContent).toContain('UTC-8')
    expect(bodies[0]).toEqual(request)
  })

  it('adds the hotspot sources and layers on load and feeds them the points', async () => {
    renderView(base)
    await screen.findByTestId('hotspot-summary')
    maplibre.instances[0]!.fireLoad()
    const ids = maplibre.state.sources.map((s) => s.id)
    expect(ids).toContain(HOTSPOT_POINTS_SOURCE_ID)
    expect(ids).toContain(HOTSPOT_CELLS_SOURCE_ID)
    expect(maplibre.state.layers.map((l) => l.id)).toContain(HOTSPOT_POINTS_LAYER_ID)
    const pointsSource = maplibre.state.sources.find((s) => s.id === HOTSPOT_POINTS_SOURCE_ID)!
    const data = (pointsSource.spec as { data: { features: unknown[] } }).data
    expect(data.features).toHaveLength(2)
  })

  it('explains the density layer above the point limit', async () => {
    renderView({
      ...base,
      mode: 'density',
      total: 54321,
      points: [],
      cells: [
        { lat: 34.05, lon: -118.15, count: 3, raw_modis: 3, raw_viirs: 0 },
        { lat: 34.15, lon: -118.15, count: 40, raw_modis: 0, raw_viirs: 40 },
      ],
    })
    const summary = await screen.findByTestId('hotspot-summary')
    expect(summary.textContent).toContain('54,321 detections')
    expect(summary.textContent).toContain('20,000 point limit')
    expect(screen.getAllByRole('listitem').length).toBeGreaterThan(1)
  })

  it('says so when there are no detections', async () => {
    renderView({ ...base, total: 0, points: [] })
    expect((await screen.findByTestId('hotspot-empty')).textContent).toMatch(/No detections/)
  })

  it('shows an error message when the request fails', async () => {
    renderView('error')
    expect((await screen.findByTestId('hotspot-error')).textContent).toContain(
      'could not be loaded',
    )
  })

  it('empties the map data when the layer is switched off', async () => {
    renderView(base)
    await screen.findByTestId('hotspot-summary')
    maplibre.instances[0]!.fireLoad()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show hotspot layer' }))
    await waitFor(() => {
      const last = maplibre.state.setData.filter((d) => d.id === HOTSPOT_POINTS_SOURCE_ID).at(-1)
      expect((last!.data as { features: unknown[] }).features).toHaveLength(0)
    })
  })

  it('has no accessibility violations', async () => {
    const { container } = renderView(base)
    await screen.findByTestId('hotspot-summary')
    expect(await axe(container)).toHaveNoViolations()
  })
})

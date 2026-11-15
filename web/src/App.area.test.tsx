import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'
import { axe } from 'vitest-axe'
import { DRAW_HINT_STORAGE_KEY } from '@/features/area/useDrawHint'
import type { DrawMode, ShapeAction } from '@/features/map/selectionDrawing'
import type {
  CalendarOut,
  CalendarRequest,
  ExampleArea,
  MetaOut,
  NormalizeOut,
  NormalizeRequest,
} from '@/lib/api'
import type { AreaGeometry } from '@/lib/areaGeometry'
import { month, result } from '@/lib/binning.fixtures'
import { statsResult } from '@/lib/stats.fixtures'
import { encodeGeometry } from '@/lib/urlState'
import { QueryProvider } from '@/lib/QueryProvider'
import { createQueryClient } from '@/lib/queryClient'
import { server } from '@/test/server'
import { App } from './App'

// Area selection through the whole app (requirements 11, 12, 13). jsdom has no WebGL, so the
// map canvas is a stub that records its props and lets a test finish a shape like Terra Draw does.
type CanvasProps = {
  label: string
  selection?: AreaGeometry | null
  drawMode?: DrawMode | null
  onShapeFinished?: (geometry: AreaGeometry, action: ShapeAction) => Promise<boolean>
  onShapeDeleted?: () => void
}
const canvas = vi.hoisted((): { latest: unknown } => ({ latest: null }))
vi.mock('@/features/map/MapCanvas', () => ({
  MapCanvas: (props: CanvasProps) => {
    canvas.latest = props
    return <div role="img" aria-label={props.label} />
  },
}))
function canvasProps(): CanvasProps {
  return canvas.latest as CanvasProps
}
/** Finishes a shape on the stub map and returns what the app answered (keep or reject). */
async function finishShape(geometry: AreaGeometry, action: ShapeAction = 'draw'): Promise<boolean> {
  let keep = false
  await act(async () => {
    keep = (await canvasProps().onShapeFinished?.(geometry, action)) ?? false
  })
  return keep
}

// Synthetic values. TEST FIXTURE, not NASA data.
const ORIGIN = window.location.origin
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
const BOWTIE: AreaGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [-120, 36],
      [-119, 37],
      [-119, 36],
      [-120, 37],
      [-120, 36],
    ],
  ],
}
const CLIPPED: AreaGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [-121, 36],
      [-120, 36],
      [-120, 38],
      [-121, 38],
      [-121, 36],
    ],
  ],
}
const EXAMPLES: ExampleArea[] = [
  { name: 'Test area one', description: 'First synthetic description.', geometry: SQUARE },
]
const meta: MetaOut = {
  name: 'California region',
  extent: { west: -124.4, south: 32.5, east: -114.0, north: 42.2 },
  record_start: '2000-11',
  first_date: '2000-11-01',
  latest_month: '2003-12',
  latest_month_incomplete: false,
  latest_complete_month: '2003-12',
  latest_detection_local_date: '2003-12-31',
  latest_detection_utc: '2004-01-01T01:00:00Z',
  time_convention: 'local standard time, UTC-8',
  unit: 'cell-days (MODIS-equivalent)',
  watch_threshold: 90,
  limitations: [],
  example_areas: EXAMPLES,
  bounds_available: false,
}
const calendarResult: CalendarOut = result(
  [month(2002, 7, 120.5, { raw_modis: 100, raw_viirs: 0 }), month(2003, 12, 33)],
  [],
)
const accepted = (geometry: AreaGeometry, extra: Partial<NormalizeOut> = {}): NormalizeOut => ({
  geometry,
  clipped: false,
  clipped_percent: 0,
  n_cells: 7,
  notice: null,
  ignored_features: 0,
  ...extra,
})

const calendarRequests: CalendarRequest[] = []
const normalizeRequests: NormalizeRequest[] = []
const statsOut = statsResult()
type NormalizeHandler = (body: NormalizeRequest) => Response | Promise<Response>

function useApi(
  normalize: NormalizeHandler = (b) => HttpResponse.json(accepted(b.geometry as AreaGeometry)),
) {
  server.use(
    http.get(`${ORIGIN}/api/health`, () =>
      HttpResponse.json({ status: 'ok', data_present: true, latest_month: '2003-12' }),
    ),
    http.get(`${ORIGIN}/api/v1/meta`, () => HttpResponse.json(meta)),
    http.post(`${ORIGIN}/api/v1/calendar`, async ({ request }) => {
      calendarRequests.push((await request.json()) as CalendarRequest)
      return HttpResponse.json(calendarResult)
    }),
    http.post(`${ORIGIN}/api/v1/stats`, () => HttpResponse.json(statsOut)),
    http.post(`${ORIGIN}/api/v1/selection/normalize`, async ({ request }) => {
      const body = (await request.json()) as NormalizeRequest
      normalizeRequests.push(body)
      return normalize(body)
    }),
  )
}

function rejected(code: string, reason: string, field = 'geometry', status = 422) {
  return HttpResponse.json(
    { error: { code, message: 'Server message.', fields: [{ field, reason }], request_id: 'r1' } },
    { status },
  )
}

async function renderReady() {
  render(
    <QueryProvider client={createQueryClient()}>
      <App />
    </QueryProvider>,
  )
  // Generous timeout: the first render in a busy parallel run can take longer than 1 s.
  await screen.findByRole('region', { name: 'Burning activity calendar' }, { timeout: 10_000 })
}

beforeEach(() => {
  calendarRequests.length = 0
  normalizeRequests.length = 0
  canvas.latest = null
  window.sessionStorage.clear()
  window.history.replaceState(null, '', '/')
})

describe('area selection in the app', () => {
  it('starts with the full region: no geometry in the query, the hint shown, the cell-centre note', async () => {
    useApi()
    await renderReady()
    expect(calendarRequests).toHaveLength(1)
    expect(calendarRequests[0]!.geometry).toBeNull()
    expect(screen.getByTestId('map-selection').textContent).toBe(
      'Current selection: full California region',
    )
    expect(screen.getByTestId('draw-hint')).toBeTruthy()
    expect(screen.getByTestId('map-note').textContent).toContain('0.1 degree cells')
    expect(screen.getByTestId('bbox-readout').textContent).toContain(
      'west -124.40000, south 32.50000, east -114.00000, north 42.20000',
    )
  })

  it('passes the accepted shape to the calendar query, closes the hint and leaves drawing mode', async () => {
    useApi()
    await renderReady()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Draw rectangle' }))
    expect(canvasProps().drawMode).toBe('rectangle')

    expect(await finishShape(SQUARE)).toBe(true)

    await waitFor(() => {
      expect(calendarRequests).toHaveLength(2)
    })
    expect(normalizeRequests).toEqual([{ geometry: SQUARE }])
    expect(calendarRequests[1]!.geometry).toEqual(SQUARE)
    expect(canvasProps().drawMode).toBeNull()
    expect(canvasProps().selection).toEqual(SQUARE)
    expect(screen.queryByTestId('draw-hint')).toBeNull()
    expect(window.sessionStorage.getItem(DRAW_HINT_STORAGE_KEY)).toBe('1')
    expect(screen.getByTestId('map-selection').textContent).toBe(
      'Current selection: your area (7 cells)',
    )
    expect(screen.getByTestId('bbox-readout').textContent).toContain(
      'west -121.00000, south 36.00000, east -119.00000, north 38.00000',
    )
    expect(screen.queryByTestId('area-clipped')).toBeNull()
  })

  it('shows the clipped notice with the removed percentage and queries the clipped shape', async () => {
    useApi(() => HttpResponse.json(accepted(CLIPPED, { clipped: true, clipped_percent: 50 })))
    await renderReady()
    await finishShape(SQUARE)
    expect((await screen.findByTestId('area-clipped')).textContent).toBe(
      'Clipped to the California region: 50.0 % of your area lay outside it and was removed.',
    )
    await waitFor(() => {
      expect(calendarRequests[1]?.geometry).toEqual(CLIPPED)
    })
    expect(canvasProps().selection).toEqual(CLIPPED)
  })

  it('shows the no-cells notice for an area with no cell centre', async () => {
    useApi((b) =>
      HttpResponse.json(accepted(b.geometry as AreaGeometry, { n_cells: 0, notice: 'no_cells' })),
    )
    await renderReady()
    await finishShape(SQUARE)
    expect((await screen.findByTestId('area-no-cells')).textContent).toMatch(
      /No 0\.1 degree cell centre/,
    )
  })

  it('rejects a self-intersecting shape in the browser: no request, the previous area and results stay', async () => {
    useApi()
    await renderReady()
    await finishShape(SQUARE)
    await waitFor(() => {
      expect(calendarRequests).toHaveLength(2)
    })

    expect(await finishShape(BOWTIE, 'edit')).toBe(false)

    const message = await screen.findByTestId('area-rejection')
    expect(message.textContent).toMatch(/crosses itself/)
    expect(message.textContent).toMatch(/previous area and its results are unchanged/)
    expect(normalizeRequests).toHaveLength(1)
    expect(calendarRequests).toHaveLength(2)
    expect(canvasProps().selection).toEqual(SQUARE)
    expect(screen.getByRole('region', { name: 'Burning activity calendar' })).toBeTruthy()
    expect(screen.getByTestId('map-selection').textContent).toContain('your area')
  })

  it('names the vertex limit and the submitted count for a shape over 1000 vertices', async () => {
    useApi()
    await renderReady()
    const ring = Array.from({ length: 1001 }, (_, i) => [-120 + i * 1e-5, 37 + (i % 2) * 1e-5])
    expect(await finishShape({ type: 'Polygon', coordinates: [ring] } as AreaGeometry)).toBe(false)
    expect((await screen.findByTestId('area-rejection')).textContent).toMatch(
      /has 1001 vertices\. The limit is 1000/,
    )
    expect(normalizeRequests).toHaveLength(0)
  })

  it('shows the region extent when the server says the area is outside the region, and keeps the area', async () => {
    useApi((b) =>
      b.geometry === SQUARE || JSON.stringify(b.geometry) === JSON.stringify(SQUARE)
        ? HttpResponse.json(accepted(SQUARE))
        : rejected('outside_coverage', 'outside_extent'),
    )
    await renderReady()
    await finishShape(SQUARE)
    await waitFor(() => {
      expect(calendarRequests).toHaveLength(2)
    })

    const far: AreaGeometry = {
      type: 'Polygon',
      coordinates: [
        [
          [-110, 36],
          [-109, 36],
          [-109, 37],
          [-110, 37],
          [-110, 36],
        ],
      ],
    }
    expect(await finishShape(far)).toBe(false)
    const message = (await screen.findByTestId('area-rejection')).textContent
    expect(message).toMatch(/outside the California region/)
    expect(message).toContain('west -124.4, south 32.5, east -114, north 42.2')
    expect(calendarRequests).toHaveLength(2)
    expect(canvasProps().selection).toEqual(SQUARE)
  })

  it('keeps the drawn shape and offers Retry when the check fails, and Retry sets the area', async () => {
    let fail = true
    useApi((b) =>
      fail
        ? HttpResponse.json(
            { error: { code: 'internal_error', message: 'Boom.' } },
            { status: 500 },
          )
        : HttpResponse.json(accepted(b.geometry as AreaGeometry)),
    )
    await renderReady()
    expect(await finishShape(SQUARE)).toBe(true)

    const error = await screen.findByTestId('area-error')
    expect(error.textContent).toMatch(/Results could not be loaded/)
    expect(canvasProps().selection).toEqual(SQUARE)
    expect(calendarRequests).toHaveLength(1)
    expect(screen.getByTestId('map-selection').textContent).toBe(
      'Current selection: full California region',
    )

    fail = false
    await userEvent.setup().click(within(error).getByRole('button', { name: 'Retry' }))
    await waitFor(() => {
      expect(calendarRequests).toHaveLength(2)
    })
    expect(calendarRequests[1]!.geometry).toEqual(SQUARE)
    expect(screen.queryByTestId('area-error')).toBeNull()
  })

  it('Clear returns to the full region, removes the shape and leaves drawing mode', async () => {
    useApi()
    await renderReady()
    const user = userEvent.setup()
    await finishShape(SQUARE)
    await waitFor(() => {
      expect(calendarRequests).toHaveLength(2)
    })
    await user.click(screen.getByRole('button', { name: 'Draw polygon' }))
    expect(canvasProps().drawMode).toBe('polygon')

    await user.click(screen.getByRole('button', { name: 'Clear' }))

    expect(canvasProps().drawMode).toBeNull()
    expect(canvasProps().selection).toBeNull()
    expect(screen.getByTestId('map-selection').textContent).toBe(
      'Current selection: full California region',
    )
    // The full-region query is cached from the first load, so no new request is sent.
    expect(calendarRequests).toHaveLength(2)
    expect(screen.getByTestId('bbox-readout').textContent).toContain('west -124.40000')
  })

  it('deleting the shape on the map returns to the full region', async () => {
    useApi()
    await renderReady()
    await finishShape(SQUARE)
    await waitFor(() => {
      expect(calendarRequests).toHaveLength(2)
    })
    act(() => {
      canvasProps().onShapeDeleted?.()
    })
    expect(canvasProps().selection).toBeNull()
    expect(screen.getByTestId('map-selection').textContent).toBe(
      'Current selection: full California region',
    )
  })

  it('an example area takes the same path as a drawn shape', async () => {
    useApi()
    await renderReady()
    const user = userEvent.setup()
    const button = screen.getByRole('button', { name: 'Test area one' })
    await user.click(button)

    await waitFor(() => {
      expect(calendarRequests).toHaveLength(2)
    })
    expect(normalizeRequests).toEqual([{ geometry: SQUARE }])
    expect(calendarRequests[1]!.geometry).toEqual(SQUARE)
    expect(canvasProps().selection).toEqual(SQUARE)
  })

  it('coordinates send a bbox, set the area, and a rejected entry keeps the typed values', async () => {
    useApi((b) =>
      b.bbox !== undefined && b.bbox !== null && b.bbox.west < -130
        ? rejected('outside_coverage', 'outside_extent', 'bbox')
        : HttpResponse.json(accepted(SQUARE)),
    )
    await renderReady()
    const user = userEvent.setup()
    const set = async (values: string[]) => {
      for (const [label, value] of [
        ['West (longitude)', values[0]!],
        ['South (latitude)', values[1]!],
        ['East (longitude)', values[2]!],
        ['North (latitude)', values[3]!],
      ] as const) {
        await user.clear(screen.getByLabelText(label))
        await user.type(screen.getByLabelText(label), value)
      }
      await user.click(screen.getByRole('button', { name: 'Use these coordinates' }))
    }

    await set(['-121', '36', '-119', '38'])
    await waitFor(() => {
      expect(calendarRequests).toHaveLength(2)
    })
    expect(normalizeRequests[0]).toEqual({ bbox: { west: -121, south: 36, east: -119, north: 38 } })

    await set(['-140', '36', '-135', '38'])
    expect((await screen.findByTestId('area-rejection')).textContent).toMatch(
      /outside the California region/,
    )
    expect(screen.getByLabelText<HTMLInputElement>('West (longitude)').value).toBe('-140')
    expect(calendarRequests).toHaveLength(2)
    expect(canvasProps().selection).toEqual(SQUARE)
  })

  it('does not call the server for an inverted rectangle', async () => {
    useApi()
    await renderReady()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('West (longitude)'), '-119')
    await user.type(screen.getByLabelText('South (latitude)'), '36')
    await user.type(screen.getByLabelText('East (longitude)'), '-121')
    await user.type(screen.getByLabelText('North (latitude)'), '38')
    await user.click(screen.getByRole('button', { name: 'Use these coordinates' }))
    expect(screen.getAllByRole('alert').map((a) => a.textContent)).toContain(
      'West must be less than east.',
    )
    expect(normalizeRequests).toHaveLength(0)
    expect(calendarRequests).toHaveLength(1)
  })

  it('a circle sends centre and radius, sets the area, and a rejected radius keeps the area', async () => {
    useApi((b) =>
      b.circle !== undefined && b.circle !== null && b.circle.radius_km > 400
        ? rejected('invalid_geometry', 'radius_out_of_range', 'circle.radius_km')
        : HttpResponse.json(accepted(SQUARE)),
    )
    await renderReady()
    const user = userEvent.setup()
    const set = async (lat: string, lon: string, radius: string) => {
      for (const [label, value] of [
        ['Centre latitude', lat],
        ['Centre longitude', lon],
        ['Radius (km)', radius],
      ] as const) {
        await user.clear(screen.getByLabelText(label))
        await user.type(screen.getByLabelText(label), value)
      }
      await user.click(screen.getByRole('button', { name: 'Use this circle' }))
    }

    await set('36.5', '-120.5', '25')
    await waitFor(() => {
      expect(calendarRequests).toHaveLength(2)
    })
    expect(normalizeRequests[0]).toEqual({ circle: { lat: 36.5, lon: -120.5, radius_km: 25 } })

    // A radius over 500 km never reaches the server.
    await set('36.5', '-120.5', '501')
    expect(screen.getAllByRole('alert').map((a) => a.textContent)).toContain(
      'Radius must be between 1 and 500 km.',
    )
    expect(normalizeRequests).toHaveLength(1)

    // A server rejection shows its reason and keeps the previous area and results.
    await set('36.5', '-120.5', '450')
    expect((await screen.findByTestId('area-rejection')).textContent).toMatch(
      /Radius must be between 1 and 500 km\. The previous area and its results are unchanged/,
    )
    expect(calendarRequests).toHaveLength(2)
    expect(canvasProps().selection).toEqual(SQUARE)
  })

  it('a GeoJSON file is sent as geojson and the ignored features are reported', async () => {
    useApi((b) =>
      b.geojson !== undefined && b.geojson !== null && b.geojson.type === 'Topology'
        ? rejected('invalid_geometry', 'malformed_geojson', 'geojson')
        : HttpResponse.json(accepted(SQUARE, { ignored_features: 2 })),
    )
    await renderReady()
    const user = userEvent.setup()
    const content = { type: 'FeatureCollection', features: [] }
    await user.upload(
      screen.getByLabelText('Upload GeoJSON'),
      new File([JSON.stringify(content)], 'area.geojson', { type: 'application/geo+json' }),
    )
    await waitFor(() => {
      expect(calendarRequests).toHaveLength(2)
    })
    expect(normalizeRequests[0]).toEqual({ geojson: content })
    expect((await screen.findByTestId('area-ignored')).textContent).toBe(
      '2 features in the file are not polygons and were ignored.',
    )

    // A file that is not JSON is refused in the browser; the area stays.
    await user.upload(screen.getByLabelText('Upload GeoJSON'), new File(['{nope'], 'bad.json'))
    await waitFor(() => {
      expect(
        screen
          .getAllByRole('alert')
          .map((a) => a.textContent)
          .join(' '),
      ).toMatch(/not valid JSON.*previous area and its results are unchanged/)
    })
    expect(normalizeRequests).toHaveLength(1)

    // A server rejection keeps the previous area.
    await user.upload(
      screen.getByLabelText('Upload GeoJSON'),
      new File([JSON.stringify({ type: 'Topology' })], 'topo.json'),
    )
    expect((await screen.findByTestId('area-rejection')).textContent).toMatch(/not valid GeoJSON/)
    expect(calendarRequests).toHaveLength(2)
    expect(canvasProps().selection).toEqual(SQUARE)
  })

  it('copies the area as GeoJSON', async () => {
    useApi()
    await renderReady()
    const user = userEvent.setup()
    await finishShape(SQUARE)
    await waitFor(() => {
      expect(screen.getByTestId('area-readout').textContent).toContain('7 cells')
    })
    await user.click(screen.getByRole('button', { name: 'Copy GeoJSON' }))
    expect(JSON.parse(await navigator.clipboard.readText())).toEqual(SQUARE)
    expect(screen.getByText('GeoJSON copied to the clipboard.')).toBeTruthy()
  })

  it('has no accessibility violations with the hint, and with an area and a message', async () => {
    useApi()
    const { container } = render(
      <QueryProvider client={createQueryClient()}>
        <App />
      </QueryProvider>,
    )
    await screen.findByRole('region', { name: 'Burning activity calendar' }, { timeout: 10_000 })
    expect(await axe(container)).toHaveNoViolations()
    await finishShape(SQUARE)
    await finishShape(BOWTIE, 'edit')
    await screen.findByTestId('area-rejection')
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('area in the page address', () => {
  it('writes an accepted area to the URL and clearing it removes the parameter', async () => {
    useApi()
    await renderReady()
    await finishShape(SQUARE)
    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get('a')).toBe(encodeGeometry(SQUARE))
    })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Clear' }))
    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).has('a')).toBe(false)
    })
  })
  it('restores an area from the URL through the server check, without querying the full region first', async () => {
    useApi()
    window.history.replaceState(null, '', `/?a=${encodeGeometry(SQUARE)}`)
    await renderReady()
    expect(normalizeRequests).toEqual([{ geometry: SQUARE }])
    expect(calendarRequests).toHaveLength(1)
    expect(calendarRequests[0]!.geometry).toEqual(SQUARE)
    expect(canvasProps().selection).toEqual(SQUARE)
    expect(new URLSearchParams(window.location.search).get('a')).toBe(encodeGeometry(SQUARE))
  })
  it('falls back to the full region with a notice when the server rejects the URL area', async () => {
    useApi(() => rejected('invalid_selection', 'outside_extent'))
    window.history.replaceState(null, '', `/?a=${encodeGeometry(SQUARE)}`)
    await renderReady()
    expect(calendarRequests[0]!.geometry).toBeNull()
    expect(screen.getByTestId('url-notice').textContent).toContain('area in the page address')
    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).has('a')).toBe(false)
    })
  })
  it('ignores a malformed area parameter and names it in the notice', async () => {
    useApi()
    window.history.replaceState(null, '', '/?a=%21%21')
    await renderReady()
    expect(normalizeRequests).toHaveLength(0)
    expect(calendarRequests[0]!.geometry).toBeNull()
    expect(screen.getByTestId('url-notice').textContent).toContain('a')
  })
})

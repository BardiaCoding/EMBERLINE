import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'
import type { DrawMode, ShapeAction } from '@/features/map/selectionDrawing'
import type { CalendarOut, ExampleArea, MetaOut, NormalizeOut, NormalizeRequest } from '@/lib/api'
import type { AreaGeometry } from '@/lib/areaGeometry'
import { month, result } from '@/lib/binning.fixtures'
import { QueryProvider } from '@/lib/QueryProvider'
import { createQueryClient } from '@/lib/queryClient'
import { statsResult } from '@/lib/stats.fixtures'
import { server } from '@/test/server'
import { App } from './App'

// Example areas through the whole app (requirements 11.14 to 11.17), the cases not covered by
// AreaControls.test.tsx and App.area.test.tsx. The area is not in the URL yet (task 24.1), so the
// URL write is not tested here. TEST FIXTURE values, not NASA data and not the configured areas.
type CanvasProps = {
  label: string
  selection?: AreaGeometry | null
  drawMode?: DrawMode | null
  onShapeFinished?: (geometry: AreaGeometry, action: ShapeAction) => Promise<boolean>
}
const canvas = vi.hoisted((): { latest: unknown } => ({ latest: null }))
vi.mock('@/features/map/MapCanvas', () => ({
  MapCanvas: (props: CanvasProps) => {
    canvas.latest = props
    return <div role="img" aria-label={props.label} />
  },
}))
const canvasProps = (): CanvasProps => canvas.latest as CanvasProps

const ORIGIN = window.location.origin
const box = (w: number, e: number): AreaGeometry => ({
  type: 'Polygon',
  coordinates: [
    [
      [w, 36],
      [e, 36],
      [e, 38],
      [w, 38],
      [w, 36],
    ],
  ],
})
const FIRST = box(-121, -120)
const SECOND = box(-119, -118)
const EXAMPLES: ExampleArea[] = [
  { name: 'Test area one', description: 'First synthetic description.', geometry: FIRST },
  { name: 'Test area two', description: 'Second synthetic description.', geometry: SECOND },
]
const baseMeta: MetaOut = {
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
const calendarResult: CalendarOut = result([month(2002, 7, 120.5), month(2003, 12, 33)], [])
const normalizeRequests: NormalizeRequest[] = []

function useApi(
  meta: () => Response,
  normalize: (b: NormalizeRequest) => Response = (b) =>
    HttpResponse.json({
      geometry: b.geometry as AreaGeometry,
      clipped: false,
      clipped_percent: 0,
      n_cells: 7,
      notice: null,
      ignored_features: 0,
    } satisfies NormalizeOut),
) {
  server.use(
    http.get(`${ORIGIN}/api/health`, () =>
      HttpResponse.json({ status: 'ok', data_present: true, latest_month: '2003-12' }),
    ),
    http.get(`${ORIGIN}/api/v1/meta`, meta),
    http.post(`${ORIGIN}/api/v1/calendar`, () => HttpResponse.json(calendarResult)),
    http.post(`${ORIGIN}/api/v1/stats`, () => HttpResponse.json(statsResult())),
    http.post(`${ORIGIN}/api/v1/selection/normalize`, async ({ request }) => {
      const body = (await request.json()) as NormalizeRequest
      normalizeRequests.push(body)
      return normalize(body)
    }),
  )
}
const okMeta =
  (examples: ExampleArea[] = EXAMPLES) =>
  () =>
    HttpResponse.json({ ...baseMeta, example_areas: examples })

beforeEach(() => {
  normalizeRequests.length = 0
  canvas.latest = null
  window.sessionStorage.clear()
  window.history.replaceState(null, '', '/')
})

function renderApp() {
  render(
    <QueryProvider client={createQueryClient()}>
      <App />
    </QueryProvider>,
  )
}
const ready = () =>
  screen.findByRole('region', { name: 'Burning activity calendar' }, { timeout: 10_000 })

describe('example areas in the app', () => {
  it('shows a labelled button with its description for each area from /meta', async () => {
    useApi(okMeta())
    renderApp()
    await ready()
    const button = screen.getByRole('button', { name: 'Test area two' })
    const id = button.getAttribute('aria-describedby') ?? ''
    expect(document.getElementById(id)?.textContent).toBe('Second synthetic description.')
    expect(screen.getByRole('button', { name: 'Test area one' })).toBeTruthy()
  })

  it('keeps the previous selection when the server rejects an example area', async () => {
    useApi(okMeta(), (b) =>
      JSON.stringify(b.geometry) === JSON.stringify(SECOND)
        ? HttpResponse.json(
            {
              error: {
                code: 'invalid_geometry',
                message: 'Server message.',
                fields: [{ field: 'geometry', reason: 'Not usable.' }],
                request_id: 'r1',
              },
            },
            { status: 422 },
          )
        : HttpResponse.json({
            geometry: b.geometry as AreaGeometry,
            clipped: false,
            clipped_percent: 0,
            n_cells: 7,
            notice: null,
            ignored_features: 0,
          } satisfies NormalizeOut),
    )
    renderApp()
    await ready()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Test area one' }))
    await waitFor(() => {
      expect(canvasProps().selection).toEqual(FIRST)
    })
    await user.click(screen.getByRole('button', { name: 'Test area two' }))
    await waitFor(() => {
      expect(normalizeRequests).toHaveLength(2)
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(canvasProps().selection).toEqual(FIRST)
    expect(screen.getByRole('region', { name: 'Burning activity calendar' })).toBeTruthy()
  })

  it('renders no example section when the list is empty', async () => {
    useApi(okMeta([]))
    renderApp()
    await ready()
    expect(screen.queryByRole('heading', { name: 'Example areas' })).toBeNull()
  })

  it('renders no example section when /meta fails, and leaves the other controls', async () => {
    useApi(() => HttpResponse.json({ error: { code: 'x', message: 'down' } }, { status: 500 }))
    renderApp()
    await screen.findByRole('button', { name: 'Draw polygon' }, { timeout: 10_000 })
    expect(screen.queryByRole('heading', { name: 'Example areas' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Test area one' })).toBeNull()
  })
})

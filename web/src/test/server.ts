import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
// Shared msw server. Tests add handlers with `server.use(...)`. Unhandled requests fail
// the test (see setup.ts), so no test can reach a real network or a real API.
//
// Default handler: the app asks for the hotspot layer whenever it shows the map. This empty
// synthetic layer (TEST FIXTURE, not NASA data) keeps tests that do not care about it quiet.
// A test that does care overrides it with `server.use`.
export const server = setupServer(
  http.post('*/api/v1/map-layer', () =>
    HttpResponse.json({
      mode: 'points',
      total: 0,
      max_points: 5000,
      points: [],
      cells: [],
      cell_size_deg: 0.1,
      label: 'TEST FIXTURE, not NASA data',
      time_convention: 'local standard time, UTC-8',
      month: null,
    }),
  ),
)

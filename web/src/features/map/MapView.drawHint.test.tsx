import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DRAW_HINT_STORAGE_KEY } from '@/features/area/useDrawHint'
import type { AppliedArea, AreaOrigin, AreaSelection } from '@/features/area/useAreaSelection'
import type { AreaGeometry } from '@/lib/areaGeometry'
import { MapView } from './MapView'

// jsdom has no WebGL, so the map canvas is a stub.
vi.mock('./MapCanvas', () => ({ MapCanvas: () => <div role="img" aria-label="map" /> }))

// Synthetic values. TEST FIXTURE, not NASA data.
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

function selectionWith(origin: AreaOrigin | null): AreaSelection {
  const area: AppliedArea | null =
    origin === null
      ? null
      : {
          geometry: SQUARE,
          clipped: false,
          clippedPercent: 0,
          nCells: 7,
          notice: null,
          ignoredFeatures: 0,
          origin,
        }
  return {
    area,
    shape: area === null ? null : SQUARE,
    status: 'idle',
    error: null,
    rejection: null,
    submitGeometry: vi.fn(() => Promise.resolve(true)),
    submitBbox: vi.fn(() => Promise.resolve(true)),
    submitCircle: vi.fn(() => Promise.resolve(true)),
    submitGeoJson: vi.fn(() => Promise.resolve(true)),
    retry: vi.fn(),
    clear: vi.fn(),
  }
}

describe('draw hint in the map panel (requirement 11.13)', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  it('is shown while the area is the full region', () => {
    render(<MapView selection={selectionWith(null)} />)
    expect(screen.getByRole('note')).toBeTruthy()
  })

  it('closes for the tab session when an example area is chosen', () => {
    const { rerender } = render(<MapView selection={selectionWith(null)} />)
    rerender(<MapView selection={selectionWith('example')} />)
    expect(screen.queryByRole('note')).toBeNull()
    expect(window.sessionStorage.getItem(DRAW_HINT_STORAGE_KEY)).toBe('1')
    // Back to the full region: the hint stays closed.
    rerender(<MapView selection={selectionWith(null)} />)
    expect(screen.queryByRole('note')).toBeNull()
  })
})

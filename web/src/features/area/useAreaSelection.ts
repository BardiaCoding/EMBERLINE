import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  isApiError,
  postNormalizeSelection,
  type ApiGeometry,
  type NormalizeRequest,
} from '@/lib/api'
import {
  bboxToGeometry,
  parseAreaGeometry,
  type AreaGeometry,
  type Extent,
} from '@/lib/areaGeometry'
import { geometryPrecheck } from '@/lib/geometryPrecheck'
import type { CircleInput } from './circleInput'
import { PREVIOUS_AREA_KEPT, reasonMessage } from './selectionMessages'

/** Where a Selection_Area came from. Every origin takes the same path (requirement 11.15). */
export type AreaOrigin = 'draw' | 'edit' | 'example' | 'coordinates' | 'circle' | 'upload' | 'url'

/** A Selection_Area accepted by the server: clipped polygon plus what clipping and counting found. */
export type AppliedArea = {
  geometry: AreaGeometry
  clipped: boolean
  /** Share of the submitted area removed by clipping, 0 to 100. */
  clippedPercent: number
  /** Cells whose centre lies inside the area. */
  nCells: number
  /** `no_cells` when no cell centre lies inside. */
  notice: string | null
  /** GeoJSON upload only: features that are not polygons and were left out. */
  ignoredFeatures: number
  origin: AreaOrigin
}

/** Why the last submitted area was rejected. The previous area and results stay. */
export type Rejection = {
  origin: AreaOrigin
  /** Reason code (`self_intersection`, `outside_extent`, ...), or null for an unknown one. */
  reason: string | null
  /** Plain-language message, followed by the "previous area unchanged" sentence. */
  message: string
  /** Server field errors, for example `bbox.west`. Empty for a client pre-check. */
  fields: readonly { field: string; reason: string }[]
}

export type AreaStatus = 'idle' | 'loading' | 'error'

type Pending = {
  request: NormalizeRequest
  /** The shape to show while checking. Null when the server builds it (circle, upload). */
  geometry: AreaGeometry | null
  origin: AreaOrigin
}

type State = {
  applied: AppliedArea | null
  /** The shape being checked, or the one whose check failed (kept on the map, requirement 11.9). */
  pending: Pending | null
  status: AreaStatus
  error: unknown
  rejection: Rejection | null
}

const INITIAL: State = {
  applied: null,
  pending: null,
  status: 'idle',
  error: null,
  rejection: null,
}

export type AreaSelection = {
  /** The accepted area, or null for the full region (the default). */
  area: AppliedArea | null
  /** The shape to draw on the map: the one being checked or failed, else the accepted one. */
  shape: AreaGeometry | null
  status: AreaStatus
  /** The error of the last failed check (network, timeout, server). Null otherwise. */
  error: unknown
  rejection: Rejection | null
  /**
   * Pre-checks and normalizes a drawn, edited or example shape. Resolves true when the shape
   * stays on the map (accepted, or its check failed and can be retried) and false when it was
   * rejected (the previous area is kept).
   */
  submitGeometry: (geometry: AreaGeometry, origin: AreaOrigin) => Promise<boolean>
  /** Normalizes a rectangle entered as west, south, east and north. Same result as above. */
  submitBbox: (bbox: Extent) => Promise<boolean>
  /** Normalizes a circle (centre in degrees, radius in km). The server builds the polygon. */
  submitCircle: (circle: CircleInput) => Promise<boolean>
  /** Normalizes the parsed content of an uploaded GeoJSON file. The server unions polygons. */
  submitGeoJson: (content: Record<string, unknown>) => Promise<boolean>
  /** Sends the failed request again. */
  retry: () => void
  /** Back to the full region: removes the area, any pending shape and any message. */
  clear: () => void
}

function rejectionFrom(error: unknown, origin: AreaOrigin, extent: Extent): Rejection | null {
  if (!isApiError(error) || error.status !== 422) return null
  const first = error.fields[0]
  const known = first === undefined ? null : reasonMessage(first.reason, { extent })
  return {
    origin,
    reason: first?.reason ?? null,
    message: `${known ?? error.message} ${PREVIOUS_AREA_KEPT}`,
    fields: error.fields,
  }
}

/**
 * Area selection state (requirements 11.2, 11.7 to 11.9, 11.11, 13.1 to 13.4, 13.9).
 *
 * A shape is pre-checked in the browser, then sent to `/selection/normalize`. Only an accepted
 * answer replaces the area, so a rejected shape never changes the area or its results.
 * `extent` is the region extent from `/meta`, used in the "outside the region" message.
 */
export function useAreaSelection(extent: Extent): AreaSelection {
  const [state, setState] = useState<State>(INITIAL)
  const counter = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const extentRef = useRef(extent)
  const pendingRef = useRef<Pending | null>(null)

  useEffect(() => {
    extentRef.current = extent
  }, [extent])
  useEffect(() => {
    pendingRef.current = state.pending
  }, [state.pending])
  useEffect(
    () => () => {
      controller.current?.abort()
    },
    [],
  )

  const run = useCallback(async (pending: Pending): Promise<boolean> => {
    controller.current?.abort()
    const abort = new AbortController()
    controller.current = abort
    counter.current += 1
    const id = counter.current
    setState((s) => ({ ...s, pending, status: 'loading', error: null, rejection: null }))
    try {
      const out = await postNormalizeSelection(pending.request, { signal: abort.signal })
      const geometry = parseAreaGeometry(out.geometry)
      if (id !== counter.current) return true
      if (geometry === null) throw new Error('The server returned an area that is not a polygon.')
      setState({
        applied: {
          geometry,
          clipped: out.clipped,
          clippedPercent: out.clipped_percent,
          nCells: out.n_cells,
          notice: out.notice,
          ignoredFeatures: out.ignored_features,
          origin: pending.origin,
        },
        pending: null,
        status: 'idle',
        error: null,
        rejection: null,
      })
      return true
    } catch (error) {
      if (id !== counter.current) return true
      const rejection = rejectionFrom(error, pending.origin, extentRef.current)
      if (rejection !== null) {
        // Rejected: the previous area and results stay. The drawn shape is not kept.
        setState((s) => ({ ...s, pending: null, status: 'idle', error: null, rejection }))
        return false
      }
      // Network, timeout or server error: keep the shape on the map and offer Retry.
      setState((s) => ({ ...s, pending, status: 'error', error, rejection: null }))
      return true
    }
  }, [])

  const submitGeometry = useCallback(
    (geometry: AreaGeometry, origin: AreaOrigin): Promise<boolean> => {
      const check = geometryPrecheck(geometry)
      if (!check.ok) {
        const message =
          reasonMessage(check.reason, {
            extent: extentRef.current,
            vertexCount: check.vertexCount,
          }) ?? 'The area is not valid.'
        setState((s) => ({
          ...s,
          rejection: {
            origin,
            reason: check.reason,
            message: `${message} ${PREVIOUS_AREA_KEPT}`,
            fields: [],
          },
        }))
        return Promise.resolve(false)
      }
      const body: ApiGeometry = geometry
      return run({ request: { geometry: body }, geometry, origin })
    },
    [run],
  )

  const submitBbox = useCallback(
    (bbox: Extent): Promise<boolean> =>
      run({ request: { bbox }, geometry: bboxToGeometry(bbox), origin: 'coordinates' }),
    [run],
  )

  const submitCircle = useCallback(
    (circle: CircleInput): Promise<boolean> =>
      run({ request: { circle }, geometry: null, origin: 'circle' }),
    [run],
  )

  const submitGeoJson = useCallback(
    (content: Record<string, unknown>): Promise<boolean> =>
      run({ request: { geojson: content }, geometry: null, origin: 'upload' }),
    [run],
  )

  const retry = useCallback(() => {
    const pending = pendingRef.current
    if (pending !== null) void run(pending)
  }, [run])

  const clear = useCallback(() => {
    controller.current?.abort()
    counter.current += 1
    setState(INITIAL)
  }, [])

  return useMemo(
    () => ({
      area: state.applied,
      shape: state.pending?.geometry ?? state.applied?.geometry ?? null,
      status: state.status,
      error: state.error,
      rejection: state.rejection,
      submitGeometry,
      submitBbox,
      submitCircle,
      submitGeoJson,
      retry,
      clear,
    }),
    [state, submitGeometry, submitBbox, submitCircle, submitGeoJson, retry, clear],
  )
}

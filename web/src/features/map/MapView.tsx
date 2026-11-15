import { useCallback, useEffect, useMemo, useState } from 'react'
import { AreaMessages } from '@/features/area/AreaMessages'
import { DrawControls } from '@/features/area/DrawControls'
import { DrawHint } from '@/features/area/DrawHint'
import type { AreaSelection } from '@/features/area/useAreaSelection'
import { useDrawHint } from '@/features/area/useDrawHint'
import type { AreaGeometry } from '@/lib/areaGeometry'
import { HotspotLegend } from './HotspotLegend'
import { hotspotLayerData, EMPTY_HOTSPOT_LAYER, type HotspotLayerData } from './hotspotLayer'
import { MapCanvas } from './MapCanvas'
import { useMapLayerQuery, type MapLayerOut, type MapLayerRequest } from './mapLayerApi'
import {
  CELL_SELECTION_NOTE,
  DEFAULT_REGION_NAME,
  formatExtent,
  resolveExtent,
  type Extent,
} from './extent'
import type { DrawMode, ShapeAction } from './selectionDrawing'

type MapViewProps = {
  /**
   * Region extent from the API `/meta` (see `extentFromMeta`). When missing or invalid the
   * measured DEFAULT (confirm) extent is used. Pass null while `/meta` is loading or failed.
   */
  extent?: Extent | null
  /** Region name from `/meta`. Defaults to "California region". */
  regionName?: string
  /**
   * Area selection state. When given, the map shows the draw buttons, the hint and the area
   * messages, and draws and edits the Selection_Area. Without it the map is read-only.
   */
  selection?: AreaSelection
  /**
   * Query of the hotspot layer: area, exact local dates and an optional month. When given, the
   * map shows the filtered raw detections (points, or a density layer above 20,000) with a
   * legend. Needs a TanStack Query provider. Without it the map has no hotspot layer.
   */
  hotspots?: MapLayerRequest | null
}

type LayerState = {
  data: HotspotLayerData
  layer: MapLayerOut | undefined
  loading: boolean
  error: unknown
  visible: boolean
  onVisibleChange: (visible: boolean) => void
}

/**
 * Map panel (requirements 11.1 to 11.4, 11.7 to 11.13, 11.18). Shows an interactive map with
 * the measured extent as an outline and the whole region in the first view. With no drawn
 * shape the selection is the full region, and the caption says so. The FIRMS download request
 * box is never shown.
 */
export function MapView(props: MapViewProps) {
  return props.hotspots === undefined ? (
    <MapViewBody {...props} />
  ) : (
    <MapViewWithLayer {...props} hotspots={props.hotspots} />
  )
}

function MapViewWithLayer(props: MapViewProps & { hotspots: MapLayerRequest | null }) {
  const query = useMapLayerQuery(props.hotspots)
  const [visible, setVisible] = useState(true)
  const layer = query.data
  const data = useMemo(() => hotspotLayerData(layer), [layer])
  return (
    <MapViewBody
      {...props}
      layerState={{
        data: visible ? data : EMPTY_HOTSPOT_LAYER,
        layer,
        loading: query.isFetching,
        error: query.error,
        visible,
        onVisibleChange: setVisible,
      }}
    />
  )
}

function MapViewBody({
  extent,
  regionName = DEFAULT_REGION_NAME,
  selection,
  layerState,
}: MapViewProps & { layerState?: LayerState }) {
  const west = extent?.west
  const south = extent?.south
  const east = extent?.east
  const north = extent?.north
  // Stable identity: MapCanvas refits the view only when one of the four values changes.
  const resolved = useMemo(
    () =>
      resolveExtent(
        west === undefined || south === undefined || east === undefined || north === undefined
          ? null
          : { west, south, east, north },
      ),
    [west, south, east, north],
  )
  const [drawMode, setDrawMode] = useState<DrawMode | null>(null)
  const hint = useDrawHint()
  const closeHint = hint.close
  const submitGeometry = selection?.submitGeometry
  const clear = selection?.clear

  // Choosing an example area also closes the hint for this tab session (requirement 11.13).
  const exampleChosen = selection?.area?.origin === 'example'
  useEffect(() => {
    if (exampleChosen) closeHint()
  }, [exampleChosen, closeHint])

  const onShapeFinished = useCallback(
    (geometry: AreaGeometry, action: ShapeAction): Promise<boolean> => {
      if (action === 'draw') {
        // A finished drawing leaves drawing mode and closes the hint for this tab session.
        setDrawMode(null)
        closeHint()
      }
      return (
        submitGeometry?.(geometry, action === 'draw' ? 'draw' : 'edit') ?? Promise.resolve(false)
      )
    },
    [submitGeometry, closeHint],
  )
  const onShapeDeleted = useCallback(() => {
    setDrawMode(null)
    clear?.()
  }, [clear])
  const onClear = useCallback(() => {
    setDrawMode(null)
    clear?.()
  }, [clear])

  const area = selection?.area ?? null
  const selectionText = area === null ? `full ${regionName}` : `your area (${area.nCells} cells)`

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <p data-testid="map-selection" className="text-sm font-medium">
        Current selection: {selectionText}
      </p>
      {selection !== undefined && (
        <>
          <DrawControls mode={drawMode} onModeChange={setDrawMode} onClear={onClear} />
          {hint.open && selection.shape === null && <DrawHint onDismiss={closeHint} />}
          <AreaMessages selection={selection} />
        </>
      )}
      <div className="min-h-72 flex-1">
        <MapCanvas
          extent={resolved}
          regionName={regionName}
          label={`Map of the ${regionName}. The dashed outline marks the data extent.`}
          selection={selection?.shape}
          drawMode={drawMode}
          onShapeFinished={selection === undefined ? undefined : onShapeFinished}
          onShapeDeleted={selection === undefined ? undefined : onShapeDeleted}
          hotspots={layerState?.data}
        />
      </div>
      {layerState !== undefined && (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={layerState.visible}
              onChange={(e) => {
                layerState.onVisibleChange(e.target.checked)
              }}
            />
            Show hotspot layer
          </label>
          <HotspotLegend
            layer={layerState.layer}
            loading={layerState.loading}
            error={layerState.error}
          />
        </>
      )}
      <p data-testid="map-extent" className="text-xs text-muted-foreground">
        Data extent: {formatExtent(resolved)}
      </p>
      <p data-testid="map-note" className="text-xs text-muted-foreground">
        {CELL_SELECTION_NOTE}
      </p>
    </div>
  )
}

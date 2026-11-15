import { useEffect, useRef, useState } from 'react'
import { MapLibreMap, NavigationControl, ScaleControl } from 'maplibre-gl'
import type { GeoJSONSource } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { AreaGeometry } from '@/lib/areaGeometry'
import {
  HOTSPOT_POINT_OUTLINE,
  SATELLITE_COLOURS,
  SATELLITE_FALLBACK_COLOUR,
  SELECTION_COLOUR,
} from '@/styles/palettes'
import { isDarkTheme, useIsDarkTheme } from '@/features/charts/useChartColours'
import { basemapStyleFor } from '@/features/theme/basemapStyle'
import type { HotspotLayerData } from './hotspotLayer'
import { extentBounds, extentOutlineGeoJSON, fitExtentFor, type Extent } from './extent'
import { SelectionDrawing, type DrawMode, type ShapeAction } from './selectionDrawing'

export const OUTLINE_SOURCE_ID = 'region-extent'
export const OUTLINE_LINE_LAYER_ID = 'region-extent-line'
export const HOTSPOT_POINTS_SOURCE_ID = 'hotspot-points'
export const HOTSPOT_POINTS_LAYER_ID = 'hotspot-points-circle'
export const HOTSPOT_CELLS_SOURCE_ID = 'hotspot-cells'
export const HOTSPOT_CELLS_LAYER_ID = 'hotspot-cells-fill'
export const SELECTION_SOURCE_ID = 'selection-area'
export const SELECTION_FILL_LAYER_ID = 'selection-area-fill'
export const SELECTION_LINE_LAYER_ID = 'selection-area-line'

/**
 * Outline colour. MapLibre paint values cannot read CSS variables, so the value is written
 * here as rgb() (the lint rule forbids hex only). Contrast on the light basemap is above 4.5.
 */
const OUTLINE_COLOUR = 'rgb(176, 58, 14)'

const FIT_PADDING_PX = 24

type MapCanvasProps = {
  extent: Extent
  regionName: string
  /** Accessible name of the map region. */
  label: string
  /**
   * The Selection_Area to show (the accepted one, or the shape whose check is pending or can
   * be retried). Null shows none. Ignored unless `onShapeFinished` is given.
   */
  selection?: AreaGeometry | null
  /** The active drawing mode, or null for none. */
  drawMode?: DrawMode | null
  /**
   * A shape was drawn or edited. Resolves true to keep it and false when it was rejected.
   * Giving this prop turns on drawing, editing and the Selection_Area layer.
   */
  onShapeFinished?: (geometry: AreaGeometry, action: ShapeAction) => Promise<boolean>
  /** The user deleted the shape in select mode: the area goes back to the full region. */
  onShapeDeleted?: () => void
  /**
   * Hotspot layer: filtered raw detections, not harmonized (requirement 11.5). Giving this prop
   * (also an empty layer) adds the layer when the map is created. Without it the map has none.
   */
  hotspots?: HotspotLayerData
}

/** Circle colour by satellite, as a MapLibre `match` expression. */
const POINT_COLOUR = [
  'match',
  ['get', 'satellite'],
  ...Object.entries(SATELLITE_COLOURS).flat(),
  SATELLITE_FALLBACK_COLOUR,
] as unknown as string

function selectionData(geometry: AreaGeometry | null | undefined) {
  return {
    type: 'FeatureCollection' as const,
    features:
      geometry === null || geometry === undefined
        ? []
        : [{ type: 'Feature' as const, properties: {}, geometry }],
  }
}

/**
 * Thin MapLibre wrapper. It is the only file that touches MapLibre, so tests mock this one
 * module import (jsdom has no WebGL). The map is created once. When `extent` changes the
 * outline is replaced and the view is fitted again.
 *
 * Drawing (requirement 11): when `onShapeFinished` is given, Terra Draw draws rectangles and
 * polygons and edits the accepted shape, and a layer shows the Selection_Area. Without it the
 * map is read-only and creates no Terra Draw instance.
 */
export function MapCanvas({
  extent,
  regionName,
  label,
  selection,
  drawMode,
  onShapeFinished,
  onShapeDeleted,
  hotspots,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const drawingRef = useRef<SelectionDrawing | null>(null)
  const extentRef = useRef({ extent, regionName })
  /** Re-adds layers and drawing after the basemap style was replaced (theme change). */
  const reinstallRef = useRef<(() => void) | null>(null)
  const dark = useIsDarkTheme()
  const styleDarkRef = useRef(dark)
  /** The extent the map was last fitted to, so the second effect skips the initial run. */
  const fittedRef = useRef<Extent | null>(null)
  /** Latest drawing props, read by the load handler and the Terra Draw callbacks. */
  const drawingProps = useRef({ selection, drawMode, onShapeFinished, onShapeDeleted })
  // Whether drawing is on is decided when the map is created.
  const [drawingEnabled] = useState(() => onShapeFinished !== undefined)
  const [hotspotsEnabled] = useState(() => hotspots !== undefined)
  const hotspotsRef = useRef(hotspots)

  useEffect(() => {
    drawingProps.current = { selection, drawMode, onShapeFinished, onShapeDeleted }
    hotspotsRef.current = hotspots
  })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const initial = extentRef.current
    fittedRef.current = initial.extent
    const map = new MapLibreMap({
      container,
      style: basemapStyleFor(isDarkTheme()),
      bounds: extentBounds(initial.extent),
      fitBoundsOptions: { padding: FIT_PADDING_PX },
      // The map is also reachable by keyboard (arrow keys, +/-) through MapLibre defaults.
      attributionControl: { compact: true },
    })
    mapRef.current = map
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left')
    // Adds the outline, hotspot and selection layers. `reinstallRef` calls it again after a
    // style change, because setStyle drops every source and layer.
    const installLayers = (): void => {
      const latest = extentRef.current
      map.addSource(OUTLINE_SOURCE_ID, {
        type: 'geojson',
        data: extentOutlineGeoJSON(latest.extent, latest.regionName),
      })
      map.addLayer({
        id: OUTLINE_LINE_LAYER_ID,
        type: 'line',
        source: OUTLINE_SOURCE_ID,
        paint: { 'line-color': OUTLINE_COLOUR, 'line-width': 2, 'line-dasharray': [3, 2] },
      })
      if (hotspotsEnabled && hotspotsRef.current) {
        const layer = hotspotsRef.current
        map.addSource(HOTSPOT_CELLS_SOURCE_ID, { type: 'geojson', data: layer.cells })
        map.addLayer({
          id: HOTSPOT_CELLS_LAYER_ID,
          type: 'fill',
          source: HOTSPOT_CELLS_SOURCE_ID,
          paint: { 'fill-color': ['get', 'colour'], 'fill-opacity': 0.75 },
        })
        map.addSource(HOTSPOT_POINTS_SOURCE_ID, { type: 'geojson', data: layer.points })
        map.addLayer({
          id: HOTSPOT_POINTS_LAYER_ID,
          type: 'circle',
          source: HOTSPOT_POINTS_SOURCE_ID,
          paint: {
            'circle-radius': 4,
            'circle-color': POINT_COLOUR,
            'circle-stroke-color': HOTSPOT_POINT_OUTLINE,
            'circle-stroke-width': 1,
          },
        })
      }
      if (!drawingEnabled) return
      const props = drawingProps.current
      map.addSource(SELECTION_SOURCE_ID, { type: 'geojson', data: selectionData(props.selection) })
      map.addLayer({
        id: SELECTION_FILL_LAYER_ID,
        type: 'fill',
        source: SELECTION_SOURCE_ID,
        paint: { 'fill-color': SELECTION_COLOUR, 'fill-opacity': 0.15 },
      })
      map.addLayer({
        id: SELECTION_LINE_LAYER_ID,
        type: 'line',
        source: SELECTION_SOURCE_ID,
        paint: { 'line-color': SELECTION_COLOUR, 'line-width': 3 },
      })
    }
    // Terra Draw adds its own layers, so after a style change it is created again.
    const installDrawing = (): void => {
      if (!drawingEnabled) return
      const props = drawingProps.current
      drawingRef.current?.destroy()
      const drawing = new SelectionDrawing(map, {
        onFinished: (geometry, action) =>
          drawingProps.current.onShapeFinished?.(geometry, action) ?? Promise.resolve(false),
        onDeleted: () => {
          drawingProps.current.onShapeDeleted?.()
        },
      })
      drawingRef.current = drawing
      drawing.setShape(props.selection ?? null)
      drawing.setDrawMode(props.drawMode ?? null)
    }
    reinstallRef.current = () => {
      installLayers()
      installDrawing()
    }
    map.on('load', () => {
      // Read the refs here: the extent may have changed before the style finished loading.
      installLayers()
      installDrawing()
    })
    return () => {
      drawingRef.current?.destroy()
      drawingRef.current = null
      mapRef.current = null
      map.remove()
    }
  }, [drawingEnabled, hotspotsEnabled])

  // A theme change replaces the basemap style; the layers and drawing are added again after it.
  useEffect(() => {
    const map = mapRef.current
    if (!map || styleDarkRef.current === dark) return
    styleDarkRef.current = dark
    map.setStyle(basemapStyleFor(dark), { diff: false })
    map.once('style.load', () => {
      reinstallRef.current?.()
    })
  }, [dark])
  useEffect(() => {
    extentRef.current = { extent, regionName }
    const map = mapRef.current
    if (!map || fittedRef.current === extent) return
    fittedRef.current = extent
    const source = map.getSource<GeoJSONSource>(OUTLINE_SOURCE_ID)
    void source?.setData(extentOutlineGeoJSON(extent, regionName))
    map.fitBounds(extentBounds(extent), { padding: FIT_PADDING_PX, animate: false })
  }, [extent, regionName])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !drawingEnabled) return
    const source = map.getSource<GeoJSONSource>(SELECTION_SOURCE_ID)
    void source?.setData(selectionData(selection))
    drawingRef.current?.setShape(selection ?? null)
  }, [selection, drawingEnabled])

  // Fit the view to the chosen area (or back to the region when it is cleared). The first run
  // is skipped: the map is created already fitted to the region.
  const selectionFitted = useRef<AreaGeometry | null | undefined>(selection)
  useEffect(() => {
    const map = mapRef.current
    if (!map || selectionFitted.current === selection) return
    selectionFitted.current = selection
    map.fitBounds(extentBounds(fitExtentFor(selection, extentRef.current.extent)), {
      padding: FIT_PADDING_PX,
      animate: false,
    })
  }, [selection])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !hotspotsEnabled || !hotspots) return
    void map.getSource<GeoJSONSource>(HOTSPOT_CELLS_SOURCE_ID)?.setData(hotspots.cells)
    void map.getSource<GeoJSONSource>(HOTSPOT_POINTS_SOURCE_ID)?.setData(hotspots.points)
  }, [hotspots, hotspotsEnabled])

  useEffect(() => {
    drawingRef.current?.setDrawMode(drawMode ?? null)
  }, [drawMode])

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label={label}
      data-testid="map-canvas"
      className="h-full min-h-72 w-full overflow-hidden rounded-md border border-border"
    />
  )
}

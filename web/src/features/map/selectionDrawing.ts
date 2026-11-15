import type { MapLibreMap } from 'maplibre-gl'
import {
  TerraDraw,
  TerraDrawPolygonMode,
  TerraDrawRectangleMode,
  TerraDrawSelectMode,
} from 'terra-draw'
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter'
import { parseAreaGeometry, sameGeometry, type AreaGeometry } from '@/lib/areaGeometry'
import { SELECTION_COLOUR, SELECTION_HANDLE_RING } from '@/styles/palettes'

/** The two drawing modes of requirement 11.10. */
export type DrawMode = 'rectangle' | 'polygon'
/** `draw`: a new shape was finished. `edit`: the vertices or position of the shape changed. */
export type ShapeAction = 'draw' | 'edit'

export type SelectionDrawingCallbacks = {
  /**
   * A shape was finished. Resolves true to keep it on the map and false when it was rejected
   * (an edited shape then goes back to the last accepted one).
   */
  onFinished: (geometry: AreaGeometry, action: ShapeAction) => Promise<boolean>
  /** The user deleted the shape in select mode (requirement 11.3). */
  onDeleted: () => void
}

type FeatureId = string | number
type PolygonShape = Extract<AreaGeometry, { type: 'Polygon' }>

// Select-mode finish actions that change the shape. Inserting a midpoint does not move it.
const EDIT_ACTIONS: readonly string[] = [
  'edit',
  'dragFeature',
  'dragCoordinate',
  'deleteCoordinate',
  'dragCoordinateResize',
]

const FILL_OPACITY = 0.15
const OUTLINE_WIDTH = 3
const HANDLE_WIDTH = 7

const SHAPE_STYLES = {
  fillColor: SELECTION_COLOUR,
  fillOpacity: FILL_OPACITY,
  outlineColor: SELECTION_COLOUR,
  outlineWidth: OUTLINE_WIDTH,
} as const

/**
 * Terra Draw on a MapLibre map: draws one rectangle or polygon, and edits the accepted shape in
 * select mode (requirements 11.2, 11.3). Terra Draw only holds a single Polygon. It is a
 * different object from the MapLibre layer that shows the Selection_Area, which can also be a
 * MultiPolygon.
 *
 * A finished drawing is read, removed from the Terra Draw store and handed to `onFinished`. The
 * accepted area comes back through `setShape`, so the store holds the shape only after the
 * server accepted it (or while its check can be retried).
 */
export class SelectionDrawing {
  private readonly draw: TerraDraw
  private readonly callbacks: SelectionDrawingCallbacks
  /** Id of the editable shape in the Terra Draw store. */
  private shapeId: FeatureId | null = null
  /** The last accepted shape, restored when an edit is rejected. */
  private shape: PolygonShape | null = null
  private drawMode: DrawMode | null = null
  /** True while this class changes the store itself, so those changes are not user deletes. */
  private silent = false
  private destroyed = false

  constructor(map: MapLibreMap, callbacks: SelectionDrawingCallbacks) {
    this.callbacks = callbacks
    const handles = {
      selectionPointColor: SELECTION_COLOUR,
      selectionPointOutlineColor: SELECTION_HANDLE_RING,
      selectionPointWidth: HANDLE_WIDTH,
      midPointColor: SELECTION_HANDLE_RING,
      midPointOutlineColor: SELECTION_COLOUR,
      midPointWidth: HANDLE_WIDTH - 2,
    } as const
    const editable = {
      feature: {
        draggable: true,
        coordinates: { midpoints: true, draggable: true, deletable: true },
      },
    }
    this.draw = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map }),
      modes: [
        new TerraDrawRectangleMode({ styles: SHAPE_STYLES }),
        new TerraDrawPolygonMode({
          styles: {
            ...SHAPE_STYLES,
            closingPointColor: SELECTION_COLOUR,
            closingPointOutlineColor: SELECTION_HANDLE_RING,
          },
        }),
        new TerraDrawSelectMode({
          flags: { polygon: editable, rectangle: editable },
          styles: {
            selectedPolygonColor: SELECTION_COLOUR,
            selectedPolygonFillOpacity: FILL_OPACITY,
            selectedPolygonOutlineColor: SELECTION_COLOUR,
            selectedPolygonOutlineWidth: OUTLINE_WIDTH,
            ...handles,
          },
        }),
      ],
    })
    this.draw.on('finish', this.handleFinish)
    this.draw.on('change', this.handleChange)
    this.draw.start()
  }

  /** Enters a drawing mode, or leaves it (`null`): select mode when a shape exists, else static. */
  setDrawMode(mode: DrawMode | null): void {
    this.drawMode = mode
    this.applyMode()
  }

  /**
   * Shows the accepted (or pending) Selection_Area as the editable shape. A MultiPolygon, a
   * polygon with holes, and `null` leave no editable shape. Nothing changes when the store
   * already holds the same shape.
   */
  setShape(geometry: AreaGeometry | null): void {
    if (this.destroyed) return
    this.shape = geometry?.type === 'Polygon' && geometry.coordinates.length === 1 ? geometry : null
    const current = this.shapeId === null ? null : this.read(this.shapeId)
    if (current !== null && this.shape !== null && sameGeometry(current, this.shape)) return
    this.draw.setMode('static')
    this.removeShape()
    if (this.shape !== null) {
      this.silent = true
      try {
        const [result] = this.draw.addFeatures([
          { type: 'Feature', geometry: this.shape, properties: { mode: 'polygon' } },
        ])
        this.shapeId = result?.valid === true && result.id !== undefined ? result.id : null
      } finally {
        this.silent = false
      }
    }
    this.applyMode()
  }

  /** Stops Terra Draw and removes its layers. Safe to call more than once. */
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    try {
      this.draw.stop()
    } catch {
      // The map may already be gone.
    }
  }

  private applyMode(): void {
    if (this.destroyed || !this.draw.enabled) return
    const target = this.drawMode ?? (this.shapeId === null ? 'static' : 'select')
    if (this.draw.getMode() !== target) this.draw.setMode(target)
  }

  private removeShape(): void {
    const id = this.shapeId
    this.shapeId = null
    if (id === null || !this.draw.hasFeature(id)) return
    this.silent = true
    try {
      this.draw.removeFeatures([id])
    } finally {
      this.silent = false
    }
  }

  private read(id: FeatureId): AreaGeometry | null {
    const feature = this.draw.getSnapshotFeature(id)
    return feature === undefined ? null : parseAreaGeometry(feature.geometry)
  }

  /** Puts the editable shape back to the last accepted geometry after a rejected edit. */
  private restore(): void {
    if (this.destroyed || this.shapeId === null || this.shape === null) return
    this.draw.setMode('static')
    this.silent = true
    try {
      this.draw.updateFeatureGeometry(this.shapeId, this.shape)
    } finally {
      this.silent = false
    }
    this.applyMode()
  }

  private readonly handleFinish = (id: FeatureId, context: { mode: string; action: string }) => {
    if (context.mode === 'rectangle' || context.mode === 'polygon') {
      if (context.action !== 'draw') return
      const geometry = this.read(id)
      // Remove the drawing after Terra Draw has finished with it. The accepted shape comes
      // back through `setShape`.
      setTimeout(() => {
        if (this.destroyed || !this.draw.hasFeature(id)) return
        this.silent = true
        try {
          this.draw.removeFeatures([id])
        } finally {
          this.silent = false
        }
      }, 0)
      if (geometry !== null) void this.callbacks.onFinished(geometry, 'draw')
      return
    }
    if (context.mode === 'select' && id === this.shapeId && EDIT_ACTIONS.includes(context.action)) {
      const geometry = this.read(id)
      if (geometry === null) return
      void this.callbacks.onFinished(geometry, 'edit').then((keep) => {
        if (!keep) this.restore()
      })
    }
  }

  private readonly handleChange = (ids: FeatureId[], type: string, context?: object) => {
    if (type !== 'delete' || this.silent || this.shapeId === null) return
    const fromApi = context !== undefined && 'origin' in context && context.origin === 'api'
    if (fromApi || !ids.includes(this.shapeId)) return
    this.shapeId = null
    this.shape = null
    this.callbacks.onDeleted()
  }
}

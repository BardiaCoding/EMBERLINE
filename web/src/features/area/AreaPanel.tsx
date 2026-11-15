import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { ExampleArea } from '@/lib/api'
import {
  bboxToGeometry,
  formatBbox5,
  geometryBbox,
  geometryToGeoJsonText,
  type AreaGeometry,
  type Extent,
} from '@/lib/areaGeometry'
import { CRS_LABEL } from '@/lib/format'
import { reasonMessage } from './selectionMessages'
import { serverBboxErrors } from './bboxInput'
import { serverCircleErrors } from './circleInput'
import { CircleInputs } from './CircleInputs'
import { CoordinateInputs } from './CoordinateInputs'
import { ExampleAreas } from './ExampleAreas'
import { GeoJsonUpload } from './GeoJsonUpload'
import type { AreaSelection } from './useAreaSelection'

type AreaPanelProps = {
  selection: AreaSelection
  /** Region extent from `/meta`. The readout shows it while the area is the full region. */
  regionExtent: Extent
  regionName: string
  /** `example_areas` of `/meta`. */
  exampleAreas: readonly ExampleArea[] | undefined
}

type CopyState = 'idle' | 'copied' | 'failed'

/**
 * Area controls in the control panel: example areas, coordinate, circle and file entry, and the readout of the
 * current area (bounding box to 5 decimals and "Copy GeoJSON", requirement 12.4). Messages
 * about rejected, clipped or failed areas are in `AreaMessages`, next to the map.
 */
export function AreaPanel({ selection, regionExtent, regionName, exampleAreas }: AreaPanelProps) {
  // The copy result belongs to the geometry that was copied, so it disappears when the area changes.
  const [copied, setCopied] = useState<{ geometry: AreaGeometry; state: CopyState } | null>(null)
  const { area, rejection } = selection
  const geometry = useMemo(
    () => area?.geometry ?? bboxToGeometry(regionExtent),
    [area, regionExtent],
  )
  const bbox = geometryBbox(geometry) ?? regionExtent
  const copy = copied?.geometry === geometry ? copied.state : 'idle'

  const serverErrors =
    rejection?.origin === 'coordinates'
      ? serverBboxErrors(rejection.fields, (reason) =>
          reasonMessage(reason, { extent: regionExtent }),
        )
      : undefined

  const circleErrors =
    rejection?.origin === 'circle'
      ? serverCircleErrors(rejection.fields, (reason) =>
          reasonMessage(reason, { extent: regionExtent }),
        )
      : undefined

  async function copyGeoJson() {
    try {
      await navigator.clipboard.writeText(geometryToGeoJsonText(geometry))
      setCopied({ geometry, state: 'copied' })
    } catch {
      // Clipboard access can be denied or missing (insecure page).
      setCopied({ geometry, state: 'failed' })
    }
  }

  return (
    <section aria-labelledby="area-panel-title" className="flex flex-col gap-4">
      <h2 id="area-panel-title" className="text-sm font-semibold">
        Area
      </h2>
      <div className="flex flex-col gap-1" data-testid="area-readout">
        <p className="text-sm">
          {area === null ? `Full ${regionName}` : 'Your area'}
          {area !== null && ` (${area.nCells} cells)`}
        </p>
        <p className="text-xs text-muted-foreground" data-testid="bbox-readout">
          Bounding box ({CRS_LABEL}): {formatBbox5(bbox)}
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="self-start"
          onClick={() => {
            void copyGeoJson()
          }}
        >
          Copy GeoJSON
        </Button>
        <p role="status" className="text-xs text-muted-foreground">
          {copy === 'copied' && 'GeoJSON copied to the clipboard.'}
          {copy === 'failed' && 'Could not copy. Your browser blocked clipboard access.'}
        </p>
      </div>
      <ExampleAreas
        areas={exampleAreas}
        onSelect={(geometry) => {
          void selection.submitGeometry(geometry, 'example')
        }}
      />
      <CoordinateInputs
        serverErrors={serverErrors}
        onSubmit={(next) => {
          void selection.submitBbox(next)
        }}
      />
      <CircleInputs
        serverErrors={circleErrors}
        onSubmit={(circle) => {
          void selection.submitCircle(circle)
        }}
      />
      <GeoJsonUpload
        onSubmit={(content) => {
          void selection.submitGeoJson(content)
        }}
      />
    </section>
  )
}

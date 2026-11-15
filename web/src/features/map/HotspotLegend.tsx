import { isApiError } from '@/lib/api'
import { HOTSPOT_LAYER_LABEL, legendModel } from './hotspotLayer'
import type { MapLayerOut } from './mapLayerApi'

type HotspotLegendProps = {
  layer: MapLayerOut | undefined
  loading: boolean
  error: unknown
}

function formatCount(n: number): string {
  return n.toLocaleString('en-US')
}

/**
 * Legend and status of the hotspot layer (requirement 11.5). It always states that the layer
 * shows filtered raw detections, not harmonized, and that days use UTC-8. Colour is never the
 * only signal: every swatch has a text label.
 */
export function HotspotLegend({ layer, loading, error }: HotspotLegendProps) {
  let body: React.ReactNode
  if (error !== null && error !== undefined && layer === undefined) {
    body = (
      <p role="alert" data-testid="hotspot-error">
        The hotspot layer could not be loaded
        {isApiError(error) && error.message ? `: ${error.message}` : '.'}
      </p>
    )
  } else if (layer === undefined) {
    body = (
      <p role="status" data-testid="hotspot-loading">
        {loading ? 'Loading hotspots…' : ''}
      </p>
    )
  } else {
    const model = legendModel(layer)
    body =
      model.kind === 'empty' ? (
        <p data-testid="hotspot-empty">No detections were found in this area and period.</p>
      ) : (
        <>
          <p data-testid="hotspot-summary">
            {layer.mode === 'points'
              ? `${formatCount(layer.total)} detections, one point each, coloured by satellite.`
              : `${formatCount(layer.total)} detections, above the ${formatCount(layer.max_points)} point limit. ` +
                `Shown as raw cell-days per ${layer.cell_size_deg} degree cell. ` +
                'Each cell-day is counted once per sensor family.'}
          </p>
          <ul className="flex flex-wrap gap-x-3 gap-y-1" aria-label="Hotspot legend">
            {model.items.map((item) => (
              <li key={item.label} className="flex items-center gap-1">
                <span
                  aria-hidden="true"
                  className="inline-block size-3 rounded-sm border border-border"
                  style={{ backgroundColor: item.colour }}
                />
                <span>{item.label}</span>
              </li>
            ))}
          </ul>
        </>
      )
  }
  return (
    <div data-testid="hotspot-legend" className="text-xs text-muted-foreground">
      <p data-testid="hotspot-label" className="font-medium text-foreground">
        {HOTSPOT_LAYER_LABEL}
      </p>
      {body}
      <p data-testid="hotspot-time">Days use local standard time, fixed UTC-8.</p>
    </div>
  )
}

import { Button } from '@/components/ui/button'
import { isApiError } from '@/lib/api'
import { clippingNotice, ignoredFeaturesNotice, NO_CELLS_NOTICE } from './selectionMessages'
import type { AreaSelection } from './useAreaSelection'

type AreaMessagesProps = { selection: AreaSelection }

/**
 * Status, rejection, failure and notices for the Selection_Area, shown next to the map
 * (requirements 11.7 to 11.9, 12.8, 13.1 to 13.4).
 *
 * - Rejected shape: a message with the reason. The previous area stays (requirement 13.9).
 * - Failed check: an error that says results could not be loaded, with Retry. The drawn shape
 *   stays on the map (requirement 11.9).
 * - Clipped shape: how much of the area was removed. Empty area: a notice that no cell is inside.
 *
 * The live regions stay mounted so a change is announced without moving focus.
 */
export function AreaMessages({ selection }: AreaMessagesProps) {
  const { area, status, error, rejection, retry } = selection
  const detail = isApiError(error) ? error.message : null
  const timedOut = isApiError(error) && error.kind === 'timeout'
  return (
    <div className="flex flex-col gap-2" data-testid="area-messages">
      <p role="status" className="text-sm text-muted-foreground">
        {status === 'loading' ? 'Checking your area…' : ''}
      </p>
      {rejection !== null && (
        <p
          role="alert"
          className="rounded-md border border-destructive p-2 text-sm"
          data-testid="area-rejection"
        >
          {rejection.message}
        </p>
      )}
      {status === 'error' && (
        <div
          role="alert"
          className="flex flex-col items-start gap-2 rounded-md border border-destructive p-2 text-sm"
          data-testid="area-error"
        >
          <p>
            {timedOut
              ? 'Results could not be loaded: the request timed out.'
              : 'Results could not be loaded for this area.'}{' '}
            {detail}
          </p>
          <p>Your shape stays on the map. Retry sends the same request again.</p>
          <Button type="button" size="sm" variant="outline" onClick={retry}>
            Retry
          </Button>
        </div>
      )}
      {area?.clipped === true && (
        <p role="note" className="text-sm" data-testid="area-clipped">
          {clippingNotice(area.clippedPercent)}
        </p>
      )}
      {area !== null && area.ignoredFeatures > 0 && (
        <p role="note" className="text-sm" data-testid="area-ignored">
          {ignoredFeaturesNotice(area.ignoredFeatures)}
        </p>
      )}
      {area?.notice === 'no_cells' && (
        <p role="note" className="text-sm" data-testid="area-no-cells">
          {NO_CELLS_NOTICE}
        </p>
      )}
    </div>
  )
}

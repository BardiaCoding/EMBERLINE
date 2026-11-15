import { Button } from '@/components/ui/button'
import { REGION_LABEL } from '@/lib/format'

type DrawHintProps = { onDismiss: () => void }

/**
 * Hint next to the map on how to draw a rectangle, draw a polygon and clear the shape
 * (requirement 11.13). It never takes focus. The caller shows it only while the area is the
 * full region and `useDrawHint().open` is true.
 */
export function DrawHint({ onDismiss }: DrawHintProps) {
  return (
    <div
      role="note"
      className="flex items-start gap-2 rounded-md border border-border bg-card p-3 text-sm text-card-foreground"
      data-testid="draw-hint"
    >
      <ul className="flex-1 list-disc pl-4">
        <li>Draw rectangle: choose the button, then click and drag on the map.</li>
        <li>Draw polygon: choose the button, click each corner and double-click the last one.</li>
        <li>Clear: removes your shape and returns to the full {REGION_LABEL}.</li>
      </ul>
      <Button type="button" size="sm" variant="outline" onClick={onDismiss}>
        Dismiss hint
      </Button>
    </div>
  )
}

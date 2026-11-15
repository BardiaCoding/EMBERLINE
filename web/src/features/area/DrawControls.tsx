import { Check } from 'lucide-react'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import type { DrawMode } from '@/features/map/selectionDrawing'

type DrawControlsProps = {
  mode: DrawMode | null
  onModeChange: (mode: DrawMode | null) => void
  /** Back to the full region, remove any drawn shape and leave drawing mode (requirement 11.11). */
  onClear: () => void
}

const BUTTONS: readonly { mode: DrawMode; label: string }[] = [
  { mode: 'rectangle', label: 'Draw rectangle' },
  { mode: 'polygon', label: 'Draw polygon' },
]

/**
 * "Draw rectangle", "Draw polygon" and "Clear" next to the map (requirements 11.10 to 11.12).
 * The accessible name is the visible text. The active draw button has `aria-pressed="true"`,
 * a check icon and a filled style, so the state does not depend on colour alone. Escape leaves
 * drawing mode. Drawing itself needs a pointer. Coordinate entry sets the same area from the
 * keyboard (requirement 27.5).
 */
export function DrawControls({ mode, onModeChange, onClear }: DrawControlsProps) {
  useEffect(() => {
    if (mode === null) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onModeChange(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [mode, onModeChange])

  return (
    <div role="group" aria-label="Area drawing tools" className="flex flex-wrap gap-2">
      {BUTTONS.map(({ mode: buttonMode, label }) => {
        const active = mode === buttonMode
        return (
          <Button
            key={buttonMode}
            type="button"
            size="sm"
            variant={active ? 'default' : 'outline'}
            aria-pressed={active}
            onClick={() => {
              onModeChange(active ? null : buttonMode)
            }}
          >
            {active && <Check aria-hidden="true" className="size-4" />}
            {label}
          </Button>
        )
      })}
      <Button type="button" size="sm" variant="outline" onClick={onClear}>
        Clear
      </Button>
    </div>
  )
}

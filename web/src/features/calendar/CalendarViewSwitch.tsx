import { Check } from 'lucide-react'
import { CALENDAR_VIEWS, type CalendarView } from '@/lib/binning'
import { cn } from '@/lib/utils'

type CalendarViewSwitchProps = {
  value: CalendarView
  onChange: (view: CalendarView) => void
  className?: string
}

/**
 * Switch between the counts, anomaly and month-to-month difference views (requirements 15.2,
 * 15.3). A group of toggle buttons: the active view has `aria-pressed="true"` and a check mark,
 * so it is not shown by colour alone. Tab moves between the buttons; Enter and Space select.
 */
export function CalendarViewSwitch({ value, onChange, className }: CalendarViewSwitchProps) {
  return (
    <div role="group" aria-label="Calendar view" className={cn('inline-flex gap-1', className)}>
      {CALENDAR_VIEWS.map((view) => {
        const active = view.id === value
        return (
          <button
            key={view.id}
            type="button"
            aria-pressed={active}
            onClick={() => {
              onChange(view.id)
            }}
            className={cn(
              'inline-flex min-h-8 min-w-6 items-center justify-center gap-1 rounded-md border border-input px-3 text-sm font-medium transition-colors',
              active
                ? 'bg-primary text-primary-foreground'
                : 'bg-background hover:bg-accent hover:text-accent-foreground',
            )}
          >
            {active ? <Check aria-hidden="true" className="size-4" /> : null}
            {view.label}
          </button>
        )
      })}
    </div>
  )
}

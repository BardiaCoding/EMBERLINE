import { cn } from '@/lib/utils'

/**
 * Shapes of the whole-month and provisional markers (requirements 15.12, 15.17). Drawn with
 * CSS in `currentColor`, so they take the cell's text colour and keep their contrast on any
 * fill. They are decorative: the same information is in the cell's accessible name, the
 * tooltip and the Status column of the data table.
 */

/** Triangle in the top-left corner: the Date_Range starts or ends partway through the month. */
export function WholeMonthMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-marker="whole-month"
      className={cn('absolute top-0 left-0 size-2 bg-current', className)}
      style={{ clipPath: 'polygon(0 0, 100% 0, 0 100%)' }}
    />
  )
}

/** Circle in the bottom-right corner: the month is incomplete (provisional). */
export function ProvisionalMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-marker="provisional"
      className={cn('absolute right-0.5 bottom-0.5 size-1.5 rounded-full bg-current', className)}
    />
  )
}

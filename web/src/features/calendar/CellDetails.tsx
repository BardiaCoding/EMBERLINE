import type { CellDescription } from '@/lib/binning'
import { cn } from '@/lib/utils'

type CellDetailsProps = {
  description: CellDescription
  className?: string
}

/**
 * The fields of `describeCell` as a definition list. The Calendar tooltip uses it, and so can
 * the Detail_Panel, so both show the same values (design.md section 11.4). The Month field is
 * left out because both callers show the month as their heading.
 */
export function CellDetails({ description, className }: CellDetailsProps) {
  return (
    <dl className={cn('grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5', className)}>
      {description.fields
        .filter((field) => field.key !== 'month')
        .map((field) => (
          <div key={field.key} className="contents" data-field={field.key}>
            <dt className="text-muted-foreground">{field.label}</dt>
            <dd className="text-right tabular-nums">{field.value}</dd>
          </div>
        ))}
    </dl>
  )
}

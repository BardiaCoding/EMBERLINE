import { Badge } from '@/components/ui/badge'
import type { WatchBadgeData } from '@/lib/watch'

type WatchBadgeProps = {
  data: WatchBadgeData
  className?: string
}

/**
 * Displays the current watch level for the latest complete month.
 *
 * Visual distinction:
 * - "Above normal": warning style (orange)
 * - "Within normal range": success style (green)
 * - "Not available": muted style (gray)
 *
 * Accessibility: Uses native title attribute for tooltip. For richer tooltip
 * behavior, wrap with a popover component in the parent.
 */
export function WatchBadge({ data, className }: WatchBadgeProps) {
  const variant = getVariant(data.level)

  return (
    <Badge
      variant={variant}
      className={className}
      title={data.tooltip}
      aria-label={`Watch level: ${data.level}. ${data.tooltip}`}
    >
      {data.level}
    </Badge>
  )
}

function getVariant(level: string): 'warning' | 'success' | 'muted' {
  if (level === 'Above normal') return 'warning'
  if (level === 'Within normal range') return 'success'
  return 'muted'
}

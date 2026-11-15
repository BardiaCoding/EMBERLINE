import type { ApiGeometry } from '@/lib/api'
import type { ChartQuery, StatsSlot } from './chartTypes'
import { SeasonalProfileChart } from './SeasonalProfileChart'
import { SeasonTracker } from '@/features/season/SeasonTracker'
type SeasonTabProps = ChartQuery & {
  stats: StatsSlot
  /** Selection_Area of the season tracker request, null for the full region. */
  geometry?: ApiGeometry | null
  /** Baseline period of the season tracker request, null for the default. */
  baselineYears?: [number, number] | null
}
/** Season tab: the seasonal profile and the season tracker. Loaded on demand. */
export default function SeasonTab({
  geometry = null,
  baselineYears = null,
  ...props
}: SeasonTabProps) {
  return (
    <div className="flex flex-col gap-4">
      <SeasonalProfileChart {...props} />
      <SeasonTracker
        geometry={geometry}
        start={props.range.start}
        end={props.range.end}
        baselineYears={baselineYears}
        area={props.area}
      />
    </div>
  )
}

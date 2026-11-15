import { AnomalySeriesChart } from './AnomalySeriesChart'
import type { ChartQuery, StatsSlot } from './chartTypes'
import { RankingLists } from './RankingLists'
import { YearlyBarsChart } from './YearlyBarsChart'

type TrendsTabProps = ChartQuery & { stats: StatsSlot }

/** Trends tab: yearly bars, the monthly anomaly series and the rankings. Loaded on demand. */
export default function TrendsTab(props: TrendsTabProps) {
  return (
    <div className="flex flex-col gap-4">
      <YearlyBarsChart {...props} />
      <AnomalySeriesChart {...props} />
      <RankingLists {...props} />
    </div>
  )
}

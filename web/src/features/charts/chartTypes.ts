import type { CalendarOut, StatsOut } from '@/lib/api'
import type { DateRange } from '@/lib/dates'

/** What every chart needs about the Query it shows. */
export type ChartQuery = {
  /** The Calendar result of the Query. */
  calendar: CalendarOut
  /** The Date_Range the result answers (local standard time, UTC-8). */
  range: DateRange
  /** Name or description of the Selection_Area, for example "California region". */
  area: string
}

/** The `/stats` result of the Query, or why it is not there. */
export type StatsSlot = {
  /** The stats result for the same range as the Calendar result, or undefined. */
  data: StatsOut | undefined
  isError: boolean
  error: unknown
  onRetry: () => void
}

import {
  cellStatuses,
  COUNTS_UNIT,
  formatZScore,
  type CalendarCell,
  type CalendarModel,
} from '@/lib/binning'
import {
  formatCount,
  formatPercentDifference,
  formatSignedCount,
  MISSING,
  monthName,
} from '@/lib/format'
import { cn } from '@/lib/utils'

type CalendarTableProps = {
  model: CalendarModel
  className?: string
}

const TH = 'border-b border-border px-2 py-1 text-left font-medium'
const TD = 'border-b border-border px-2 py-1'

function text(value: string | null | undefined): string {
  return value === null || value === undefined || value === '' ? MISSING : value
}

function Row({ cell }: { cell: CalendarCell }) {
  const status = cellStatuses(cell)
  const data = cell.data
  // The provisional month has no anomaly. A null percent means the baseline median is 0.
  const anomaly = cell.provisional ? null : (data?.anomaly ?? null)
  return (
    <tr data-key={cell.key}>
      <th scope="row" className={cn(TD, 'text-left font-normal')}>
        {cell.year}
      </th>
      <td className={TD}>{monthName(cell.month)}</td>
      <td className={cn(TD, 'text-right tabular-nums')}>{formatCount(cell.value)}</td>
      <td className={TD}>{text(data?.source_flag)}</td>
      <td className={TD}>{text(data?.calib_model)}</td>
      <td className={TD}>{text(data?.provenance)}</td>
      <td className={cn(TD, 'text-right tabular-nums')}>
        {data?.lower_bound === null || data?.lower_bound === undefined
          ? ''
          : formatCount(data.lower_bound)}
      </td>
      <td className={cn(TD, 'text-right tabular-nums')}>
        {data?.upper_bound === null || data?.upper_bound === undefined
          ? ''
          : formatCount(data.upper_bound)}
      </td>
      <td className={cn(TD, 'text-right tabular-nums')}>
        {cell.baselineMedian === null ? MISSING : formatCount(cell.baselineMedian)}
      </td>
      <td className={cn(TD, 'text-right tabular-nums')}>
        {anomaly === null ? MISSING : formatSignedCount(anomaly.absolute)}
      </td>
      <td className={cn(TD, 'text-right tabular-nums')}>
        {anomaly === null ? MISSING : formatPercentDifference(anomaly.percent)}
      </td>
      <td className={cn(TD, 'text-right tabular-nums')}>
        {anomaly === null ? MISSING : formatZScore(anomaly.zscore)}
      </td>
      <td className={cn(TD, 'text-right tabular-nums')}>
        {anomaly === null ? MISSING : formatCount(anomaly.percentile_rank)}
      </td>
      <td className={cn(TD, 'text-right tabular-nums')}>
        {cell.diff === null ? MISSING : formatSignedCount(cell.diff)}
      </td>
      <td className={TD}>{status.length === 0 ? 'Complete' : status.join(', ')}</td>
    </tr>
  )
}

/**
 * Data table alternative of the Calendar (requirement 15.8): one row per displayed month,
 * newest first, with the same values at the same rounding as the grid. Months with no data
 * are not listed. The Status column names the provisional, whole-month, latest-month and
 * switchover markers. The anomaly columns (absolute, percent, z-score, percentile rank), the
 * month-to-month difference and the interval bounds are in every view (requirement 15.8). The
 * percent difference of a month with baseline median 0 reads "no typical fires in this month",
 * with the absolute difference and percentile rank beside it. Bounds are empty when null.
 */
export function CalendarTable({ model, className }: CalendarTableProps) {
  const rows = model.rows.flatMap((row) =>
    [...row.cells].reverse().filter((cell) => cell.state !== 'no_data'),
  )
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full border-collapse text-sm">
        <caption className="pb-2 text-left text-muted-foreground">
          Harmonized monthly counts, {COUNTS_UNIT}. Months and years in {model.timeConvention}.
        </caption>
        <thead>
          <tr>
            <th scope="col" className={TH}>
              Year
            </th>
            <th scope="col" className={TH}>
              Month
            </th>
            <th scope="col" className={cn(TH, 'text-right')}>
              Harmonized count (cell-days, MODIS-equivalent)
            </th>
            <th scope="col" className={TH}>
              Source flag
            </th>
            <th scope="col" className={TH}>
              Calibration model
            </th>
            <th scope="col" className={TH}>
              Provenance
            </th>
            <th scope="col" className={cn(TH, 'text-right')}>
              Lower bound
            </th>
            <th scope="col" className={cn(TH, 'text-right')}>
              Upper bound
            </th>
            <th scope="col" className={cn(TH, 'text-right')}>
              Baseline median
            </th>
            <th scope="col" className={cn(TH, 'text-right')}>
              Difference from baseline median (cell-days)
            </th>
            <th scope="col" className={cn(TH, 'text-right')}>
              Percent difference
            </th>
            <th scope="col" className={cn(TH, 'text-right')}>
              Z-score
            </th>
            <th scope="col" className={cn(TH, 'text-right')}>
              Percentile rank (0 to 100)
            </th>
            <th scope="col" className={cn(TH, 'text-right')}>
              Change from previous month (cell-days)
            </th>
            <th scope="col" className={TH}>
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((cell) => (
            <Row key={cell.key} cell={cell} />
          ))}
        </tbody>
      </table>
      {rows.length === 0 ? <p className="py-2 text-muted-foreground">No months to show.</p> : null}
    </div>
  )
}

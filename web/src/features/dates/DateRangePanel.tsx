import { useId, useState, type SubmitEvent } from 'react'
import { Button } from '@/components/ui/button'
import {
  availableRecord,
  CALENDAR_PRESETS,
  EXACT_PRESETS,
  formatRecord,
  presetRange,
  PRESET_LABELS,
  validateDateRange,
  wholeMonthNote,
  type DateRange,
  type DateRangeErrors,
  type PresetId,
} from '@/lib/dates'
import { TIME_CONVENTION } from '@/lib/format'

type DateRangePanelProps = {
  /** First date of the record, `YYYY-MM-DD`, from the API `/meta` (`first_date`). */
  firstDate: string
  /** Latest month with data, `YYYY-MM`, from the API `/meta` (`latest_month`). */
  latestMonth: string
  /** Local date of the latest detection, `YYYY-MM-DD`. Null when not known. */
  latestDetectionDate?: string | null
  /** The Date_Range whose results are on screen. */
  value: DateRange
  /** Called only with a valid range. An invalid entry never reaches this callback. */
  onApply: (range: DateRange) => void
  /**
   * Called with the exact local-date range of a "last 7 days" or "last 30 days" preset,
   * or null when it is cleared. These presets apply to the Recent view and the CSV only.
   * The day presets are not shown when this is missing.
   */
  onExactRangeChange?: (range: DateRange | null) => void
}

const inputClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm aria-invalid:border-destructive'

/**
 * Date_Range selection (requirements 14.1 to 14.4, 14.6, 14.7, 14.12). Invalid entries show
 * an inline error on each bad field, send nothing, and leave the last valid range, and so the
 * results on screen, unchanged.
 */
export function DateRangePanel({
  firstDate,
  latestMonth,
  latestDetectionDate = null,
  value,
  onApply,
  onExactRangeChange,
}: DateRangePanelProps) {
  const ids = useId()
  const record = availableRecord(firstDate, latestMonth)
  const [start, setStart] = useState(value.start)
  const [end, setEnd] = useState(value.end)
  const [errors, setErrors] = useState<DateRangeErrors>({})
  const [exact, setExact] = useState<PresetId | null>(null)
  const [seen, setSeen] = useState(value)

  // The applied range changed from outside (preset, URL): show it in the fields.
  if (seen.start !== value.start || seen.end !== value.end) {
    setSeen(value)
    setStart(value.start)
    setEnd(value.end)
    setErrors({})
  }

  const hasErrors = errors.start !== undefined || errors.end !== undefined
  const note = wholeMonthNote(value)
  const exactRange = exact === null ? null : presetRange(exact, record, latestDetectionDate)

  function apply(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const result = validateDateRange(start, end, record)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    setStart(result.range.start)
    setEnd(result.range.end)
    onApply(result.range)
  }

  function choosePreset(id: PresetId) {
    const range = presetRange(id, record, latestDetectionDate)
    if (range === null) return
    setErrors({})
    setStart(range.start)
    setEnd(range.end)
    onApply(range)
  }

  function toggleExact(id: PresetId) {
    if (onExactRangeChange === undefined) return
    if (exact === id) {
      setExact(null)
      onExactRangeChange(null)
      return
    }
    const range = presetRange(id, record, latestDetectionDate)
    if (range === null) return
    setExact(id)
    onExactRangeChange(range)
  }

  const startErrorId = `${ids}-start-error`
  const endErrorId = `${ids}-end-error`
  const hintId = `${ids}-hint`

  return (
    <section aria-labelledby={`${ids}-title`} className="flex flex-col gap-3">
      <h2 id={`${ids}-title`} className="text-sm font-semibold">
        Date range
      </h2>
      <form onSubmit={apply} noValidate className="flex flex-col gap-3">
        <p id={hintId} className="text-xs text-muted-foreground">
          Dates are YYYY-MM-DD, {TIME_CONVENTION}, both days included. The record runs from{' '}
          {formatRecord(record)}.
        </p>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${ids}-start`} className="text-sm font-medium">
            Start date
          </label>
          <input
            id={`${ids}-start`}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="YYYY-MM-DD"
            className={inputClass}
            value={start}
            onChange={(e) => {
              setStart(e.target.value)
            }}
            aria-invalid={errors.start !== undefined}
            aria-describedby={errors.start !== undefined ? `${hintId} ${startErrorId}` : hintId}
          />
          {errors.start !== undefined && (
            <p id={startErrorId} role="alert" className="text-sm text-destructive">
              {errors.start}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${ids}-end`} className="text-sm font-medium">
            End date
          </label>
          <input
            id={`${ids}-end`}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="YYYY-MM-DD"
            className={inputClass}
            value={end}
            onChange={(e) => {
              setEnd(e.target.value)
            }}
            aria-invalid={errors.end !== undefined}
            aria-describedby={errors.end !== undefined ? `${hintId} ${endErrorId}` : hintId}
          />
          {errors.end !== undefined && (
            <p id={endErrorId} role="alert" className="text-sm text-destructive">
              {errors.end}
            </p>
          )}
        </div>
        <Button type="submit" size="sm" className="self-start">
          Apply date range
        </Button>
      </form>

      {hasErrors && (
        <p className="text-sm text-muted-foreground" data-testid="previous-range">
          Still showing results for {value.start} to {value.end} ({TIME_CONVENTION}).
        </p>
      )}

      <div role="group" aria-label="Date range presets" className="flex flex-wrap gap-2">
        {CALENDAR_PRESETS.map((id) => (
          <Button
            key={id}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              choosePreset(id)
            }}
          >
            {PRESET_LABELS[id]}
          </Button>
        ))}
      </div>

      {onExactRangeChange !== undefined && (
        <div className="flex flex-col gap-2">
          <div
            role="group"
            aria-label="Presets for the Recent view and the CSV"
            className="flex flex-wrap gap-2"
          >
            {EXACT_PRESETS.map((id) => (
              <Button
                key={id}
                type="button"
                variant="outline"
                size="sm"
                aria-pressed={exact === id}
                disabled={presetRange(id, record, latestDetectionDate) === null}
                onClick={() => {
                  toggleExact(id)
                }}
              >
                {PRESET_LABELS[id]}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Last 7 days and last 30 days apply to the Recent view and the hotspot CSV only. The
            Calendar and statistics keep their whole-month range.
            {exactRange !== null && (
              <>
                {' '}
                Exact dates: {exactRange.start} to {exactRange.end} ({TIME_CONVENTION}).
              </>
            )}
          </p>
        </div>
      )}

      {note !== null && (
        <p role="note" className="text-sm" data-testid="whole-month-note">
          {note}
        </p>
      )}
    </section>
  )
}

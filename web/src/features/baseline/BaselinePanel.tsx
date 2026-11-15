import { useId, useState, type SubmitEvent } from 'react'
import { Button } from '@/components/ui/button'
import {
  baselineLabel,
  MAX_BASELINE_YEARS,
  MIN_BASELINE_YEARS,
  validateBaselineInput,
  type Baseline,
  type YearBounds,
} from './baselineYears'
type BaselinePanelProps = {
  /** First and last complete in-record year, from `completeYearBounds`. */
  bounds: YearBounds
  /** The baseline whose results are on screen, null for the default (full record). */
  value: Baseline | null
  /** Called only with a baseline that passed the checks here (the server checks it again). */
  onApply: (baseline: Baseline | null) => void
  /** Message of the last baseline the server rejected. The previous baseline stays applied. */
  serverError?: string | null
}
const inputClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm aria-invalid:border-destructive'
/**
 * Custom baseline period (requirements 10.2, 10.10): first and last year, 5 to 30 complete
 * years. An invalid entry shows an inline error, sends nothing and leaves the applied baseline
 * and the results unchanged. A baseline the server rejects shows its message and the previous
 * baseline stays applied.
 */
export function BaselinePanel({ bounds, value, onApply, serverError = null }: BaselinePanelProps) {
  const ids = useId()
  const [first, setFirst] = useState(String(value?.[0] ?? bounds.first))
  const [last, setLast] = useState(String(value?.[1] ?? bounds.last))
  const [localError, setLocalError] = useState<string | null>(null)
  const [seen, setSeen] = useState(value)
  // The applied baseline changed from outside (address, rejection): show it in the fields.
  if (seen?.[0] !== value?.[0] || seen?.[1] !== value?.[1]) {
    setSeen(value)
    setFirst(String(value?.[0] ?? bounds.first))
    setLast(String(value?.[1] ?? bounds.last))
  }
  const error = localError ?? serverError
  const errorId = `${ids}-error`
  function apply(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const result = validateBaselineInput(first, last, bounds)
    if (!result.ok) {
      setLocalError(result.error)
      return
    }
    setLocalError(null)
    onApply(result.baseline)
  }
  return (
    <form
      onSubmit={apply}
      noValidate
      aria-labelledby={`${ids}-title`}
      className="flex flex-col gap-2"
      data-testid="baseline-panel"
    >
      <h2 id={`${ids}-title`} className="text-sm font-semibold">
        Baseline period
      </h2>
      <p className="text-sm text-muted-foreground" data-testid="baseline-current">
        {baselineLabel(value)}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${ids}-first`} className="text-sm font-medium">
            First year
          </label>
          <input
            id={`${ids}-first`}
            className={inputClass}
            inputMode="numeric"
            value={first}
            aria-invalid={error !== null}
            aria-describedby={error !== null ? errorId : `${ids}-hint`}
            onChange={(event) => {
              setFirst(event.target.value)
              setLocalError(null)
            }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${ids}-last`} className="text-sm font-medium">
            Last year
          </label>
          <input
            id={`${ids}-last`}
            className={inputClass}
            inputMode="numeric"
            value={last}
            aria-invalid={error !== null}
            aria-describedby={error !== null ? errorId : `${ids}-hint`}
            onChange={(event) => {
              setLast(event.target.value)
              setLocalError(null)
            }}
          />
        </div>
      </div>
      <p id={`${ids}-hint`} className="text-xs text-muted-foreground">
        {MIN_BASELINE_YEARS} to {MAX_BASELINE_YEARS} complete years, {bounds.first} to {bounds.last}
        . The median, percentiles and anomalies are computed from these years.
      </p>
      {error !== null ? (
        <p
          id={errorId}
          role="alert"
          className="text-sm text-destructive"
          data-testid="baseline-error"
        >
          {error}
          {serverError !== null && localError === null
            ? ' The previous baseline period is still applied.'
            : ''}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit">Apply baseline</Button>
        <Button
          type="button"
          variant="outline"
          disabled={value === null}
          onClick={() => {
            setLocalError(null)
            onApply(null)
          }}
        >
          Use full record
        </Button>
      </div>
    </form>
  )
}

import { useId, useState, type SubmitEvent } from 'react'
import { Button } from '@/components/ui/button'
import {
  CIRCLE_FIELDS,
  EMPTY_CIRCLE_TEXT,
  validateCircleText,
  type CircleErrors,
  type CircleField,
  type CircleInput,
  type CircleText,
} from './circleInput'

type CircleInputsProps = {
  /** Called only with a valid circle. Invalid entries never reach it. */
  onSubmit: (circle: CircleInput) => void
  /** Messages from the server for fields it rejected (for example a radius it refused). */
  serverErrors?: CircleErrors
}

const LABELS: Record<CircleField, string> = {
  lat: 'Centre latitude',
  lon: 'Centre longitude',
  radius_km: 'Radius (km)',
}

const inputClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm aria-invalid:border-destructive'

/**
 * Circle entry: centre latitude and longitude in decimal degrees (EPSG:4326) and a radius of 1
 * to 500 km (requirements 12.1, 13.5). The server turns it into a 64-vertex polygon. Invalid
 * entries show an inline error per field, send nothing and keep what the user typed, so the
 * previous area stays (requirement 13.9).
 */
export function CircleInputs({ onSubmit, serverErrors }: CircleInputsProps) {
  const ids = useId()
  const [text, setText] = useState<CircleText>({ ...EMPTY_CIRCLE_TEXT })
  const [errors, setErrors] = useState<CircleErrors>({})
  const hintId = `${ids}-hint`
  const shown: CircleErrors = { ...serverErrors, ...errors }

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const result = validateCircleText(text)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    onSubmit(result.circle)
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-labelledby={`${ids}-title`}
      className="flex flex-col gap-3"
    >
      <h3 id={`${ids}-title`} className="text-sm font-semibold">
        Enter a circle
      </h3>
      <p id={hintId} className="text-xs text-muted-foreground">
        Centre in decimal degrees, EPSG:4326. Radius from 1 to 500 km.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {CIRCLE_FIELDS.map((field) => {
          const error = shown[field]
          const inputId = `${ids}-${field}`
          const errorId = `${inputId}-error`
          return (
            <div key={field} className="flex flex-col gap-1">
              <label htmlFor={inputId} className="text-sm font-medium">
                {LABELS[field]}
              </label>
              <input
                id={inputId}
                name={field}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                className={inputClass}
                value={text[field]}
                onChange={(event) => {
                  setText((previous) => ({ ...previous, [field]: event.target.value }))
                }}
                aria-invalid={error !== undefined}
                aria-describedby={error === undefined ? hintId : `${hintId} ${errorId}`}
              />
              {error !== undefined && (
                <p id={errorId} role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
          )
        })}
      </div>
      <Button type="submit" size="sm" className="self-start">
        Use this circle
      </Button>
    </form>
  )
}

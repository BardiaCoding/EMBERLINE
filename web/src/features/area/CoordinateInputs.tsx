import { useId, useState, type SubmitEvent } from 'react'
import { Button } from '@/components/ui/button'
import type { Extent } from '@/lib/areaGeometry'
import {
  BBOX_FIELDS,
  EMPTY_BBOX_TEXT,
  validateBboxText,
  type BboxErrors,
  type BboxField,
  type BboxText,
} from './bboxInput'

type CoordinateInputsProps = {
  /** Called only with a valid rectangle. Invalid entries never reach it. */
  onSubmit: (bbox: Extent) => void
  /** Messages from the server for fields it rejected (for example `outside_extent`). */
  serverErrors?: BboxErrors
}

const LABELS: Record<BboxField, string> = {
  west: 'West (longitude)',
  south: 'South (latitude)',
  east: 'East (longitude)',
  north: 'North (latitude)',
}

const inputClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm aria-invalid:border-destructive'

/**
 * West, south, east and north entry in decimal degrees, EPSG:4326 (requirements 12.2, 12.6,
 * 13.5, 13.7, 27.5). It is the keyboard and screen reader equivalent of drawing a rectangle.
 * Invalid entries show an inline error on each bad field, send nothing, and keep what the user
 * typed, so the previous area and its results stay unchanged (requirement 13.9).
 */
export function CoordinateInputs({ onSubmit, serverErrors }: CoordinateInputsProps) {
  const ids = useId()
  const [text, setText] = useState<BboxText>({ ...EMPTY_BBOX_TEXT })
  const [errors, setErrors] = useState<BboxErrors>({})
  const hintId = `${ids}-hint`
  const shown: BboxErrors = { ...serverErrors, ...errors }

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const result = validateBboxText(text)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    onSubmit(result.bbox)
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-labelledby={`${ids}-title`}
      className="flex flex-col gap-3"
    >
      <h3 id={`${ids}-title`} className="text-sm font-semibold">
        Enter coordinates
      </h3>
      <p id={hintId} className="text-xs text-muted-foreground">
        Decimal degrees, EPSG:4326. Longitude is west to east (-180 to 180), latitude is south to
        north (-90 to 90).
      </p>
      <div className="grid grid-cols-2 gap-3">
        {BBOX_FIELDS.map((field) => {
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
        Use these coordinates
      </Button>
    </form>
  )
}

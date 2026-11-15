// Validation of the circle entry: centre latitude and longitude plus radius (requirements 12.1,
// 13.5). Pure functions. Checks match the server (`hotspots.geometry`): latitude -90 to 90,
// longitude -180 to 180, radius 1 to 500 km inclusive.
import type { CircleRequest } from '@/lib/api'

export const CIRCLE_FIELDS = ['lat', 'lon', 'radius_km'] as const
export type CircleField = (typeof CIRCLE_FIELDS)[number]
export type CircleText = Record<CircleField, string>
export type CircleErrors = Partial<Record<CircleField, string>>
export type CircleInput = CircleRequest

export const EMPTY_CIRCLE_TEXT: Readonly<CircleText> = { lat: '', lon: '', radius_km: '' }

export const MIN_RADIUS_KM = 1
export const MAX_RADIUS_KM = 500

export const CIRCLE_NOT_A_NUMBER = 'Enter a number, for example 36.5.'
const RANGE_TEXT: Record<CircleField, string> = {
  lat: 'Latitude must be between -90 and 90.',
  lon: 'Longitude must be between -180 and 180.',
  radius_km: `Radius must be between ${MIN_RADIUS_KM} and ${MAX_RADIUS_KM} km.`,
}

/** A plain decimal number, with an ASCII minus or plus sign. No exponents and no text. */
const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)$/

function parse(text: string): number | null {
  const trimmed = text.trim()
  if (!DECIMAL.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}

function inRange(field: CircleField, value: number): boolean {
  if (field === 'lat') return Math.abs(value) <= 90
  if (field === 'lon') return Math.abs(value) <= 180
  return value >= MIN_RADIUS_KM && value <= MAX_RADIUS_KM
}

export type CircleValidation =
  { ok: true; circle: CircleInput } | { ok: false; errors: CircleErrors }

/** Validates the three entries. Every invalid field gets its own message. */
export function validateCircleText(text: CircleText): CircleValidation {
  const errors: CircleErrors = {}
  const values: Partial<Record<CircleField, number>> = {}
  for (const field of CIRCLE_FIELDS) {
    const value = parse(text[field])
    if (value === null) errors[field] = CIRCLE_NOT_A_NUMBER
    else if (!inRange(field, value)) errors[field] = RANGE_TEXT[field]
    else values[field] = value
  }
  const { lat, lon, radius_km: radius } = values
  if (
    Object.keys(errors).length > 0 ||
    lat === undefined ||
    lon === undefined ||
    radius === undefined
  ) {
    return { ok: false, errors }
  }
  return { ok: true, circle: { lat, lon, radius_km: radius } }
}

/** Server field errors (`circle.lat`, ...) as messages for the matching inputs. */
export function serverCircleErrors(
  fields: readonly { field: string; reason: string }[],
  messageFor: (reason: string) => string | null,
): CircleErrors {
  const errors: CircleErrors = {}
  for (const { field, reason } of fields) {
    const name = field.startsWith('circle.') ? field.slice('circle.'.length) : null
    const key = CIRCLE_FIELDS.find((f) => f === name)
    const message = messageFor(reason)
    if (key !== undefined && message !== null) errors[key] = message
  }
  return errors
}

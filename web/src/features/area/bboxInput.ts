// Validation of the west, south, east and north entry (requirements 12.2, 12.6, 13.5, 13.7).
// Pure functions. Values are decimal degrees, EPSG:4326. Checks match the server
// (`hotspots.api.routes.selection.bbox_geometry`): ranges first, then the order of each pair.
import type { Extent } from '@/lib/areaGeometry'

export const BBOX_FIELDS = ['west', 'south', 'east', 'north'] as const
export type BboxField = (typeof BBOX_FIELDS)[number]
export type BboxText = Record<BboxField, string>
export type BboxErrors = Partial<Record<BboxField, string>>

export const EMPTY_BBOX_TEXT: Readonly<BboxText> = { west: '', south: '', east: '', north: '' }

const LIMIT: Record<BboxField, number> = { west: 180, east: 180, south: 90, north: 90 }
const RANGE_TEXT: Record<BboxField, string> = {
  west: 'Longitude must be between -180 and 180.',
  east: 'Longitude must be between -180 and 180.',
  south: 'Latitude must be between -90 and 90.',
  north: 'Latitude must be between -90 and 90.',
}

/** Message for a field that is empty or not a number. */
export const NOT_A_NUMBER = 'Enter a number in decimal degrees, for example -120.5.'
export const WEST_BEFORE_EAST = 'West must be less than east.'
export const SOUTH_BEFORE_NORTH = 'South must be less than north.'

/** A plain decimal number, with an ASCII minus or plus sign. No exponents and no text. */
const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)$/

function parseDegrees(text: string): number | null {
  const trimmed = text.trim()
  if (!DECIMAL.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}

export type BboxValidation = { ok: true; bbox: Extent } | { ok: false; errors: BboxErrors }

/**
 * Validates the four entries. Every invalid field gets its own message: not a number, outside
 * its allowed range, or on the wrong side of its partner (west not less than east, south not
 * less than north). The order of a pair is checked only when all four numbers are in range.
 */
export function validateBboxText(text: BboxText): BboxValidation {
  const errors: BboxErrors = {}
  const values: Partial<Record<BboxField, number>> = {}
  for (const field of BBOX_FIELDS) {
    const value = parseDegrees(text[field])
    if (value === null) errors[field] = NOT_A_NUMBER
    else if (Math.abs(value) > LIMIT[field]) errors[field] = RANGE_TEXT[field]
    else values[field] = value
  }
  const { west, south, east, north } = values
  if (Object.keys(errors).length === 0 && west !== undefined && south !== undefined) {
    if (east !== undefined && west >= east) {
      errors.west = WEST_BEFORE_EAST
      errors.east = WEST_BEFORE_EAST
    }
    if (north !== undefined && south >= north) {
      errors.south = SOUTH_BEFORE_NORTH
      errors.north = SOUTH_BEFORE_NORTH
    }
  }
  if (
    Object.keys(errors).length > 0 ||
    west === undefined ||
    south === undefined ||
    east === undefined ||
    north === undefined
  ) {
    return { ok: false, errors }
  }
  return { ok: true, bbox: { west, south, east, north } }
}

/** Server field errors (`bbox.west`, ...) as messages for the matching inputs. */
export function serverBboxErrors(
  fields: readonly { field: string; reason: string }[],
  messageFor: (reason: string) => string | null,
): BboxErrors {
  const errors: BboxErrors = {}
  for (const { field, reason } of fields) {
    const name = field.startsWith('bbox.') ? field.slice('bbox.'.length) : null
    const key = BBOX_FIELDS.find((f) => f === name)
    const message = messageFor(reason)
    if (key !== undefined && message !== null) errors[key] = message
  }
  return errors
}

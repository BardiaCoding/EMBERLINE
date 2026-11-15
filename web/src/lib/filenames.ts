// Safe download file names (requirement 18.3). Mirrors `sanitize_filename` and
// `export_filename` in `src/hotspots/export/filenames.py`: only ASCII letters, digits,
// hyphens and underscores, at most MAX_STEM_CHARS before the extension.

/** Most characters allowed before the file extension. */
export const MAX_STEM_CHARS = 100
/** Used when nothing is left after cleaning. */
export const FALLBACK_STEM = 'export'

const UNSAFE_RUN = /[^A-Za-z0-9_-]+/g
const EXTENSION = /^[a-z0-9]{1,10}$/

function trimEdges(text: string): string {
  return text.replace(/^[-_]+/, '').replace(/[-_]+$/, '')
}

/**
 * Reduce `text` to letters, digits, hyphens and underscores, at most `maxChars` long.
 * Accents are folded to ASCII where possible; every other run of characters becomes one hyphen.
 */
export function sanitizeFilename(text: string, maxChars: number = MAX_STEM_CHARS): string {
  if (maxChars < 1) throw new RangeError('maxChars must be at least 1')
  // NFKD splits accents off their letters; the non-ASCII remainder is dropped.
  // eslint-disable-next-line no-control-regex
  const folded = text.normalize('NFKD').replace(/[^\x00-\x7F]/g, '')
  const cleaned = trimEdges(trimEdges(folded.replace(UNSAFE_RUN, '-')).slice(0, maxChars))
  return cleaned === '' ? FALLBACK_STEM.slice(0, maxChars) : cleaned
}

/**
 * `<kind>_<area>_<start>_<end>.<extension>`. Dates are `YYYY-MM-DD` (local standard time,
 * UTC-8). The area part is shortened first when the name would pass MAX_STEM_CHARS.
 */
export function exportFilename(
  kind: string,
  areaName: string,
  start: string,
  end: string,
  extension: string,
): string {
  if (!EXTENSION.test(extension)) {
    throw new RangeError('extension must be 1 to 10 lowercase letters or digits')
  }
  const kindPart = sanitizeFilename(kind, 30)
  const datesPart = `${start}_${end}`
  const room = MAX_STEM_CHARS - kindPart.length - datesPart.length - 2
  const areaPart = sanitizeFilename(areaName, Math.max(room, 1))
  const stem = sanitizeFilename(`${kindPart}_${areaPart}_${datesPart}`)
  return `${stem}.${extension}`
}

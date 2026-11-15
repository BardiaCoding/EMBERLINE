// Reading an uploaded GeoJSON file in the browser (requirements 12.5, 12.7). The file is
// checked for size and JSON syntax here; its shapes are checked by the server, which unions the
// polygon features and counts the others as ignored.

/** Largest accepted file: 5 MB (requirement 12.5). */
export const MAX_GEOJSON_BYTES = 5 * 1024 * 1024

export type GeoJsonReadFailure = 'too_large' | 'not_json' | 'not_object' | 'unreadable'

export const GEOJSON_FILE_MESSAGES: Record<GeoJsonReadFailure, string> = {
  too_large: 'The file is larger than 5 MB. Choose a smaller GeoJSON file.',
  not_json: 'The file is not valid JSON. Choose a GeoJSON file.',
  not_object: 'The file is not GeoJSON: it must hold one JSON object.',
  unreadable: 'The file could not be read. Try again or choose another file.',
}

export type GeoJsonRead =
  | { ok: true; content: Record<string, unknown> }
  | { ok: false; reason: GeoJsonReadFailure; message: string }

function fail(reason: GeoJsonReadFailure): GeoJsonRead {
  return { ok: false, reason, message: GEOJSON_FILE_MESSAGES[reason] }
}

function readText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      resolve(typeof reader.result === 'string' ? reader.result : '')
    }
    reader.onerror = () => {
      reject(new Error('read failed'))
    }
    reader.readAsText(file)
  })
}

/** Reads and parses a GeoJSON file. Nothing is sent anywhere; the result is checked locally. */
export async function readGeoJsonFile(file: File): Promise<GeoJsonRead> {
  if (file.size > MAX_GEOJSON_BYTES) return fail('too_large')
  let text: string
  try {
    text = await readText(file)
  } catch {
    return fail('unreadable')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return fail('not_json')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return fail('not_object')
  }
  return { ok: true, content: parsed as Record<string, unknown> }
}

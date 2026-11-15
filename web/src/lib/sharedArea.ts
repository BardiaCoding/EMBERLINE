// Opens the area behind a short link (`s=`, requirements 19.2 and 19.8).
import { getShare, isApiError } from './api'
import { parseAreaGeometry, type AreaGeometry } from './areaGeometry'

export type SharedAreaResult = { ok: true; geometry: AreaGeometry } | { ok: false; notice: string }

/**
 * Reads the stored area of share id `id`. Never throws: a failure becomes a notice that names
 * the rejected parameter (`s`) and the reason, and the caller shows the full region.
 */
export async function resolveSharedArea(id: string): Promise<SharedAreaResult> {
  try {
    const stored = await getShare(id)
    const geometry = parseAreaGeometry(stored.geometry)
    if (geometry !== null) return { ok: true, geometry }
    return {
      ok: false,
      notice:
        'The shared area link (s) could not be used because the stored area is not valid, so the full region is shown.',
    }
  } catch (error) {
    const gone = isApiError(error) && error.status === 404
    return {
      ok: false,
      notice: gone
        ? 'The shared area link (s) could not be opened because it is unknown or has expired (links last 30 days), so the full region is shown.'
        : 'The shared area link (s) could not be opened because the server did not answer, so the full region is shown.',
    }
  }
}

import { isApiError } from '@/lib/api'

/** True when the health endpoint answered 503: the delivered data are missing or unreadable (requirement 32.7). */
export function isDataUnavailable(error: unknown): boolean {
  return isApiError(error) && error.kind === 'http' && error.status === 503
}

import { keepPreviousData, QueryClient } from '@tanstack/react-query'

/** Results of a finished Query stay fresh for the whole browser session (Req 28.4). */
export const QUERY_STALE_TIME_MS = Infinity

/**
 * Creates the app's QueryClient.
 * - `placeholderData: keepPreviousData` keeps the previous results on screen, dimmed and
 *   labelled "Updating", while a new Query loads (Req 28.5, 28.7).
 * - No automatic retries: a failure or 30 s timeout shows the error and a manual Retry (Req 26.5, 28.6).
 * - `staleTime` is infinite so returning to a completed Query makes no new request (Req 28.4).
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        placeholderData: keepPreviousData,
        staleTime: QUERY_STALE_TIME_MS,
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  })
}

import fc from 'fast-check'
import { afterAll, afterEach, beforeAll, expect } from 'vitest'
import * as axeMatchers from 'vitest-axe/matchers'
import { server } from './server'

// Property tests: 100 runs with a fixed seed (tasks.md conventions).
fc.configureGlobal({ numRuns: 100, seed: 2026 })

// vitest-axe: adds `expect(results).toHaveNoViolations()`.
expect.extend(axeMatchers)

// msw: any request without a handler fails the test.
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
})
afterEach(() => {
  server.resetHandlers()
})
afterAll(() => {
  server.close()
})

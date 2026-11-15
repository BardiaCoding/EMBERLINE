// vitest-axe 0.1.0 types the matcher on the old `Vi` namespace, which Vitest 4 no longer
// reads. This declares `toHaveNoViolations` on Vitest's own Assertion interface.
import 'vitest'

declare module 'vitest' {
  // The type parameter must match Vitest's own declaration.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  interface Assertion<T = any> {
    toHaveNoViolations(): void
  }
}

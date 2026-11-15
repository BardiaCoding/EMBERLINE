type StatusAnnouncerProps = {
  /** Text to announce. An empty string announces nothing. */
  message: string
}

/**
 * Status live region (requirements 27.8, 28.9). Visually hidden, polite, and never takes
 * focus, so a status change does not move the keyboard position. Keep it mounted: screen
 * readers only announce changes inside a region that already exists.
 */
export function StatusAnnouncer({ message }: StatusAnnouncerProps) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </div>
  )
}

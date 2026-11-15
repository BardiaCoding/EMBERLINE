import * as Popover from '@radix-ui/react-popover'
import { Info } from 'lucide-react'
import { helpText, type HelpKey } from '@/lib/helpText'
import { cn } from '@/lib/utils'

type InfoControlProps = {
  /** Which help sentence to show. */
  helpKey: HelpKey
  /** Visible term name, used in the accessible name "About {term}". */
  term: string
  className?: string
}

/**
 * Info button that opens a popover with the help sentence for one term (requirement 15.20).
 * Enter or Space opens it (native button activation), Escape closes it and focus returns
 * to the button. The button has `aria-expanded`, set by Radix.
 */
export function InfoControl({ helpKey, term, className }: InfoControlProps) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`About ${term}`}
          className={cn(
            'inline-flex min-h-6 min-w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground',
            className,
          )}
        >
          <Info aria-hidden="true" className="size-4" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          aria-label={term}
          side="bottom"
          align="start"
          sideOffset={4}
          className="z-50 max-w-xs rounded-md border border-border bg-popover p-3 text-sm text-popover-foreground shadow-md"
        >
          <p>{helpText(helpKey)}</p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

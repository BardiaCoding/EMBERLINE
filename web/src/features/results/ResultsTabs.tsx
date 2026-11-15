import { useRef, type KeyboardEvent } from 'react'
import { cn } from '@/lib/utils'
import { panelElementId, RESULT_TABS, tabElementId, type ResultsTabId } from './resultTabs'

type ResultsTabsProps = {
  value: ResultsTabId
  onChange: (tab: ResultsTabId) => void
  /** Prefix of the element ids: tab `{prefix}-tab-{id}`, panel `{prefix}-panel-{id}`. */
  idPrefix: string
  className?: string
}

/**
 * Tab list of the results panel (WAI-ARIA tabs pattern). One tab stop: the selected tab.
 * Left and right arrows, Home and End move to a tab and select it, which shows its panel.
 * The selected tab has `aria-selected` and a heavier underline, so it is not shown by colour
 * alone. Tab moves on to the panel.
 */
export function ResultsTabs({ value, onChange, idPrefix, className }: ResultsTabsProps) {
  const refs = useRef(new Map<ResultsTabId, HTMLButtonElement>())

  const select = (index: number): void => {
    const count = RESULT_TABS.length
    const tab = RESULT_TABS[((index % count) + count) % count]
    if (tab === undefined) return
    onChange(tab.id)
    refs.current.get(tab.id)?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    switch (event.key) {
      case 'ArrowRight':
        select(index + 1)
        break
      case 'ArrowLeft':
        select(index - 1)
        break
      case 'Home':
        select(0)
        break
      case 'End':
        select(RESULT_TABS.length - 1)
        break
      default:
        return
    }
    event.preventDefault()
  }

  return (
    <div
      role="tablist"
      aria-label="Results views"
      className={cn('flex gap-1 border-b border-border', className)}
    >
      {RESULT_TABS.map((tab, index) => {
        const selected = tab.id === value
        return (
          <button
            key={tab.id}
            ref={(element) => {
              if (element === null) refs.current.delete(tab.id)
              else refs.current.set(tab.id, element)
            }}
            type="button"
            role="tab"
            id={tabElementId(idPrefix, tab.id)}
            aria-selected={selected}
            aria-controls={panelElementId(idPrefix, tab.id)}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              onChange(tab.id)
            }}
            onKeyDown={(event) => {
              onKeyDown(event, index)
            }}
            className={cn(
              '-mb-px inline-flex min-h-8 min-w-6 items-center px-3 text-sm',
              selected
                ? 'border-b-4 border-primary font-semibold'
                : 'border-b-4 border-transparent font-medium text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

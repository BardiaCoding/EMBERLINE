import type { ReactNode } from 'react'
import { ThemeToggle } from '@/features/theme/ThemeToggle'
import { formatDataThrough, REGION_LABEL } from '@/lib/format'

export const PRODUCT_NAME = 'Emberline: Harmonized Fire Calendar'
/** Short name for the header, which also shows the region label. */
export const PRODUCT_SHORT_NAME = 'Emberline'

type AppHeaderProps = {
  /** Latest month with data, `YYYY-MM`, from the API `/meta`. Null while it is not known. */
  latestMonth: string | null
  /** True while the latest month is partial and therefore provisional. */
  latestMonthIncomplete?: boolean
  /** Target of the Methods link (the methods and data page). */
  methodsHref?: string
  /** Target of the Help link. */
  helpHref?: string
  /** Marks the Methods link as the current page. */
  methodsCurrent?: boolean
}

type AppShellProps = Omit<AppHeaderProps, 'methodsCurrent'> & {
  /** Control panel content: area, dates, options, downloads. */
  controls?: ReactNode
  /** Map panel content. */
  map?: ReactNode
  /** Results panel content: summary cards, calendar and charts. */
  results?: ReactNode
}

const linkClass =
  'inline-flex min-h-6 items-center rounded-sm px-1 text-sm font-medium underline underline-offset-4 hover:text-primary'

/** Page header shared by every view: product name, region, data badge, Methods and Help links. */
export function AppHeader({
  latestMonth,
  latestMonthIncomplete = false,
  methodsHref = '/methods',
  helpHref = '#help',
  methodsCurrent = false,
}: AppHeaderProps) {
  const badge = latestMonth === null ? null : formatDataThrough(latestMonth, latestMonthIncomplete)
  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border bg-card px-4 py-2 text-card-foreground">
      <h1 className="text-lg font-semibold">{PRODUCT_SHORT_NAME}</h1>
      <p className="text-sm text-muted-foreground">{REGION_LABEL}</p>
      <p
        className="rounded-full border border-border px-3 py-1 text-xs font-medium"
        data-testid="data-badge"
      >
        {badge ?? 'Data range not loaded'}
      </p>
      <nav aria-label="Primary" className="ml-auto flex flex-wrap items-center gap-4">
        <a
          href={methodsHref}
          className={linkClass}
          aria-current={methodsCurrent ? 'page' : undefined}
        >
          Methods
        </a>
        <a href={helpHref} className={linkClass}>
          Help
        </a>
        <ThemeToggle />
      </nav>
    </header>
  )
}

/**
 * Page frame: a header and three panels. The layout is in `styles/index.css`:
 * one column below 768 px, controls above the map with results on the right from
 * 768 px, and 320 px controls, map, 560 px results from 1280 px.
 */
export function AppShell({
  latestMonth,
  latestMonthIncomplete = false,
  methodsHref = '/methods',
  helpHref = '#help',
  controls,
  map,
  results,
}: AppShellProps) {
  return (
    <div className="app-shell bg-background text-foreground">
      <a
        href="#results"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to results
      </a>
      <AppHeader
        latestMonth={latestMonth}
        latestMonthIncomplete={latestMonthIncomplete}
        methodsHref={methodsHref}
        helpHref={helpHref}
      />
      <main className="app-body">
        <section
          aria-labelledby="controls-heading"
          className="app-panel app-panel-controls border-b border-border p-4 xl:border-r xl:border-b-0"
        >
          <h2 id="controls-heading" className="mb-3 text-sm font-semibold">
            Area and dates
          </h2>
          {controls}
        </section>
        <section
          aria-labelledby="map-heading"
          className="app-panel app-panel-map relative border-b border-border md:border-b-0"
        >
          <h2 id="map-heading" className="sr-only">
            Map
          </h2>
          {map}
        </section>
        <section
          id="results"
          aria-labelledby="results-heading"
          className="app-panel app-panel-results border-border p-4 md:border-l"
        >
          <h2 id="results-heading" className="mb-3 text-sm font-semibold">
            Results
          </h2>
          {results}
        </section>
      </main>
    </div>
  )
}

import type { ReactNode } from 'react'
import { AppHeader } from '@/components/AppShell'
import { useMetaQuery } from '@/lib/queries'
// The document is outside web/ on purpose: `docs/` sits next to `web/` in the repository
// (web/src/features/methods -> four levels up) and the Dockerfile copies it to `/docs`, next to
// the build folder `/web`. The same relative path resolves in both layouts.
import methodologySource from '../../../../docs/methodology.md?raw'
import { renderMarkdown } from './markdown'
import {
  CITATION_TEXT,
  COUNTING_UNIT_TEXT,
  DATA_BUILD_DATE,
  DATA_SOURCE_TEXT,
  FILTERS_TEXT,
  FIRMS_URL,
  HARMONIZATION_SCOPE_TEXT,
  LIMITATIONS,
  MODEL_COMPARISON,
  REGION_AND_RECORD,
  TIME_CONVENTION_TEXT,
  VALIDATION,
} from './methodsContent'

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-8">
      <h3 id={id} className="mb-2 text-base font-semibold">
        {title}
      </h3>
      {children}
    </section>
  )
}

function Paragraphs({ items }: { items: readonly string[] }) {
  return (
    <>
      {items.map((text) => (
        <p key={text} className="my-2">
          {text}
        </p>
      ))}
    </>
  )
}

function ValidationSection() {
  const v = VALIDATION
  return (
    <Section id="validation" title="Validation of the harmonization">
      <p className="my-2">
        These numbers come from the validation done with the data (see the data README). The app
        does not recompute them. The pooled holdout is a stable 25 % of the overlap months, all
        regions together.
      </p>
      <ul className="my-2 list-disc space-y-1 pl-5">
        <li data-testid="validation-holdout">
          Holdout error of the chosen model (quantile mapping): RMSE {v.rmse}, bias {v.bias},
          seasonality correlation {v.seasonalityCorrelation}.
        </li>
        <li data-testid="validation-switchover">
          No step at the 2012 switchover: the 2009 to 2011 mean is {v.meanBefore} and the 2012 to
          2014 mean is {v.meanAfter} ({v.changePercent}).
        </li>
        <li data-testid="validation-regions">
          {v.regionsWithMetrics} of {v.regionsTotal} regions have validation metrics. A fallback
          fitted on all regions together is used in {v.fallbackRegions} data-poor regions (fewer
          than {v.minOverlapMonths} overlap months).
        </li>
        <li data-testid="validation-optimism">
          The best model for each region was picked on the same holdout used to report the errors,
          so the reported accuracy is slightly optimistic.
        </li>
      </ul>
      <table className="my-3 w-full max-w-xl border-collapse text-sm">
        <caption className="mb-1 text-left text-muted-foreground">
          Candidate transfer models on the holdout (counts in cell-days)
        </caption>
        <thead>
          <tr className="border-b border-border text-left">
            <th scope="col" className="py-1 pr-3 font-medium">
              Model
            </th>
            <th scope="col" className="py-1 pr-3 text-right font-medium">
              RMSE
            </th>
            <th scope="col" className="py-1 pr-3 text-right font-medium">
              Bias
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              Seasonality correlation
            </th>
          </tr>
        </thead>
        <tbody>
          {MODEL_COMPARISON.map((row) => (
            <tr key={row.model} className="border-b border-border">
              <th scope="row" className="py-1 pr-3 text-left font-normal">
                {row.model}
                {row.chosen ? ' (chosen)' : ''}
              </th>
              <td className="py-1 pr-3 text-right">{row.rmse}</td>
              <td className="py-1 pr-3 text-right">{row.bias}</td>
              <td className="py-1 text-right">{row.seasonalityCorrelation}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  )
}

/**
 * The methods and data page at `/methods` (requirements 8.5, 26.8, 33.5): the methodology
 * document, the time convention, the cell-day unit, what harmonization covers, the filters
 * already applied, the validation numbers from the data README, every known limitation and
 * the NASA FIRMS source with its citation. No validation endpoint is involved.
 */
export function MethodsPage() {
  const meta = useMetaQuery()
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <a
        href="#methods-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <AppHeader
        latestMonth={meta.data?.latest_month ?? null}
        latestMonthIncomplete={meta.data?.latest_month_incomplete ?? false}
        helpHref="/#help"
        methodsCurrent
      />
      <main
        id="methods-content"
        aria-labelledby="methods-heading"
        className="mx-auto w-full max-w-3xl px-4 py-6 text-sm leading-relaxed"
      >
        <p>
          <a href="/" className="underline underline-offset-4 hover:text-primary">
            Back to the calendar
          </a>
        </p>
        <h2 id="methods-heading" className="mt-4 text-xl font-semibold">
          Methods and data
        </h2>
        <p className="my-2">
          How the harmonized burning activity calendar is made, what the numbers mean and where they
          are limited.
        </p>

        <article aria-label="Methodology" data-testid="methodology-document">
          {renderMarkdown(methodologySource)}
        </article>

        <Section id="region" title="Region and record">
          <Paragraphs items={REGION_AND_RECORD} />
        </Section>
        <Section id="time-convention" title="Time convention">
          <Paragraphs items={TIME_CONVENTION_TEXT} />
        </Section>
        <Section id="counting-unit" title="Counting unit: cell-days">
          <Paragraphs items={COUNTING_UNIT_TEXT} />
        </Section>
        <Section id="harmonization-scope" title="What harmonization covers">
          <Paragraphs items={HARMONIZATION_SCOPE_TEXT} />
        </Section>
        <Section id="filters" title="Filters already applied">
          <ul className="my-2 list-disc space-y-1 pl-5">
            {FILTERS_TEXT.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </Section>
        <ValidationSection />
        <Section id="limitations" title="Known limitations">
          <ul className="my-2 list-disc space-y-1 pl-5" data-testid="limitations-list">
            {LIMITATIONS.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </Section>
        <Section id="data-source" title="Data source and citation">
          <Paragraphs items={DATA_SOURCE_TEXT} />
          <p className="my-2">
            NASA FIRMS:{' '}
            <a href={FIRMS_URL} className="underline underline-offset-4 hover:text-primary">
              firms.modaps.eosdis.nasa.gov
            </a>
            .
          </p>
          <p className="my-2">{CITATION_TEXT}</p>
          <p className="my-2" data-testid="data-build-date">
            Data build date: {DATA_BUILD_DATE}.
          </p>
        </Section>
      </main>
    </div>
  )
}

import type { ReactNode } from 'react'
import type { CalendarModel } from '@/lib/binning'
import { formatCount } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ProvisionalMark, WholeMonthMark } from './CalendarMarkers'
import {
  HATCH_STYLE,
  LATEST_RING_CLASS,
  PROVISIONAL_BORDER_CLASS,
  SWITCHOVER_CLASS,
} from './calendarStyles'

type CalendarLegendProps = {
  model: CalendarModel
  /** Sentence naming the baseline period, shown with the variable and unit. */
  baselineText?: string
  /** Replaces the counts-view sentence about the colour scale (comparison mode: one shared scale). */
  scaleText?: string
  className?: string
}

const SWATCH =
  'relative inline-flex size-6 shrink-0 items-center justify-center border border-foreground'

function Entry({ sample, children }: { sample: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      {sample}
      <span>{children}</span>
    </li>
  )
}

/** Swatch for a marker: a plain cell in the page colours, so the shape is what stands out. */
function MarkerSample({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <span aria-hidden="true" className={cn(SWATCH, 'bg-background text-foreground', className)}>
      {children}
    </span>
  )
}

/**
 * Legend of the active view (requirements 15.4, 15.7, 15.9, 15.12, 15.13, 15.14 to 15.17): the
 * variable, unit and time convention, the numeric bin edges with their colours, the no-data
 * hatch, and one entry for each marker that is displayed. The counts view adds the sentence
 * that colours are set from the cells shown only, and each class lists its edge range with the
 * unit. The anomaly view explains the
 * baseline median 0 rule and the diff view its limits.
 */
export function CalendarLegend({ model, baselineText, scaleText, className }: CalendarLegendProps) {
  return (
    <section aria-label="Calendar legend" className={cn('space-y-3 text-sm', className)}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="font-medium">Variable</dt>
        <dd>{model.variable}</dd>
        <dt className="font-medium">Unit</dt>
        <dd>{model.unit}</dd>
        <dt className="font-medium">Time</dt>
        <dd>Months and years in {model.timeConvention}</dd>
        {baselineText === undefined ? null : (
          <>
            <dt className="font-medium">Baseline</dt>
            <dd data-testid="legend-baseline">{baselineText.replace(/^Baseline period: /, '')}</dd>
          </>
        )}
      </dl>

      <div>
        <h3 className="mb-1 font-medium">Colour classes</h3>
        <ul aria-label="Colour classes" className="space-y-1">
          {model.bins.map((bin) => (
            <Entry
              key={bin.index}
              sample={
                <span
                  aria-hidden="true"
                  className={SWATCH}
                  style={{ backgroundColor: bin.colour }}
                />
              }
            >
              <span className="tabular-nums">{bin.label}</span>
              {model.view === 'counts' ? ` ${model.unit}` : null}
              {bin.kind === 'zero' ? ' (zero, lowest class)' : null}
              {bin.neutral ? ' (neutral, contains zero)' : null}
            </Entry>
          ))}
        </ul>
        <p className="mt-1 text-muted-foreground">
          {model.view === 'counts'
            ? 'Each class starts at its first value and ends just below the next one. The last class ends at the largest displayed value.'
            : 'Each class starts at its first value and ends just below the next one. Blue is below the reference and orange is above it. Signs (+ and -) are also written in the cells.'}
        </p>
        {model.view === 'anomaly' ? (
          <p className="mt-1 text-muted-foreground">
            A month whose baseline median is 0 has no percent difference. It is in the top class
            when it has any burning activity and in the neutral class when it has none, and its cell
            shows the absolute difference in cell-days without a percent sign.
          </p>
        ) : null}
        {model.view === 'diff' ? (
          <p className="mt-1 text-muted-foreground">
            {model.diffLimit === null || model.diffLimit === 0
              ? 'Every displayed month-to-month difference is 0.'
              : `Class limits are plus and minus ${formatCount(model.diffLimit)} cell-days, the 95th percentile of the absolute differences in the displayed Calendar. Larger differences are placed in the end classes.`}
          </p>
        ) : null}
      </div>

      <ul aria-label="Cell patterns and markers" className="space-y-1">
        <Entry sample={<span aria-hidden="true" className={SWATCH} style={HATCH_STYLE} />}>
          Hatched: no data (before the record, after the latest month, or outside the date range
          {model.view === 'diff' ? ', or the previous month has no data' : ''})
        </Entry>
        {model.hasSwitchover ? (
          <Entry sample={<MarkerSample className={SWITCHOVER_CLASS} />}>
            Thick left edge: January 2012, where the source changes from native to calibrated
          </Entry>
        ) : null}
        {model.hasWholeMonth ? (
          <Entry
            sample={
              <MarkerSample>
                <WholeMonthMark />
              </MarkerSample>
            }
          >
            Triangle in the top-left corner: whole month, the date range starts or ends partway
            through it
          </Entry>
        ) : null}
        {model.hasLatest ? (
          <Entry sample={<MarkerSample className={LATEST_RING_CLASS} />}>
            Ring just inside the cell edge: latest month with data
          </Entry>
        ) : null}
        {model.hasProvisional ? (
          <Entry
            sample={
              <MarkerSample className={PROVISIONAL_BORDER_CLASS}>
                <ProvisionalMark />
              </MarkerSample>
            }
          >
            Dashed border and circle in the bottom-right corner: provisional, the month is
            incomplete. It shows the count to date, has no colour class and is not used to set the
            classes.
          </Entry>
        ) : null}
      </ul>

      {model.view === 'counts' ? (
        <p className="text-muted-foreground">
          {scaleText ??
            'Colours are set from the cells shown here only. They cannot be compared between different areas or date ranges.'}
        </p>
      ) : null}
    </section>
  )
}

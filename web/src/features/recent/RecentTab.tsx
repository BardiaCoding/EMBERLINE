import { Button } from '@/components/ui/button'
import { isApiError, type ApiGeometry } from '@/lib/api'
import {
  formatDate,
  formatMonthLabel,
  formatUtcTimestamp,
  MISSING,
  TIME_CONVENTION,
  UNIT_DETECTIONS,
} from '@/lib/format'
import { formatWatchBadge } from '@/lib/watch'
import { satelliteColour } from '@/features/map/hotspotLayer'
import { WatchBadge } from '@/features/results/WatchBadge'
import { HOTSPOT_POINT_OUTLINE } from '@/styles/palettes'
import { useRecentQuery, type RecentOut } from './recentApi'
import { barShare, isEmptyWindow, isStale, projectPoints, satelliteCounts } from './recentModel'

/** Whole raw detections: no decimals. */
function formatInt(n: number): string {
  return n.toLocaleString('en-US')
}

export const RECENT_RAW_LABEL = 'raw, not harmonized, not comparable across sensors'

const PLOT_W = 360
const PLOT_H = 240
const BAR_AREA_HEIGHT = 120

type RecentTabProps = {
  /** Selection_Area as GeoJSON, null or undefined for the full region. */
  geometry?: ApiGeometry | null
  /** Baseline period for the monthly watch object, null for the default. */
  baselineYears?: [number, number] | null
  /** Name of the area, for the text summary. */
  area: string
}

function ProvisionalLine({ watch }: { watch: RecentOut['watch'] }) {
  if (!watch?.provisional || !watch.provisional_month || watch.provisional_count == null) {
    return null
  }
  return (
    <p className="text-sm" data-testid="recent-provisional">
      {formatMonthLabel(watch.provisional_month)} is incomplete (provisional):{' '}
      {watch.provisional_count.toFixed(1)} cell-days (MODIS-equivalent) to date. This monthly count
      is harmonized. The daily bars above are raw.
    </p>
  )
}

function DayBars({ recent }: { recent: RecentOut }) {
  const max = Math.max(...recent.days.map((d) => d.count))
  return (
    <figure className="m-0" data-testid="recent-bars">
      <figcaption className="mb-1 text-sm font-medium">
        Raw detections per local day ({RECENT_RAW_LABEL}; {UNIT_DETECTIONS}; {TIME_CONVENTION})
      </figcaption>
      <ol
        className="m-0 grid list-none grid-cols-7 items-end gap-2 p-0"
        style={{ height: BAR_AREA_HEIGHT + 40 }}
        aria-label="Raw detections per local day"
      >
        {recent.days.map((day) => (
          <li
            key={day.date}
            className="flex h-full flex-col items-center justify-end gap-1"
            data-testid="recent-bar"
          >
            <span className="text-xs tabular-nums">{formatInt(day.count)}</span>
            <span
              aria-hidden="true"
              className="w-full rounded-t-sm bg-primary"
              style={{
                height: Math.max(day.count > 0 ? 2 : 1, barShare(day.count, max) * BAR_AREA_HEIGHT),
              }}
            />
            <span className="text-xs text-muted-foreground">{formatDate(day.date).slice(5)}</span>
          </li>
        ))}
      </ol>
    </figure>
  )
}

function PointPlot({ recent }: { recent: RecentOut }) {
  const projected = projectPoints(recent.points, PLOT_W, PLOT_H)
  const satellites = satelliteCounts(recent.points)
  return (
    <figure className="m-0" data-testid="recent-points">
      <figcaption className="mb-1 text-sm font-medium">
        Detections of the 7 days by satellite ({RECENT_RAW_LABEL}; EPSG:4326)
      </figcaption>
      <svg
        viewBox={`0 0 ${PLOT_W} ${PLOT_H}`}
        role="img"
        aria-label={`Scatter of ${recent.points.length} raw detections by longitude and latitude. ${RECENT_RAW_LABEL}.`}
        className="w-full max-w-md rounded-md border border-border bg-card"
      >
        {projected.map(({ x, y, point }, i) => (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={3}
            fill={satelliteColour(point.satellite)}
            stroke={HOTSPOT_POINT_OUTLINE}
            strokeWidth={0.6}
          >
            <title>
              {`${point.satellite}, ${formatUtcTimestamp(point.acq_datetime_utc)}, local date ${point.local_date}, source ${point.source ?? MISSING}`}
            </title>
          </circle>
        ))}
      </svg>
      <ul className="m-0 mt-1 flex list-none flex-wrap gap-3 p-0 text-xs">
        {satellites.map(([name, count]) => (
          <li key={name} className="inline-flex items-center gap-1">
            <span
              aria-hidden="true"
              className="inline-block size-3 rounded-full border border-foreground"
              style={{ backgroundColor: satelliteColour(name) }}
            />
            {name}: {formatInt(count)}
          </li>
        ))}
      </ul>
      {recent.points_omitted > 0 ? (
        <p className="mt-1 text-xs" data-testid="recent-omitted">
          Showing the newest {formatInt(recent.points.length)} of {formatInt(recent.total)}{' '}
          detections. {formatInt(recent.points_omitted)} older detections are not drawn. The bars
          count all of them.
        </p>
      ) : null}
    </figure>
  )
}

/**
 * Recent tab (requirement 20): the last 7 local days (local standard time, UTC-8) ending on the
 * day of the latest detection in the delivered data. It shows 7 bars of RAW detections (zero days
 * included), the detections by satellite, the time of the latest detection in UTC, a notice when
 * the data are more than 3 days old, and a message when the area has no detections. The delivered
 * data have no daily harmonized counts, so nothing here is harmonized. The request gives up after
 * 10 seconds and shows an error; the Selection_Area is not changed.
 */
export default function RecentTab({ geometry = null, baselineYears = null, area }: RecentTabProps) {
  const query = useRecentQuery({ geometry, baseline_years: baselineYears })
  const recent = query.data

  if (recent === undefined) {
    if (query.isError) {
      const detail =
        isApiError(query.error) && query.error.kind === 'timeout'
          ? ' It took longer than 10 seconds.'
          : ''
      return (
        <div
          role="alert"
          className="rounded-lg border border-destructive bg-card p-3 text-sm"
          data-testid="recent-error"
        >
          <p>The recent data could not be loaded.{detail} Your area is unchanged.</p>
          <Button
            type="button"
            className="mt-2"
            variant="outline"
            onClick={() => {
              void query.refetch()
            }}
          >
            Retry recent data
          </Button>
        </div>
      )
    }
    return (
      <p role="status" className="text-sm text-muted-foreground" data-testid="recent-loading">
        Loading recent detections…
      </p>
    )
  }

  const empty = isEmptyWindow(recent)
  const watchBadgeData = formatWatchBadge(recent.watch)
  return (
    <section aria-label="Last 7 days" className="flex flex-col gap-4" data-testid="recent-tab">
      <header className="flex flex-col gap-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">
            {area}: {formatDate(recent.window_start)} to {formatDate(recent.window_end)} (
            {TIME_CONVENTION})
          </p>
          <WatchBadge data={watchBadgeData} />
        </div>
        <p data-testid="recent-raw-label">
          Raw detections, not harmonized, not comparable across sensors. Unit: {UNIT_DETECTIONS}.
        </p>
        <p data-testid="recent-latest">
          Latest detection in the delivered data: {formatUtcTimestamp(recent.latest_utc)}
        </p>
      </header>
      {isStale(recent.data_age_days, recent.stale_after_days) ? (
        <p
          role="status"
          className="rounded-lg border border-border bg-muted p-3 text-sm"
          data-testid="recent-stale"
        >
          The delivered data end {recent.data_age_days} days ago. This view shows the 7 days up to
          the latest detection, not the last 7 days.
        </p>
      ) : null}
      {empty ? (
        <p
          role="status"
          className="rounded-lg border border-border bg-card p-3 text-sm"
          data-testid="recent-empty"
        >
          No detections were found in this area in this period.
        </p>
      ) : null}
      <DayBars recent={recent} />
      {empty ? null : <PointPlot recent={recent} />}
      <ProvisionalLine watch={recent.watch} />
    </section>
  )
}

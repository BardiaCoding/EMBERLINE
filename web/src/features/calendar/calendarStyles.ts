import type { CSSProperties } from 'react'
import type { TextTone } from '@/lib/binning'

/**
 * Hatched fill of a `no_data` cell and of its legend swatch. Diagonal lines in the muted
 * foreground colour over the page background, so it differs from every colour class by
 * pattern and not only by colour (requirement 15.7). No raw colour values.
 */
export const HATCH_STYLE: CSSProperties = {
  backgroundColor: 'var(--background)',
  backgroundImage:
    'repeating-linear-gradient(135deg, var(--muted-foreground) 0, var(--muted-foreground) 1px, transparent 1px, transparent 5px)',
}

/**
 * Cell markers (requirements 15.9, 15.12, 15.16, 15.17). Each has its own shape and
 * position, so none relies on colour:
 * - whole month: a triangle in the top-left corner (`WholeMonthMark`),
 * - latest month: a 2 px ring inside the cell edge (`LATEST_RING_CLASS`),
 * - provisional: a circle in the bottom-right corner (`ProvisionalMark`),
 * - switchover (2012-01): a thick left edge (`SWITCHOVER_CLASS`).
 * The shapes use `currentColor`, which is the cell's text colour and is already chosen for
 * contrast against the cell fill (`toneClass`). No raw colour values.
 */

/** 2 px ring inside the edge of the latest-month cell, in the cell's text colour. */
export const LATEST_RING_CLASS = 'shadow-[inset_0_0_0_2px_currentColor]'

/** Thick left edge of the switchover (2012-01) cell, in the cell's text colour. */
export const SWITCHOVER_CLASS = 'border-l-[4px] border-l-current'

/** Dashed border of a provisional cell, which has no colour-class fill. */
export const PROVISIONAL_BORDER_CLASS = 'border-2 border-dashed border-foreground'

/** Text colour class for a tone, or the page text colour when a cell has no fill. */
export function toneClass(tone: TextTone | null): string {
  if (tone === 'light') return 'text-white'
  if (tone === 'dark') return 'text-black'
  return 'text-foreground'
}

/** Header and body rows of the Calendar grid are 32 px high (`h-8` = 2 rem; requirement 26.11). */
export const ROW_HEIGHT = 'h-8 min-h-8'

/**
 * Size of the Calendar scroll region. The minimum is the sticky header plus 3 year rows
 * (4 x 32 px = 8 rem = `min-h-32`), so the 3 newest years stay visible. The maximum is the
 * viewport height minus the space above the Calendar, which `ResultsPanel` publishes as
 * `--results-above-calendar` (see `useResultsAboveCalendar`); without it the maximum is the
 * viewport height. CSS lets the minimum win when the two conflict.
 */
export const REGION_SIZE_CLASS = 'min-h-32 max-h-[calc(100dvh-var(--results-above-calendar,0px))]'

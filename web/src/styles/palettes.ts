// Data-colour palettes. Raw hex colours are allowed in this file only (ESLint rule).
// The WCAG contrast and colour-vision (Machado, CIEDE2000) checks of these swatches are
// task 19.8. Palette choices are DEFAULT (confirm), requirements 15.2 and 15.3.

/**
 * Cividis, the sequential palette of the counts view. The 10 stops are matplotlib's cividis
 * sampled at 0, 1/9 ... 1 (dark blue to yellow). Cividis was designed to look the same
 * under the common forms of colour-vision deficiency.
 */
export const CIVIDIS_STOPS: readonly string[] = [
  '#00224e',
  '#123570',
  '#3b496c',
  '#575d6d',
  '#707173',
  '#8a8678',
  '#a59c74',
  '#c3b369',
  '#e1cc55',
  '#fee838',
]

/**
 * Blue-orange diverging palette of the anomaly and month-to-month difference views, 9
 * classes: 4 blue (below baseline, darkest first), 1 neutral, 4 orange (above baseline,
 * darkest last). The neutral colour belongs to the bin that contains zero.
 */
export const BLUE_ORANGE_DIVERGING: readonly string[] = [
  '#1b4f8a',
  '#3a7bb8',
  '#6fa4d3',
  '#a9c9e5',
  '#eeeeee',
  '#f6cf9f',
  '#f0a45c',
  '#d9772a',
  '#a64b0a',
]

/** Index of the neutral class in `BLUE_ORANGE_DIVERGING`. */
export const BLUE_ORANGE_NEUTRAL_INDEX = 4

/**
 * Selection_Area outline, vertices and fill on the map. Terra Draw only accepts hex strings,
 * so the colours live here. The blue is about 6.8:1 against the light OpenStreetMap base
 * colour (requirement 27.1 asks for 3:1 for the outline) and differs from the orange-red
 * dashed region outline. Vertex and midpoint handles have a white ring.
 */
export const SELECTION_COLOUR = '#0b5394'
export const SELECTION_HANDLE_RING = '#ffffff'

/**
 * Colours of the line and bar charts (task 19.6). ECharts draws on a canvas, so it needs
 * literal colours, not CSS variables. Series colours come from the Okabe-Ito palette (blue,
 * a darkened vermillion, orange, sky blue), which is designed to stay distinguishable under the common
 * forms of colour-vision deficiency. Every series also has its own line style, marker shape
 * or border, so colour is never the only signal (requirement 27.4). One set per theme; the
 * data marks and text meet 3:1 and 4.5:1 against the theme's card colour (checked in 19.8).
 */
export type ChartColours = {
  /** Main data: complete-year bars, the baseline median line of the seasonal profile. */
  primary: string
  /** Comparison data: baseline reference lines, the selected-year overlay, the mean series. */
  secondary: string
  /** Fill of a provisional or partial bar (its dashed border uses `primary`). */
  provisionalFill: string
  /** The 10th to 90th percentile band (drawn at low opacity). */
  band: string
  /** Chart text (title-level labels, legend, tooltip text). */
  text: string
  /** Axis labels and axis names. */
  mutedText: string
  /** Axis lines and zero lines. */
  axis: string
  /** Grid lines (decorative). */
  grid: string
  /** Tooltip background. */
  tooltipBackground: string
}

export const CHART_COLOURS_LIGHT: ChartColours = {
  primary: '#0072b2',
  secondary: '#c2410c',
  provisionalFill: '#cfe3f2',
  band: '#56b4e9',
  text: '#1a1a1a',
  mutedText: '#4d4d4d',
  axis: '#737373',
  grid: '#e0e0e0',
  tooltipBackground: '#ffffff',
}

export const CHART_COLOURS_DARK: ChartColours = {
  primary: '#56b4e9',
  secondary: '#e69f00',
  provisionalFill: '#1f3d52',
  band: '#56b4e9',
  text: '#f2f2f2',
  mutedText: '#c4c4c4',
  axis: '#a3a3a3',
  grid: '#404040',
  tooltipBackground: '#262626',
}

type Rgb = readonly [number, number, number]

function parseHex(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function toHex([r, g, b]: Rgb): string {
  const part = (v: number): string => Math.round(v).toString(16).padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`
}

/**
 * `count` colours spread evenly over cividis, darkest first. Colours between the stops
 * are linear interpolations in sRGB. Returns an empty array for `count` of 0 and the
 * middle colour for 1. `count` must be a non-negative integer.
 */
export function cividisClasses(count: number): string[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError('count must be a non-negative integer')
  }
  const last = CIVIDIS_STOPS.length - 1
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0.5 : i / (count - 1)
    const pos = t * last
    const lo = Math.min(Math.floor(pos), last - 1)
    const frac = pos - lo
    const a = parseHex(CIVIDIS_STOPS[lo] ?? CIVIDIS_STOPS[0] ?? '')
    const b = parseHex(CIVIDIS_STOPS[lo + 1] ?? CIVIDIS_STOPS[last] ?? '')
    return toHex([
      a[0] + (b[0] - a[0]) * frac,
      a[1] + (b[1] - a[1]) * frac,
      a[2] + (b[2] - a[2]) * frac,
    ])
  })
}

/**
 * Colours of the hotspot map layer points, by satellite (task 22.3, requirement 11.5). Okabe-Ito
 * colours, which stay distinguishable under the common forms of colour-vision deficiency. Every
 * point also has a dark outline so it reads on the light basemap, and the legend names each
 * satellite in text. The contrast and colour-vision checks are task 19.8. DEFAULT (confirm).
 */
export const SATELLITE_COLOURS: Readonly<Record<string, string>> = {
  Terra: '#0072b2',
  Aqua: '#e69f00',
  SNPP: '#f0e442',
  N20: '#cc79a7',
  N21: '#009e73',
}

/** Colour of a satellite that is not in `SATELLITE_COLOURS`. */
export const SATELLITE_FALLBACK_COLOUR = '#737373'

/** Outline of the hotspot points. */
export const HOTSPOT_POINT_OUTLINE = '#1a1a1a'

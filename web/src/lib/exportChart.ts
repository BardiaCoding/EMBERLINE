// Chart PNG and SVG export (requirements 18.2, 18.3, 18.6, 30.7; design.md section 11.6).
// The live chart's option is redrawn on an offscreen ECharts instance with the title, unit,
// time convention, query description and data citation drawn on the image. The file is built
// completely in memory and handed to the browser only when it is whole, so a failure never
// delivers a partial file. The ECharts renderers are loaded on demand (separate chunk).
import type { ECharts, EChartsCoreOption } from 'echarts/core'
import type { CalendarModel } from '@/lib/binning'
import type { DateRange } from '@/lib/dates'
import { exportFilename } from '@/lib/filenames'
import { MISSING, TIME_CONVENTION } from '@/lib/format'

const MONTH_LABELS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

/** Logical image width in px. With `PNG_PIXEL_RATIO` the PNG is 1600 px wide (requirement 18.2). */
export const EXPORT_WIDTH = 800
export const PNG_PIXEL_RATIO = 2
export const PNG_MIN_WIDTH = EXPORT_WIDTH * PNG_PIXEL_RATIO

/**
 * FIRMS data citation drawn on every export. DEFAULT (confirm): wording and URL are not taken
 * from a NASA citation guide; check before submission.
 */
export const FIRMS_CITATION =
  'Data: NASA FIRMS (Fire Information for Resource Management System), MODIS and VIIRS active fire data, https://firms.modaps.eosdis.nasa.gov/. Harmonized to the MODIS-equivalent scale.'

export type ExportFormat = 'png' | 'svg'

/** What the image states about the chart. */
export type ExportMeta = {
  /** Chart title. */
  title: string
  /** Unit text, for example "cell-days (MODIS-equivalent), local standard time, UTC-8". */
  unit: string
  /** Selection_Area name or bounding coordinates. */
  area: string
  /** Date_Range in local standard time, UTC-8. */
  range: DateRange
}

/** Query description drawn on the image: area and Date_Range with the time convention. */
export function describeQuery(area: string, range: DateRange): string {
  return `Area: ${area}. Date range: ${range.start} to ${range.end} (${TIME_CONVENTION}).`
}

/** What is exported: the live chart, or the Calendar drawn from its model. */
export type ExportTarget =
  { kind: 'chart'; getChart: () => ECharts | null } | { kind: 'calendar'; model: CalendarModel }

/** The part of an ECharts instance the export uses. */
export type OffscreenChart = {
  setOption: (option: EChartsCoreOption) => void
  getDataURL: (opts: { type: 'png'; pixelRatio: number; backgroundColor: string }) => string
  renderToSVGString: () => string
  dispose: () => void
}

export type CreateOffscreenChart = (
  renderer: 'canvas' | 'svg',
  width: number,
  height: number,
) => Promise<OffscreenChart>

export type ExportDeps = {
  createChart?: CreateOffscreenChart
  /** Hands a finished file to the browser. */
  download?: (blob: Blob, filename: string) => void
}

/** Raised when a file could not be produced. The message names the file and is shown to the user. */
export class ExportError extends Error {
  readonly filename: string
  constructor(filename: string, cause?: unknown) {
    super(`The file ${filename} could not be created. Your area and dates are unchanged.`, {
      cause,
    })
    this.name = 'ExportError'
    this.filename = filename
  }
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

const TITLE_BLOCK = 78
const FOOTER_BLOCK = 112
const LEGEND_TOP = 58
const TEXT_WIDTH = EXPORT_WIDTH - 40

function toArray(v: unknown): Obj[] {
  if (Array.isArray(v)) return v.filter(isObj)
  return isObj(v) ? [v] : []
}

/**
 * Wrap `base` with the title block on top and the query description and citation below.
 * Grids are moved to make room, legends are placed under the title, and animation is off so
 * the first frame is the final one.
 */
export function buildExportOption(
  base: EChartsCoreOption,
  meta: ExportMeta,
  height: number,
  extraGraphics: Obj[] = [],
): EChartsCoreOption {
  const option: Obj = { ...(base as Obj) }
  const grids = toArray(option.grid)
  option.grid = (grids.length > 0 ? grids : [{}]).map((g) => ({
    ...g,
    left: typeof g.left === 'number' ? g.left : 56,
    right: typeof g.right === 'number' ? g.right : 24,
    top: TITLE_BLOCK + 36,
    bottom: FOOTER_BLOCK + 36,
    containLabel: true,
  }))
  const legends = toArray(option.legend)
  if (legends.length > 0) {
    option.legend = legends.map((l) => ({ ...l, top: LEGEND_TOP, bottom: 'auto' }))
  }
  option.title = {
    text: meta.title,
    subtext: meta.unit,
    left: 20,
    top: 8,
    textStyle: { fontSize: 18, width: TEXT_WIDTH, overflow: 'break' },
    subtextStyle: { fontSize: 12, width: TEXT_WIDTH, overflow: 'break' },
  }
  const footer = (text: string, y: number, size: number): Obj => ({
    type: 'text',
    left: 20,
    top: y,
    silent: true,
    style: { text, fontSize: size, width: TEXT_WIDTH, overflow: 'break', lineHeight: size + 3 },
  })
  option.graphic = [
    footer(describeQuery(meta.area, meta.range), height - FOOTER_BLOCK + 8, 11),
    footer(FIRMS_CITATION, height - FOOTER_BLOCK + 44, 10),
    ...extraGraphics,
  ]
  option.animation = false
  option.tooltip = { show: false }
  if (typeof option.backgroundColor !== 'string') option.backgroundColor = 'white'
  return option
}

const CALENDAR_ROW_PX = 22
const CALENDAR_MIN_HEIGHT = 420

/** Height of the Calendar image for a model, in logical px. */
export function calendarHeight(model: CalendarModel): number {
  return Math.max(
    CALENDAR_MIN_HEIGHT,
    TITLE_BLOCK + FOOTER_BLOCK + 120 + model.rows.length * CALENDAR_ROW_PX,
  )
}

/**
 * Calendar as an ECharts heatmap: one cell per displayed month, filled with the colour class of
 * the active view, years as rows (newest first as in the Calendar), months as columns. Months
 * with no colour (no data, provisional, unclassified) are drawn with no fill and a dash or the
 * count to date, and the legend lists every colour class with its label.
 */
export function calendarOption(
  model: CalendarModel,
  meta: ExportMeta,
  height: number = calendarHeight(model),
): EChartsCoreOption {
  const years = model.rows.map((r) => String(r.year))
  const data: Obj[] = []
  model.rows.forEach((row, y) => {
    row.cells.forEach((cell, m) => {
      data.push({
        value: [m, y, cell.value ?? 0],
        label: { show: true, formatter: cell.face ?? MISSING },
        itemStyle:
          cell.colour === null ? { color: 'white', borderColor: 'gray' } : { color: cell.colour },
      })
    })
  })
  const legendY = height - FOOTER_BLOCK - 28
  const swatch = Math.floor((EXPORT_WIDTH - 40) / Math.max(model.bins.length, 1))
  const legend: Obj[] = model.bins.flatMap((bin, i) => [
    {
      type: 'rect',
      left: 20 + i * swatch,
      top: legendY,
      silent: true,
      shape: { width: 14, height: 14 },
      style: { fill: bin.colour, stroke: 'gray' },
    },
    {
      type: 'text',
      left: 38 + i * swatch,
      top: legendY,
      silent: true,
      style: { text: bin.label, fontSize: 9, width: swatch - 22, overflow: 'truncate' },
    },
  ])
  const base: Obj = {
    xAxis: {
      type: 'category',
      data: [...MONTH_LABELS_SHORT],
      position: 'top',
      splitArea: { show: false },
    },
    yAxis: { type: 'category', data: years, inverse: true, name: 'Year' },
    series: [
      {
        type: 'heatmap',
        data,
        label: { show: true, fontSize: 9 },
        itemStyle: { borderColor: 'white', borderWidth: 1 },
      },
    ],
  }
  const option = buildExportOption(base, meta, height, legend) as Obj
  option.grid = [
    { left: 56, right: 24, top: TITLE_BLOCK + 28, bottom: FOOTER_BLOCK + 52, containLabel: true },
  ]
  return option
}

/** Default factory: loads ECharts with the SVG renderer and the export components on demand. */
export const createOffscreenChart: CreateOffscreenChart = async (renderer, width, height) => {
  const [core, renderers, components, charts] = await Promise.all([
    import('echarts/core'),
    import('echarts/renderers'),
    import('echarts/components'),
    import('echarts/charts'),
  ])
  core.use([
    renderers.SVGRenderer,
    renderers.CanvasRenderer,
    components.TitleComponent,
    components.GraphicComponent,
    components.GridComponent,
    components.LegendComponent,
    components.MarkLineComponent,
    charts.HeatmapChart,
    charts.BarChart,
    charts.LineChart,
    charts.ScatterChart,
  ])
  if (renderer === 'svg') {
    // Server-side rendering mode: no DOM element, the SVG is returned as a string.
    const chart = core.init(null, undefined, { renderer: 'svg', ssr: true, width, height })
    return chart
  }
  const host = document.createElement('div')
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:${height}px`
  document.body.appendChild(host)
  const chart = core.init(host, undefined, { renderer: 'canvas', width, height })
  return {
    setOption: (o) => {
      chart.setOption(o)
    },
    getDataURL: (o) => chart.getDataURL(o),
    renderToSVGString: () => '',
    dispose: () => {
      chart.dispose()
      host.remove()
    },
  }
}

function dataUrlToBlob(url: string): Blob {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(url)
  if (match === null || match[2] === undefined || match[1] === undefined) {
    throw new Error('Not a base64 data URL')
  }
  const bytes = atob(match[3] ?? '')
  const out = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i += 1) out[i] = bytes.charCodeAt(i)
  return new Blob([out], { type: match[1] })
}

/** Browser download of a finished blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 0)
}

/** File name of an export: `<chart>_<area>_<start>_<end>.<png|svg>` (requirement 18.3). */
export function chartFilename(meta: ExportMeta, format: ExportFormat): string {
  return exportFilename(meta.title, meta.area, meta.range.start, meta.range.end, format)
}

/**
 * Build the image and deliver it. Resolves with the file name. Throws `ExportError` (naming
 * the file) when anything fails, before any file is delivered.
 */
export async function exportChartFile(
  target: ExportTarget,
  format: ExportFormat,
  meta: ExportMeta,
  deps: ExportDeps = {},
): Promise<string> {
  const filename = chartFilename(meta, format)
  const create = deps.createChart ?? createOffscreenChart
  const download = deps.download ?? downloadBlob
  let chart: OffscreenChart | null = null
  try {
    let option: EChartsCoreOption
    let height: number
    if (target.kind === 'calendar') {
      height = calendarHeight(target.model)
      option = calendarOption(target.model, meta, height)
    } else {
      const live = target.getChart()
      if (live === null) throw new Error('The chart is not shown')
      height = Math.max(
        360,
        Math.round((live.getHeight() / Math.max(live.getWidth(), 1)) * EXPORT_WIDTH) +
          TITLE_BLOCK +
          FOOTER_BLOCK +
          40,
      )
      option = buildExportOption(live.getOption(), meta, height)
    }
    chart = await create(format === 'png' ? 'canvas' : 'svg', EXPORT_WIDTH, height)
    chart.setOption(option)
    let blob: Blob
    if (format === 'png') {
      const url = chart.getDataURL({
        type: 'png',
        pixelRatio: PNG_PIXEL_RATIO,
        backgroundColor: 'white',
      })
      blob = dataUrlToBlob(url)
    } else {
      const svg = chart.renderToSVGString()
      if (svg.trim() === '') throw new Error('Empty SVG')
      blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    }
    download(blob, filename)
    return filename
  } catch (error) {
    throw new ExportError(filename, error)
  } finally {
    chart?.dispose()
  }
}

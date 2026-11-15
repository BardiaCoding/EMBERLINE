import type { ECharts } from 'echarts/core'
import { describe, expect, it, vi } from 'vitest'
import {
  buildExportOption,
  chartFilename,
  describeQuery,
  exportChartFile,
  ExportError,
  FIRMS_CITATION,
  PNG_MIN_WIDTH,
  type ExportMeta,
  type OffscreenChart,
} from './exportChart'

// Synthetic values. TEST FIXTURE, not NASA data.
const meta: ExportMeta = {
  title: 'Harmonized count by year',
  unit: 'cell-days (MODIS-equivalent), local standard time, UTC-8',
  area: 'California region',
  range: { start: '2020-01-01', end: '2020-12-31' },
}
// 1x1 transparent PNG.
const PNG_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg=='

function mockChart(overrides: Partial<OffscreenChart> = {}): OffscreenChart {
  return {
    setOption: vi.fn(),
    getDataURL: vi.fn(() => PNG_URL),
    renderToSVGString: vi.fn(() => '<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    dispose: vi.fn(),
    ...overrides,
  }
}
const live = {
  getOption: () => ({ grid: [{}], series: [{ type: 'bar', data: [1, 2] }] }),
  getWidth: () => 600,
  getHeight: () => 280,
} as unknown as ECharts
const target = { kind: 'chart' as const, getChart: () => live }

describe('buildExportOption', () => {
  it('draws title, unit, query description and citation', () => {
    const option = buildExportOption({ series: [] }, meta, 500) as Record<string, unknown>
    const title = option.title as { text: string; subtext: string }
    expect(title.text).toBe(meta.title)
    expect(title.subtext).toContain('UTC-8')
    const texts = (option.graphic as { style: { text: string } }[]).map((g) => g.style.text)
    expect(texts).toContain(describeQuery(meta.area, meta.range))
    expect(texts).toContain(FIRMS_CITATION)
    expect(describeQuery(meta.area, meta.range)).toContain('2020-01-01 to 2020-12-31')
  })
})

describe('exportChartFile', () => {
  it('delivers a PNG at least 1600 px wide with a safe name', async () => {
    const chart = mockChart()
    const download = vi.fn<(blob: Blob, filename: string) => void>()
    const name = await exportChartFile(target, 'png', meta, {
      createChart: () => Promise.resolve(chart),
      download,
    })
    expect(name).toBe(chartFilename(meta, 'png'))
    expect(name).toMatch(/^[A-Za-z0-9_-]+_2020-01-01_2020-12-31\.png$/)
    const call = vi.mocked(chart.getDataURL).mock.calls[0]?.[0]
    expect(call?.type).toBe('png')
    // Logical width 800 times pixelRatio.
    expect(800 * (call?.pixelRatio ?? 0)).toBeGreaterThanOrEqual(PNG_MIN_WIDTH)
    expect(download).toHaveBeenCalledOnce()
    expect(download.mock.calls[0]?.[0].type).toBe('image/png')
    expect(chart.dispose).toHaveBeenCalled()
  })

  it('delivers an SVG string', async () => {
    const chart = mockChart()
    const download = vi.fn<(blob: Blob, filename: string) => void>()
    await exportChartFile(target, 'svg', meta, {
      createChart: () => Promise.resolve(chart),
      download,
    })
    expect(download.mock.calls[0]?.[1]).toMatch(/\.svg$/)
    expect(download.mock.calls[0]?.[0].type).toContain('image/svg+xml')
  })

  it('throws an error naming the file and delivers nothing on failure', async () => {
    const chart = mockChart({
      renderToSVGString: () => {
        throw new Error('boom')
      },
    })
    const download = vi.fn()
    const result = exportChartFile(target, 'svg', meta, {
      createChart: () => Promise.resolve(chart),
      download,
    })
    await expect(result).rejects.toBeInstanceOf(ExportError)
    await expect(result).rejects.toThrow(/\.svg could not be created/)
    expect(download).not.toHaveBeenCalled()
    expect(chart.dispose).toHaveBeenCalled()
  })

  it('fails when the chart is not shown', async () => {
    const download = vi.fn()
    await expect(
      exportChartFile({ kind: 'chart', getChart: () => null }, 'png', meta, {
        createChart: () => Promise.resolve(mockChart()),
        download,
      }),
    ).rejects.toBeInstanceOf(ExportError)
    expect(download).not.toHaveBeenCalled()
  })
})

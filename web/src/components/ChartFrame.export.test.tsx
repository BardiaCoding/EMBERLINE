import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ECharts } from 'echarts/core'
import { describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import type { ExportMeta, OffscreenChart } from '@/lib/exportChart'
import { ChartFrame } from './ChartFrame'

// Synthetic values. TEST FIXTURE, not NASA data.
const meta: ExportMeta = {
  title: 'Harmonized count by year',
  unit: 'cell-days, local standard time, UTC-8',
  area: 'California region',
  range: { start: '2020-01-01', end: '2020-12-31' },
}
const live = {
  getOption: () => ({ series: [] }),
  getWidth: () => 600,
  getHeight: () => 280,
} as unknown as ECharts

function setup(fail = false) {
  const chart: OffscreenChart = {
    setOption: vi.fn(),
    getDataURL: () => 'data:image/png;base64,AAAA',
    renderToSVGString: () => {
      if (fail) throw new Error('boom')
      return '<svg></svg>'
    },
    dispose: vi.fn(),
  }
  const download = vi.fn<(blob: Blob, filename: string) => void>()
  const view = render(
    <ChartFrame
      title={meta.title}
      unit={meta.unit}
      summary="summary"
      exportSource={{
        target: { kind: 'chart', getChart: () => live },
        meta,
        deps: { createChart: () => Promise.resolve(chart), download },
      }}
    >
      <p>chart</p>
    </ChartFrame>,
  )
  return { download, view }
}

describe('ChartFrame export menu', () => {
  it('opens with the keyboard, lists PNG and SVG, and Escape returns focus', async () => {
    const user = userEvent.setup()
    const { view } = setup()
    const button = screen.getByRole('button', { name: 'Download chart' })
    expect(button.getAttribute('aria-haspopup')).toBe('menu')
    button.focus()
    await user.keyboard('{Enter}')
    const items = screen.getAllByRole('menuitem')
    expect(items.map((i) => i.textContent)).toEqual(['PNG image', 'SVG image'])
    expect(document.activeElement).toBe(items[0])
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(items[1])
    expect(await axe(view.container)).toHaveNoViolations()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(button)
  })

  it('downloads the chosen format', async () => {
    const user = userEvent.setup()
    const { download } = setup()
    await user.click(screen.getByRole('button', { name: 'Download chart' }))
    await user.click(screen.getByRole('menuitem', { name: 'PNG image' }))
    await waitFor(() => {
      expect(download).toHaveBeenCalledOnce()
    })
    expect(download.mock.calls[0]?.[1]).toMatch(/\.png$/)
  })

  it('shows an alert naming the file when the export fails', async () => {
    const user = userEvent.setup()
    const { download } = setup(true)
    await user.click(screen.getByRole('button', { name: 'Download chart' }))
    await user.click(screen.getByRole('menuitem', { name: 'SVG image' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/\.svg could not be created/)
    expect(download).not.toHaveBeenCalled()
  })
})

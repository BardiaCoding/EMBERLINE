import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ECharts needs a canvas, which jsdom does not have. The module is replaced by a recorder.
const chart = vi.hoisted(() => ({
  setOption: vi.fn(),
  dispatchAction: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
}))
vi.mock('echarts/core', () => ({ use: vi.fn(), init: vi.fn(() => chart) }))
vi.mock('echarts/charts', () => ({ BarChart: {}, LineChart: {}, ScatterChart: {} }))
vi.mock('echarts/components', () => ({
  GridComponent: {},
  LegendComponent: {},
  MarkLineComponent: {},
  TooltipComponent: {},
}))
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }))

import EChartCanvas from './EChartCanvas'

const labels = ['2012: 1.0', '2013: 2.0', '2014: 3.0']

function setup(onChart?: (c: unknown) => void) {
  const view = render(
    <EChartCanvas
      option={{ series: [] }}
      pointLabels={labels}
      titleId="t"
      summaryId="s"
      onChart={onChart}
    />,
  )
  return { view, group: screen.getByRole('group') }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('EChartCanvas', () => {
  it('draws the option, reports the chart and disposes it on unmount', () => {
    const onChart = vi.fn()
    const { view } = setup(onChart)
    expect(chart.setOption).toHaveBeenCalledWith({ series: [] }, { notMerge: true })
    expect(onChart).toHaveBeenCalledWith(chart)
    view.unmount()
    expect(chart.dispose).toHaveBeenCalledTimes(1)
    expect(onChart).toHaveBeenLastCalledWith(null)
  })

  it('is a focusable group named by the title and described by the summary and the key hint', () => {
    const { group } = setup()
    expect(group.getAttribute('tabindex')).toBe('0')
    expect(group.getAttribute('aria-labelledby')).toBe('t')
    expect(group.getAttribute('aria-describedby')?.split(' ')[0]).toBe('s')
    expect(
      document.getElementById(group.getAttribute('aria-describedby')?.split(' ')[1] ?? '')
        ?.textContent,
    ).toContain('arrow keys')
  })

  it('steps through the points with the arrow keys, showing the tooltip and announcing the point', () => {
    const { group } = setup()
    fireEvent.keyDown(group, { key: 'ArrowRight' })
    expect(chart.dispatchAction).toHaveBeenLastCalledWith({
      type: 'showTip',
      seriesIndex: 0,
      dataIndex: 0,
    })
    expect(screen.getByText('2012: 1.0')).toBeTruthy()
    fireEvent.keyDown(group, { key: 'ArrowRight' })
    fireEvent.keyDown(group, { key: 'ArrowRight' })
    fireEvent.keyDown(group, { key: 'ArrowRight' })
    // Stops at the last point.
    expect(chart.dispatchAction).toHaveBeenLastCalledWith({
      type: 'showTip',
      seriesIndex: 0,
      dataIndex: 2,
    })
    expect(screen.getByText('2014: 3.0')).toBeTruthy()
    fireEvent.keyDown(group, { key: 'ArrowLeft' })
    expect(screen.getByText('2013: 2.0')).toBeTruthy()
    fireEvent.keyDown(group, { key: 'Home' })
    expect(screen.getByText('2012: 1.0')).toBeTruthy()
    fireEvent.keyDown(group, { key: 'End' })
    expect(screen.getByText('2014: 3.0')).toBeTruthy()
  })

  it('Escape hides the tooltip, and Tab is left alone so there is no keyboard trap', () => {
    const { group } = setup()
    fireEvent.keyDown(group, { key: 'ArrowRight' })
    fireEvent.keyDown(group, { key: 'Escape' })
    expect(chart.dispatchAction).toHaveBeenLastCalledWith({ type: 'hideTip' })
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    group.dispatchEvent(tab)
    expect(tab.defaultPrevented).toBe(false)
  })
})

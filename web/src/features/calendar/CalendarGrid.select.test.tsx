import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { buildCalendarModel } from '@/lib/binning'
import { anomaly, month, result } from '@/lib/binning.fixtures'
import { CalendarGrid } from './CalendarGrid'

// Radix popper measures with ResizeObserver, which jsdom does not have.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

// Synthetic test values. TEST FIXTURE, not NASA data.
const model = buildCalendarModel(
  result([
    month(2002, 7, 120.5, { anomaly: anomaly(20, 20) }),
    month(2002, 8, 30, { anomaly: anomaly(-5, -14) }),
  ]),
  'counts',
)

type Kind = 'mouse' | 'touch' | 'pen'

function cellFor(label: RegExp): HTMLElement {
  return screen.getByRole('gridcell', { name: label })
}

/** The events a browser fires for one press and release: pointerdown, pointerup, then click. */
function press(el: HTMLElement, kind: Kind, at = { x: 100, y: 100 }, to = at): void {
  fireEvent.pointerDown(el, { pointerType: kind, clientX: at.x, clientY: at.y })
  fireEvent.pointerUp(el, { pointerType: kind, clientX: to.x, clientY: to.y })
  fireEvent.click(el, { clientX: to.x, clientY: to.y })
}

describe('CalendarGrid selection gestures (requirements 15.10, 15.24, 15.27)', () => {
  it.each<Kind>(['touch', 'pen'])(
    'a %s tap selects once: pointerup selects and the click that follows is ignored',
    (kind) => {
      const onSelect = vi.fn()
      render(<CalendarGrid model={model} onSelect={onSelect} />)

      press(cellFor(/^July 2002:/), kind)

      expect(onSelect).toHaveBeenCalledTimes(1)
      expect(onSelect).toHaveBeenCalledWith('2002-07')
    },
  )

  it('a touch tap selects on pointerup, before any click', () => {
    const onSelect = vi.fn()
    render(<CalendarGrid model={model} onSelect={onSelect} />)
    const cell = cellFor(/^July 2002:/)

    fireEvent.pointerDown(cell, { pointerType: 'touch', clientX: 10, clientY: 10 })
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.pointerUp(cell, { pointerType: 'touch', clientX: 10, clientY: 10 })

    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('a mouse click selects once, on click', () => {
    const onSelect = vi.fn()
    render(<CalendarGrid model={model} onSelect={onSelect} />)
    const cell = cellFor(/^July 2002:/)

    fireEvent.pointerDown(cell, { pointerType: 'mouse', clientX: 10, clientY: 10 })
    fireEvent.pointerUp(cell, { pointerType: 'mouse', clientX: 10, clientY: 10 })
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.click(cell)

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('2002-07')
  })

  it('userEvent.click (a real pointer sequence) selects once', async () => {
    const onSelect = vi.fn()
    render(<CalendarGrid model={model} onSelect={onSelect} />)

    await userEvent.setup().click(cellFor(/^August 2002:/))

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('2002-08')
  })

  it.each<Kind>(['mouse', 'touch', 'pen'])(
    'a %s drag of 8 px or more does not select, even when a click follows',
    (kind) => {
      const onSelect = vi.fn()
      render(<CalendarGrid model={model} onSelect={onSelect} />)

      press(cellFor(/^July 2002:/), kind, { x: 100, y: 100 }, { x: 108, y: 100 })

      expect(onSelect).not.toHaveBeenCalled()
    },
  )

  it.each<Kind>(['mouse', 'touch'])('a %s movement under 8 px still selects', (kind) => {
    const onSelect = vi.fn()
    render(<CalendarGrid model={model} onSelect={onSelect} />)

    press(cellFor(/^July 2002:/), kind, { x: 100, y: 100 }, { x: 105, y: 105 })

    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('selecting two cells in turn reports each once', () => {
    const onSelect = vi.fn()
    render(<CalendarGrid model={model} onSelect={onSelect} />)

    press(cellFor(/^July 2002:/), 'touch')
    press(cellFor(/^August 2002:/), 'mouse')

    expect(onSelect.mock.calls).toEqual([['2002-07'], ['2002-08']])
  })

  it('a click with no pointer events (assistive technology) selects', () => {
    const onSelect = vi.fn()
    render(<CalendarGrid model={model} onSelect={onSelect} />)

    fireEvent.click(cellFor(/^July 2002:/))

    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('does not select a month with no data by tap or click', () => {
    const onSelect = vi.fn()
    render(<CalendarGrid model={model} onSelect={onSelect} />)
    const noData = document.querySelector<HTMLElement>('[data-key="2002-09"]')
    expect(noData?.getAttribute('data-state')).toBe('no_data')

    if (noData !== null) {
      press(noData, 'touch')
      press(noData, 'mouse')
    }

    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('CalendarGrid hover tooltip by pointer type (requirement 15.24)', () => {
  it('a mouse hover shows the tooltip', async () => {
    render(<CalendarGrid model={model} onSelect={vi.fn()} />)

    await userEvent.setup().hover(cellFor(/^July 2002:/))

    expect((await screen.findByRole('tooltip')).textContent).toContain('July 2002')
  })

  it.each<Kind>(['touch', 'pen'])('%s pointer movement shows no tooltip', (kind) => {
    vi.useFakeTimers()
    try {
      render(<CalendarGrid model={model} onSelect={vi.fn()} />)
      const cell = cellFor(/^July 2002:/)

      fireEvent.pointerEnter(cell, { pointerType: kind })
      fireEvent.pointerMove(cell, { pointerType: kind, clientX: 5, clientY: 5 })
      act(() => {
        vi.advanceTimersByTime(1000)
      })

      expect(screen.queryByRole('tooltip')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keyboard focus still shows the tooltip after touch or pen use', async () => {
    render(<CalendarGrid model={model} onSelect={vi.fn()} />)
    const cell = cellFor(/^July 2002:/)

    fireEvent.pointerMove(cell, { pointerType: 'pen' })
    act(() => {
      cell.focus()
    })

    expect((await screen.findByRole('tooltip')).textContent).toContain('July 2002')
  })
})

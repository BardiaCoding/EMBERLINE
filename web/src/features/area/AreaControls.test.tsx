import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { vi } from 'vitest'
import { axe } from 'vitest-axe'
import type { ExampleArea } from '@/lib/api'
import type { DrawMode } from '@/features/map/selectionDrawing'
import { CoordinateInputs } from './CoordinateInputs'
import { DrawControls } from './DrawControls'
import { DrawHint } from './DrawHint'
import { DRAW_HINT_STORAGE_KEY, useDrawHint } from './useDrawHint'
import { ExampleAreas } from './ExampleAreas'

// Synthetic names and shapes. TEST FIXTURE, not NASA data and not the configured example areas.
const SQUARE = {
  type: 'Polygon' as const,
  coordinates: [
    [
      [-121, 36],
      [-120, 36],
      [-120, 37],
      [-121, 37],
      [-121, 36],
    ],
  ],
}
const AREAS: ExampleArea[] = [
  { name: 'Test area one', description: 'First synthetic description.', geometry: SQUARE },
  { name: 'Test area two', description: 'Second synthetic description.', geometry: SQUARE },
]

function ControlsHarness({ onClear = vi.fn() }: { onClear?: () => void }) {
  const [mode, setMode] = useState<DrawMode | null>(null)
  return (
    <>
      <p data-testid="mode">{mode ?? 'none'}</p>
      <DrawControls mode={mode} onModeChange={setMode} onClear={onClear} />
    </>
  )
}

describe('DrawControls', () => {
  it('names the buttons by their visible text and shows the active mode with aria-pressed', async () => {
    const user = userEvent.setup()
    render(<ControlsHarness />)
    const rectangle = screen.getByRole('button', { name: 'Draw rectangle' })
    const polygon = screen.getByRole('button', { name: 'Draw polygon' })
    expect(screen.getByRole('button', { name: 'Clear' })).toBeTruthy()
    expect(rectangle.getAttribute('aria-pressed')).toBe('false')

    await user.click(rectangle)
    expect(rectangle.getAttribute('aria-pressed')).toBe('true')
    expect(polygon.getAttribute('aria-pressed')).toBe('false')
    // A cue other than colour: the check icon is inside the active button.
    expect(rectangle.querySelector('svg')).not.toBeNull()
    expect(polygon.querySelector('svg')).toBeNull()
    expect(screen.getByTestId('mode').textContent).toBe('rectangle')

    await user.click(polygon)
    expect(screen.getByTestId('mode').textContent).toBe('polygon')
    expect(rectangle.getAttribute('aria-pressed')).toBe('false')

    // Pressing the active button again leaves the mode.
    await user.click(polygon)
    expect(screen.getByTestId('mode').textContent).toBe('none')
  })

  it('leaves drawing mode on Escape and ignores Escape when no mode is active', async () => {
    const user = userEvent.setup()
    render(<ControlsHarness />)
    await user.keyboard('{Escape}')
    expect(screen.getByTestId('mode').textContent).toBe('none')
    await user.click(screen.getByRole('button', { name: 'Draw polygon' }))
    await user.keyboard('{Escape}')
    expect(screen.getByTestId('mode').textContent).toBe('none')
    expect(screen.getByRole('button', { name: 'Draw polygon' }).getAttribute('aria-pressed')).toBe(
      'false',
    )
  })

  it('calls onClear from Clear and works by keyboard', async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()
    render(<ControlsHarness onClear={onClear} />)
    await user.tab()
    await user.tab()
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Clear' }))
    await user.keyboard('{Enter}')
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('has no accessibility violations', async () => {
    const { container } = render(<ControlsHarness />)
    expect(await axe(container)).toHaveNoViolations()
  })
})

function HintHarness() {
  const hint = useDrawHint()
  return hint.open ? <DrawHint onDismiss={hint.close} /> : <p>closed</p>
}

describe('DrawHint', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('is a note that does not take focus, and a dismiss closes it for the tab session', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<HintHarness />)
    const hint = screen.getByRole('note')
    expect(hint.textContent).toMatch(/Draw rectangle/)
    expect(hint.textContent).toMatch(/Draw polygon/)
    expect(hint.textContent).toMatch(/Clear/)
    expect(document.activeElement).toBe(document.body)

    await user.click(screen.getByRole('button', { name: 'Dismiss hint' }))
    expect(screen.queryByRole('note')).toBeNull()
    expect(window.sessionStorage.getItem(DRAW_HINT_STORAGE_KEY)).toBe('1')

    unmount()
    render(<HintHarness />)
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('shows the hint again when the stored value is not "1"', () => {
    window.sessionStorage.setItem(DRAW_HINT_STORAGE_KEY, '0')
    render(<HintHarness />)
    expect(screen.getByRole('note')).toBeTruthy()
  })

  it('does not throw when storage access is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const user = userEvent.setup()
    render(<HintHarness />)
    expect(screen.getByRole('note')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Dismiss hint' }))
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('has no accessibility violations', async () => {
    const { container } = render(<HintHarness />)
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('ExampleAreas', () => {
  it('renders one button per area from the list, with the description as its accessible description', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<ExampleAreas areas={AREAS} onSelect={onSelect} />)
    const button = screen.getByRole('button', { name: 'Test area two' })
    const describedBy = button.getAttribute('aria-describedby')
    expect(describedBy).not.toBeNull()
    expect(document.getElementById(describedBy ?? '')?.textContent).toBe(
      'Second synthetic description.',
    )
    await user.click(button)
    expect(onSelect).toHaveBeenCalledWith(SQUARE, 'Test area two')
  })

  it.each([[undefined], [[]]])('renders nothing for %j', (areas) => {
    const { container } = render(<ExampleAreas areas={areas} onSelect={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('skips an entry whose geometry is not a polygon', () => {
    const broken = {
      name: 'Broken',
      description: 'x',
      geometry: { type: 'Polygon', coordinates: ['no'] },
    }
    render(<ExampleAreas areas={[broken as ExampleArea, ...AREAS]} onSelect={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Broken' })).toBeNull()
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })

  it('has no accessibility violations', async () => {
    const { container } = render(<ExampleAreas areas={AREAS} onSelect={vi.fn()} />)
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('CoordinateInputs', () => {
  async function fill(
    user: ReturnType<typeof userEvent.setup>,
    values: [string, string, string, string],
  ) {
    const labels = ['West (longitude)', 'South (latitude)', 'East (longitude)', 'North (latitude)']
    for (const [i, label] of labels.entries()) {
      const input = screen.getByLabelText(label)
      await user.clear(input)
      if (values[i] !== '') await user.type(input, values[i]!)
    }
  }

  it('submits a valid rectangle once', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<CoordinateInputs onSubmit={onSubmit} />)
    await fill(user, ['-121.5', '36', '-119', '38'])
    await user.click(screen.getByRole('button', { name: 'Use these coordinates' }))
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      west: -121.5,
      south: 36,
      east: -119,
      north: 38,
    })
  })

  it('shows inline errors, sends nothing and keeps the typed values', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<CoordinateInputs onSubmit={onSubmit} />)
    await fill(user, ['-119', '38', '-121', '36'])
    await user.click(screen.getByRole('button', { name: 'Use these coordinates' }))

    expect(onSubmit).not.toHaveBeenCalled()
    const west = screen.getByLabelText<HTMLInputElement>('West (longitude)')
    expect(west.value).toBe('-119')
    expect(west.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByLabelText<HTMLInputElement>('North (latitude)').value).toBe('36')
    const alerts = screen.getAllByRole('alert').map((a) => a.textContent)
    expect(alerts).toContain('West must be less than east.')
    expect(alerts).toContain('South must be less than north.')
    // The error is tied to its input for assistive technology.
    expect(west.getAttribute('aria-describedby')).toContain(`${west.id}-error`)
  })

  it('marks each out-of-range field with its allowed range', async () => {
    const user = userEvent.setup()
    render(<CoordinateInputs onSubmit={vi.fn()} />)
    await fill(user, ['-200', '36', '-119', '95'])
    await user.click(screen.getByRole('button', { name: 'Use these coordinates' }))
    const alerts = screen.getAllByRole('alert').map((a) => a.textContent)
    expect(alerts).toEqual([
      'Longitude must be between -180 and 180.',
      'Latitude must be between -90 and 90.',
    ])
  })

  it('shows server errors on the matching inputs', () => {
    render(<CoordinateInputs onSubmit={vi.fn()} serverErrors={{ east: 'Server says no.' }} />)
    expect(screen.getByLabelText('East (longitude)').getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByRole('alert').textContent).toBe('Server says no.')
  })

  it('can be completed with the keyboard only', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<CoordinateInputs onSubmit={onSubmit} />)
    await user.tab()
    await user.keyboard('-121')
    await user.tab()
    await user.keyboard('36')
    await user.tab()
    await user.keyboard('-119')
    await user.tab()
    await user.keyboard('38{Enter}')
    expect(onSubmit).toHaveBeenCalledOnce()
  })

  it('has no accessibility violations, with and without errors', async () => {
    const user = userEvent.setup()
    const { container } = render(<CoordinateInputs onSubmit={vi.fn()} />)
    expect(await axe(container)).toHaveNoViolations()
    await user.click(screen.getByRole('button', { name: 'Use these coordinates' }))
    expect(screen.getAllByRole('alert')).toHaveLength(4)
    expect(await axe(container)).toHaveNoViolations()
  })
})

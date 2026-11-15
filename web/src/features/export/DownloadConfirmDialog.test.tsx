import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import fc from 'fast-check'
import { delay, http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import { ApiError, postHotspotEstimate, type HotspotExportRequest } from '@/lib/api'
import { server } from '@/test/server'
import { DownloadsMenu } from './DownloadsMenu'
import { formatApproxBytes, formatRows } from './estimateFormat'

// Synthetic estimates and CSV text. TEST FIXTURE, not NASA data.
const ORIGIN = window.location.origin
const EXPORT_PATH = `${ORIGIN}/api/v1/export/hotspots`
const ESTIMATE_PATH = `${EXPORT_PATH}/estimate`
const request: HotspotExportRequest = { geometry: null, start: '2020-08-01', end: '2020-08-31' }
const TRIGGER = 'Download hotspots (CSV)'

type Estimate = { rows: number; approx_bytes: number; over_limit: boolean; limit: number }
const SMALL: Estimate = {
  rows: 12_345,
  approx_bytes: 1_234_567,
  over_limit: false,
  limit: 2_000_000,
}
const HUGE: Estimate = {
  rows: 2_500_000,
  approx_bytes: 600_000_000,
  over_limit: true,
  limit: 2_000_000,
}

const COMPLETE = '# TEST FIXTURE, not NASA data\nsensor_family\nMODIS\n# rows: 1\n'

/** Counts the requests of the export and the estimate. */
function stubEndpoints(estimate: () => Response | Promise<Response>) {
  const calls = { estimate: 0, estimateBodies: [] as unknown[], exports: 0 }
  server.use(
    http.post(ESTIMATE_PATH, async ({ request: req }) => {
      calls.estimate += 1
      calls.estimateBodies.push(await req.json())
      return estimate()
    }),
    http.post(EXPORT_PATH, () => {
      calls.exports += 1
      return new HttpResponse(COMPLETE, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="hotspots_test.csv"',
        },
      })
    }),
  )
  return calls
}

function stubBlobDownload() {
  URL.createObjectURL = vi.fn(() => 'blob:test')
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
}

afterEach(() => {
  vi.restoreAllMocks()
})

async function openDialog() {
  const user = userEvent.setup()
  const trigger = screen.getByRole('button', { name: TRIGGER })
  await user.click(trigger)
  return { user, trigger }
}

describe('download confirmation dialog', () => {
  it('asks for the estimate with the area and dates and starts no download', async () => {
    const calls = stubEndpoints(() => HttpResponse.json(SMALL))
    render(<DownloadsMenu request={request} />)
    await openDialog()
    const dialog = await screen.findByRole('dialog', { name: 'Download hotspot CSV' })
    await within(dialog).findByText('12,345 detections')
    expect(calls.estimateBodies).toEqual([
      { geometry: null, start: '2020-08-01', end: '2020-08-31' },
    ])
    expect(calls.exports).toBe(0)
  })

  it('shows rows, the approximate size and the UTC-8 note', async () => {
    stubEndpoints(() => HttpResponse.json(SMALL))
    render(<DownloadsMenu request={request} />)
    await openDialog()
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText('12,345 detections')
    expect(within(dialog).getByText('about 1.2 MB (approximate)')).toBeTruthy()
    expect(dialog.textContent).toContain('UTC-8')
    expect(dialog.textContent).toContain('not individually harmonized')
    expect(within(dialog).getByRole('button', { name: 'Download' })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeTruthy()
  })

  it('downloads only after "Download" is activated, then closes and returns focus', async () => {
    stubBlobDownload()
    const calls = stubEndpoints(() => HttpResponse.json(SMALL))
    render(<DownloadsMenu request={request} />)
    const { user, trigger } = await openDialog()
    await user.click(await screen.findByRole('button', { name: 'Download' }))
    await waitFor(() => {
      expect(screen.getByTestId('download-status').textContent).toContain('Download finished')
    })
    expect(calls.exports).toBe(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    // Radix gives focus back to the previous control on the next tick.
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger)
    })
  })

  it('"Cancel" closes the dialog without a download and keeps the area', async () => {
    const calls = stubEndpoints(() => HttpResponse.json(SMALL))
    render(<DownloadsMenu request={request} />)
    const { user, trigger } = await openDialog()
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(calls.exports).toBe(0)
    // Radix gives focus back to the previous control on the next tick.
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger)
    })
    expect(screen.getByTestId('download-status').textContent).toBe('')
  })

  it('Escape cancels without a download', async () => {
    const calls = stubEndpoints(() => HttpResponse.json(SMALL))
    render(<DownloadsMenu request={request} />)
    const { user } = await openDialog()
    await screen.findByText('12,345 detections')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(calls.exports).toBe(0)
  })

  it('moves focus into the dialog and keeps Tab inside it', async () => {
    stubEndpoints(() => HttpResponse.json(SMALL))
    render(<DownloadsMenu request={request} />)
    const { user } = await openDialog()
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText('12,345 detections')
    expect(dialog.contains(document.activeElement)).toBe(true)
    for (let i = 0; i < 5; i += 1) {
      await user.tab()
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
  })

  it('cancelling while the estimate is loading ends it and downloads nothing', async () => {
    const calls = stubEndpoints(async () => {
      await delay('infinite')
      return HttpResponse.json(SMALL)
    })
    render(<DownloadsMenu request={request} />)
    const { user } = await openDialog()
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Estimating the size of the file…')).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: 'Download' })).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(calls.exports).toBe(0)
  })

  it('over the limit shows the limit message, no "Download" button, and only a close action', async () => {
    const calls = stubEndpoints(() => HttpResponse.json(HUGE))
    render(<DownloadsMenu request={request} />)
    const { user, trigger } = await openDialog()
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText(/2,500,000 detections/)
    expect(dialog.textContent).toContain('over the limit of 2,000,000 rows')
    expect(dialog.textContent).toContain('Narrow the area or the dates')
    expect(within(dialog).queryByRole('button', { name: 'Download' })).toBeNull()
    const buttons = within(dialog).getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['Close'])
    await user.click(buttons[0] as HTMLElement)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(calls.exports).toBe(0)
    // Radix gives focus back to the previous control on the next tick.
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger)
    })
  })

  it('a failed estimate shows the error and Retry, starts no download, and Retry asks again', async () => {
    let answer: 'fail' | 'ok' = 'fail'
    const calls = stubEndpoints(() =>
      answer === 'fail'
        ? HttpResponse.json(
            {
              error: {
                code: 'internal',
                message: 'The server broke.',
                fields: [],
                request_id: 'r',
              },
            },
            { status: 500 },
          )
        : HttpResponse.json(SMALL),
    )
    render(<DownloadsMenu request={request} />)
    const { user } = await openDialog()
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText(/The server broke\./)
    expect(dialog.textContent).toContain('Your area and dates are unchanged')
    expect(within(dialog).queryByRole('button', { name: 'Download' })).toBeNull()
    expect(calls.exports).toBe(0)
    answer = 'ok'
    await user.click(within(dialog).getByRole('button', { name: 'Retry' }))
    await within(dialog).findByText('12,345 detections')
    expect(calls.estimate).toBe(2)
    // The retry asked for the same area and dates.
    expect(calls.estimateBodies[1]).toEqual(calls.estimateBodies[0])
  })

  it('shows an error with Retry when the estimate does not answer within 30 seconds', async () => {
    const original = AbortSignal.timeout.bind(AbortSignal)
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => original(30))
    const calls = stubEndpoints(async () => {
      await delay('infinite')
      return HttpResponse.json(SMALL)
    })
    render(<DownloadsMenu request={request} />)
    await openDialog()
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText(/timed out after 30 seconds/)
    expect(timeout).toHaveBeenCalledWith(30_000)
    expect(within(dialog).getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: 'Download' })).toBeNull()
    expect(calls.exports).toBe(0)
  })

  it('has no axe violations while loading, ready, over the limit and failed', async () => {
    let next: () => Response | Promise<Response> = () => HttpResponse.json(SMALL)
    stubEndpoints(() => next())
    const states: [string, () => Response | Promise<Response>][] = [
      ['ready', () => HttpResponse.json(SMALL)],
      ['over', () => HttpResponse.json(HUGE)],
      ['error', () => new HttpResponse('Bad gateway', { status: 502 })],
    ]
    for (const [, factory] of states) {
      next = factory
      const { unmount } = render(<DownloadsMenu request={request} />)
      const { user } = await openDialog()
      const dialog = await screen.findByRole('dialog')
      await waitFor(() => {
        expect(within(dialog).queryByText('Estimating the size of the file…')).toBeNull()
      })
      expect(await axe(document.body)).toHaveNoViolations()
      await user.keyboard('{Escape}')
      unmount()
    }
  })
})

describe('postHotspotEstimate', () => {
  it('returns the estimate and throws an ApiError for an invalid area', async () => {
    server.use(http.post(ESTIMATE_PATH, () => HttpResponse.json(SMALL)))
    expect(await postHotspotEstimate(request)).toEqual(SMALL)
    server.use(
      http.post(ESTIMATE_PATH, () =>
        HttpResponse.json(
          { error: { code: 'outside_coverage', message: 'Outside.', fields: [], request_id: 'r' } },
          { status: 422 },
        ),
      ),
    )
    const error: unknown = await postHotspotEstimate(request).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 422, code: 'outside_coverage' })
  })
})

describe('formatApproxBytes and formatRows', () => {
  it.each([
    [0, '0 B'],
    [950, '950 B'],
    [1_000, '1 kB'],
    [54_321, '54 kB'],
    [999_600, '1 MB'],
    [1_234_567, '1.2 MB'],
    [600_000_000, '600 MB'],
    [3_400_000_000, '3.4 GB'],
  ])('writes %d bytes as %s', (bytes, expected) => {
    expect(formatApproxBytes(bytes)).toBe(expected)
  })

  it('stays within 5 percent of the input, with at most 2 significant figures', () => {
    const factor: Record<string, number> = { B: 1, kB: 1e3, MB: 1e6, GB: 1e9 }
    fc.assert(
      fc.property(fc.integer({ min: 100, max: 50_000_000_000 }), (bytes) => {
        const [value, unit] = formatApproxBytes(bytes).replaceAll(',', '').split(' ')
        const shown = Number(value) * (factor[unit ?? ''] ?? Number.NaN)
        expect(Math.abs(shown - bytes) / bytes).toBeLessThanOrEqual(0.051)
        expect(
          String(Number(value)).replace(/\D/g, '').replace(/0+$/, '').length,
        ).toBeLessThanOrEqual(2)
      }),
    )
  })

  it('writes row counts with thousands separators', () => {
    expect(formatRows(0)).toBe('0')
    expect(formatRows(2_000_000)).toBe('2,000,000')
  })
})

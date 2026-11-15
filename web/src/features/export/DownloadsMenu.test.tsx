import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import fc from 'fast-check'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import {
  ApiError,
  FALLBACK_EXPORT_FILENAME,
  filenameFromContentDisposition,
  postHotspotExport,
  type HotspotExportRequest,
} from '@/lib/api'
import { server } from '@/test/server'
import { DownloadsMenu } from './DownloadsMenu'
import { endsWithRowsFooter } from './hotspotDownload'

// Synthetic CSV text. TEST FIXTURE, not NASA data.
const ORIGIN = window.location.origin
const URL_PATH = `${ORIGIN}/api/v1/export/hotspots`
const ESTIMATE_PATH = `${URL_PATH}/estimate`
const request: HotspotExportRequest = { geometry: null, start: '2020-08-01', end: '2020-08-31' }
const HEAD = '# TEST FIXTURE, not NASA data\nsensor_family,satellite\n'
const COMPLETE = `${HEAD}MODIS,Terra\nVIIRS,N20\n# rows: 2\n`
const DISPOSITION = 'attachment; filename="hotspots_California-region_2020-08-01_2020-08-31.csv"'

const encoder = new TextEncoder()

function csvResponse(chunks: string[], headers: Record<string, string> = {}, failAfter = false) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      if (failAfter) controller.error(new Error('server stopped'))
      else controller.close()
    },
  })
  return new HttpResponse(stream, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': DISPOSITION,
      ...headers,
    },
  })
}

/** Records Blob downloads: the Blob passed to `createObjectURL` and the name of each saved file. */
function stubBlobDownload() {
  const blobs: Blob[] = []
  const names: string[] = []
  URL.createObjectURL = vi.fn((blob: Blob | MediaSource) => {
    blobs.push(blob as Blob)
    return 'blob:test'
  })
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    names.push(this.download)
  })
  return { blobs, names }
}

/** jsdom's Blob has no `text()`. */
function readBlob(blob: Blob | undefined): Promise<string> {
  return new Promise((resolve, reject) => {
    if (blob === undefined) {
      reject(new Error('No Blob was saved'))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      resolve(reader.result as string)
    }
    reader.onerror = () => {
      reject(new Error('Blob could not be read'))
    }
    reader.readAsText(blob)
  })
}

const windowWithPicker = window as unknown as { showSaveFilePicker?: unknown }

beforeEach(() => {
  delete windowWithPicker.showSaveFilePicker
  // Synthetic estimate. TEST FIXTURE, not NASA data.
  server.use(
    http.post(ESTIMATE_PATH, () =>
      HttpResponse.json({ rows: 2, approx_bytes: 900, over_limit: false, limit: 2_000_000 }),
    ),
  )
})
afterEach(() => {
  vi.restoreAllMocks()
  delete windowWithPicker.showSaveFilePicker
})

/** Opens the confirmation and activates its "Download" button. */
async function clickDownload() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Download hotspots (CSV)' }))
  await user.click(await screen.findByRole('button', { name: 'Download' }))
}

describe('DownloadsMenu with the Blob fallback', () => {
  it('posts the area and exact dates, saves the file under the server name and announces it', async () => {
    const saved = stubBlobDownload()
    let body: unknown = null
    server.use(
      http.post(URL_PATH, async ({ request: req }) => {
        body = await req.json()
        return csvResponse([HEAD, 'MODIS,Terra\nVIIRS,N20\n', '# rows: 2\n'])
      }),
    )
    render(<DownloadsMenu request={request} />)
    await clickDownload()
    await waitFor(() => {
      expect(screen.getByTestId('download-status').textContent).toContain('Download finished')
    })
    expect(body).toEqual({ geometry: null, start: '2020-08-01', end: '2020-08-31' })
    expect(saved.names).toEqual(['hotspots_California-region_2020-08-01_2020-08-31.csv'])
    expect(await readBlob(saved.blobs[0])).toBe(COMPLETE)
    expect(screen.getByTestId('download-status').getAttribute('role')).toBe('status')
  })

  it('reports "Download incomplete" when the file does not end with # rows:', async () => {
    const saved = stubBlobDownload()
    server.use(http.post(URL_PATH, () => csvResponse([HEAD, 'MODIS,Terra\n'])))
    render(<DownloadsMenu request={request} />)
    await clickDownload()
    await waitFor(() => {
      expect(screen.getByTestId('download-status').textContent).toContain('Download incomplete')
    })
    expect(screen.getByTestId('download-status').textContent).not.toContain('finished')
    expect(saved.blobs).toHaveLength(1)
  })

  it('reports "Download incomplete" when the stream fails after it started', async () => {
    stubBlobDownload()
    server.use(http.post(URL_PATH, () => csvResponse([HEAD, 'MODIS,Terra\n'], {}, true)))
    render(<DownloadsMenu request={request} />)
    await clickDownload()
    await waitFor(() => {
      expect(screen.getByTestId('download-status').textContent).toContain('Download incomplete')
    })
  })

  it('shows the message of the error envelope and saves nothing', async () => {
    const saved = stubBlobDownload()
    server.use(
      http.post(URL_PATH, () =>
        HttpResponse.json(
          {
            error: {
              code: 'export_too_large',
              message:
                'The query has 2,500,000 detections, which is over the limit of 2,000,000 rows. Narrow the area or the date range.',
              fields: [{ field: 'query', reason: '2500000 rows; the limit is 2000000' }],
              request_id: 'r1',
            },
          },
          { status: 422 },
        ),
      ),
    )
    render(<DownloadsMenu request={request} />)
    await clickDownload()
    await waitFor(() => {
      expect(screen.getByTestId('download-status').textContent).toContain('2,500,000 detections')
    })
    expect(screen.getByTestId('download-status').textContent).toContain('2,000,000 rows')
    expect(saved.blobs).toHaveLength(0)
    // The button is usable again.
    expect(
      screen.getByRole('button', { name: 'Download hotspots (CSV)' }).getAttribute('aria-disabled'),
    ).toBe('false')
  })

  it('shows a generic message when the server answers without the envelope', async () => {
    stubBlobDownload()
    server.use(http.post(URL_PATH, () => new HttpResponse('Bad gateway', { status: 502 })))
    render(<DownloadsMenu request={request} />)
    await clickDownload()
    await waitFor(() => {
      expect(screen.getByTestId('download-status').textContent).toContain('status 502')
    })
  })

  it('is disabled without a request', async () => {
    render(<DownloadsMenu request={null} />)
    expect(
      screen.getByRole('button', { name: 'Download hotspots (CSV)' }).getAttribute('aria-disabled'),
    ).toBe('true')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Download hotspots (CSV)' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByTestId('download-status').textContent).toBe('')
  })

  it('has no axe violations', async () => {
    const { container } = render(<DownloadsMenu request={request} />)
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('DownloadsMenu with showSaveFilePicker', () => {
  it('streams the chunks to the chosen file and closes it', async () => {
    const written: string[] = []
    const writable = {
      write: vi.fn((chunk: Uint8Array) => {
        written.push(new TextDecoder().decode(chunk))
        return Promise.resolve()
      }),
      close: vi.fn(() => Promise.resolve()),
      abort: vi.fn(() => Promise.resolve()),
    }
    const picker = vi.fn(() => Promise.resolve({ createWritable: () => Promise.resolve(writable) }))
    windowWithPicker.showSaveFilePicker = picker
    const saved = stubBlobDownload()
    server.use(
      http.post(URL_PATH, () => csvResponse([HEAD, 'MODIS,Terra\nVIIRS,N20\n', '# rows: 2\n'])),
    )
    render(<DownloadsMenu request={request} />)
    await clickDownload()
    await waitFor(() => {
      expect(screen.getByTestId('download-status').textContent).toContain('Download finished')
    })
    expect(picker).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestedName: 'hotspots_California-region_2020-08-01_2020-08-31.csv',
      }),
    )
    expect(written.join('')).toBe(COMPLETE)
    expect(writable.close).toHaveBeenCalledTimes(1)
    expect(saved.blobs).toHaveLength(0)
  })

  it('falls back to the Blob when the picker refuses (no user activation)', async () => {
    windowWithPicker.showSaveFilePicker = vi.fn(() =>
      Promise.reject(new DOMException('needs a user gesture', 'SecurityError')),
    )
    const saved = stubBlobDownload()
    server.use(http.post(URL_PATH, () => csvResponse([COMPLETE])))
    render(<DownloadsMenu request={request} />)
    await clickDownload()
    await waitFor(() => {
      expect(screen.getByTestId('download-status').textContent).toContain('Download finished')
    })
    expect(saved.blobs).toHaveLength(1)
  })

  it('cancels without saving when the user closes the picker', async () => {
    windowWithPicker.showSaveFilePicker = vi.fn(() =>
      Promise.reject(new DOMException('closed', 'AbortError')),
    )
    const saved = stubBlobDownload()
    server.use(http.post(URL_PATH, () => csvResponse([COMPLETE])))
    render(<DownloadsMenu request={request} />)
    await clickDownload()
    await waitFor(() => {
      expect(screen.getByTestId('download-status').textContent).toBe('Download cancelled.')
    })
    expect(saved.blobs).toHaveLength(0)
  })

  it('marks a partial file in the picker as incomplete', async () => {
    const writable = {
      write: vi.fn(() => Promise.resolve()),
      close: vi.fn(() => Promise.resolve()),
      abort: vi.fn(() => Promise.resolve()),
    }
    windowWithPicker.showSaveFilePicker = vi.fn(() =>
      Promise.resolve({ createWritable: () => Promise.resolve(writable) }),
    )
    server.use(http.post(URL_PATH, () => csvResponse([HEAD, 'MODIS,Terra\n'], {}, true)))
    render(<DownloadsMenu request={request} />)
    await clickDownload()
    await waitFor(() => {
      expect(screen.getByTestId('download-status').textContent).toContain('Download incomplete')
    })
    expect(writable.close).toHaveBeenCalledTimes(1)
  })
})

describe('filenameFromContentDisposition', () => {
  it.each([
    [
      'attachment; filename="hotspots_a_2020-01-01_2020-01-31.csv"',
      'hotspots_a_2020-01-01_2020-01-31.csv',
    ],
    ['attachment; filename=plain.csv', 'plain.csv'],
    ["attachment; filename*=UTF-8''caf%C3%A9.csv", 'café.csv'],
    ['attachment; filename="fallback.csv"; filename*=UTF-8\'\'real%20name.csv', 'real name.csv'],
    ['attachment; filename="a\\"b.csv"', 'ab.csv'],
    ['attachment; filename="../../etc/passwd"', 'passwd'],
    ['attachment; filename="C:\\\\temp\\\\x.csv"', 'x.csv'],
  ])('reads %s', (header, expected) => {
    expect(filenameFromContentDisposition(header)).toBe(expected)
  })

  it('returns null without a usable file name', () => {
    expect(filenameFromContentDisposition(null)).toBeNull()
    expect(filenameFromContentDisposition('attachment')).toBeNull()
    expect(filenameFromContentDisposition('attachment; filename=""')).toBeNull()
    expect(filenameFromContentDisposition('attachment; filename="..."')).toBeNull()
  })

  it('never returns a path separator, a control or a reserved character', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (raw) => {
        const name = filenameFromContentDisposition(`attachment; filename="${raw}"`)
        if (name !== null) {
          // eslint-disable-next-line no-control-regex -- the test checks for exactly these characters
          expect(name).not.toMatch(/[\\/<>:"|?*\u0000-\u001f\u007f]/)
          expect(name.length).toBeLessThanOrEqual(150)
        }
      }),
    )
  })

  it('uses the fallback name when the response has no Content-Disposition', async () => {
    server.use(
      http.post(URL_PATH, () => new HttpResponse('x', { headers: { 'Content-Type': 'text/csv' } })),
    )
    const { filename, body } = await postHotspotExport(request)
    await new Response(body).text()
    expect(filename).toBe(FALLBACK_EXPORT_FILENAME)
  })
})

describe('postHotspotExport', () => {
  it('throws an ApiError with the envelope code for a non-2xx answer', async () => {
    server.use(
      http.post(URL_PATH, () =>
        HttpResponse.json(
          {
            error: {
              code: 'invalid_geometry',
              message: 'Bad shape.',
              fields: [],
              request_id: null,
            },
          },
          { status: 422 },
        ),
      ),
    )
    const error: unknown = await postHotspotExport(request).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ kind: 'http', status: 422, code: 'invalid_geometry' })
  })

  it('has no 30 s timeout on the body: a slow stream is read to the end', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    try {
      server.use(http.post(URL_PATH, () => csvResponse([COMPLETE])))
      const { body } = await postHotspotExport(request)
      await vi.advanceTimersByTimeAsync(60_000)
      const text = await new Response(body).text()
      expect(text).toBe(COMPLETE)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('endsWithRowsFooter', () => {
  it('accepts the footer line and rejects a missing or cut one', () => {
    expect(endsWithRowsFooter('a,b\n# rows: 0\n')).toBe(true)
    expect(endsWithRowsFooter('# rows: 12\n')).toBe(true)
    expect(endsWithRowsFooter('a,b\n1,2\n')).toBe(false)
    expect(endsWithRowsFooter('a,b\n# rows: 1')).toBe(false)
    expect(endsWithRowsFooter('a,b\n# rows: \n')).toBe(false)
  })

  it('is true for any content followed by a footer and false when the footer is cut', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: fc.constantFrom('a', 'b', ',', '1', '#', ' ', '\n') }),
        fc.nat(),
        (content, rows) => {
          const footer = `# rows: ${rows}\n`
          const text = `${content}\n${footer}`
          expect(endsWithRowsFooter(text)).toBe(true)
          expect(endsWithRowsFooter(text.slice(0, -1))).toBe(false)
        },
      ),
    )
  })
})

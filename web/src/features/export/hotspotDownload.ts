import { postHotspotExport, type HotspotExportRequest } from '@/lib/api'

/**
 * Hotspot CSV download (requirements 17.3, 17.8). The file is read as a stream and never held
 * in memory when the browser can write it to disk (`showSaveFilePicker`); otherwise the
 * chunks are collected into a Blob. A complete file ends with the line `# rows: N`. A file
 * without it was cut short by a server failure or a dropped connection.
 */

/** How many trailing bytes are kept to look for the final `# rows: N` line. */
const TAIL_BYTES = 256

/** The part of the File System Access API that is used here. */
type SaveFileHandle = {
  createWritable: () => Promise<{
    write: (chunk: Uint8Array<ArrayBuffer>) => Promise<void>
    close: () => Promise<void>
    abort: () => Promise<void>
  }>
}

type SaveFilePicker = (options: {
  suggestedName: string
  types: { description: string; accept: Record<string, string[]> }[]
}) => Promise<SaveFileHandle>

export type DownloadMethod = 'file-picker' | 'blob'

export type DownloadOutcome =
  | { status: 'complete'; filename: string; method: DownloadMethod; bytes: number }
  /** The file was saved but does not end with `# rows: N`. */
  | { status: 'incomplete'; filename: string; method: DownloadMethod; bytes: number }
  /** The user closed the file picker or cancelled the download. Nothing was saved. */
  | { status: 'cancelled' }

/**
 * True when `tail` (the last bytes of the file as text) ends with the complete `# rows: N`
 * line. The server writes the line with its newline, so a line cut after some digits (for
 * example `# rows: 1` of `# rows: 12`) does not count as complete.
 */
export function endsWithRowsFooter(tail: string): boolean {
  return /(?:^|\n)# rows: \d+\r?\n$/.test(tail)
}

function appendTail(previous: Uint8Array, chunk: Uint8Array): Uint8Array {
  const kept = chunk.length > TAIL_BYTES ? chunk.subarray(chunk.length - TAIL_BYTES) : chunk
  const joined = new Uint8Array(previous.length + kept.length)
  joined.set(previous)
  joined.set(kept, previous.length)
  return joined.length > TAIL_BYTES ? joined.slice(joined.length - TAIL_BYTES) : joined
}

type Sink = {
  write: (chunk: Uint8Array) => Promise<void>
  /** Finishes the file and hands it to the user. */
  finish: () => Promise<void>
  /** Discards what was written. */
  discard: () => Promise<void>
}

function getFilePicker(): SaveFilePicker | null {
  const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker
  return typeof picker === 'function' ? picker.bind(window) : null
}

function blobSink(filename: string): Sink {
  const parts: Uint8Array<ArrayBuffer>[] = []
  return {
    write: (chunk) => {
      parts.push(new Uint8Array(chunk))
      return Promise.resolve()
    },
    finish: () => {
      const url = URL.createObjectURL(new Blob(parts, { type: 'text/csv;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      link.hidden = true
      document.body.append(link)
      link.click()
      link.remove()
      // Revoke after the browser has started the save.
      setTimeout(() => {
        URL.revokeObjectURL(url)
      }, 10_000)
      return Promise.resolve()
    },
    discard: () => {
      parts.length = 0
      return Promise.resolve()
    },
  }
}

/** A sink writing to a file the user chose, or null when the picker is unavailable or refused. */
async function pickerSink(filename: string): Promise<Sink | null> {
  const picker = getFilePicker()
  if (picker === null) return null
  let handle: SaveFileHandle
  try {
    handle = await picker({
      suggestedName: filename,
      types: [{ description: 'CSV file', accept: { 'text/csv': ['.csv'] } }],
    })
  } catch (error) {
    // The user closed the dialog: no download. Any other refusal (for example the click
    // happened too long ago for the browser to allow a dialog) falls back to the Blob.
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    return null
  }
  const writable = await handle.createWritable()
  return {
    write: (chunk) => writable.write(new Uint8Array(chunk)),
    finish: () => writable.close(),
    discard: () => writable.abort(),
  }
}

/**
 * Downloads the hotspot CSV of `request`. Resolves with `complete` or `incomplete` (the file
 * is saved in both cases; an incomplete one lacks the final `# rows:` line) or `cancelled`.
 * @throws ApiError when the server refuses the request (for example 422 `export_too_large`,
 * nothing is streamed then) or cannot be reached.
 */
export async function downloadHotspotCsv(
  request: HotspotExportRequest,
  options: { signal?: AbortSignal } = {},
): Promise<DownloadOutcome> {
  const { signal } = options
  const { body, filename } = await postHotspotExport(request, { signal })
  const reader = body.getReader()
  let sink: Sink | null
  try {
    sink = await pickerSink(filename)
  } catch {
    // Not awaited: the user is waiting for the dialog to close, not for the socket.
    void reader.cancel().catch(() => undefined)
    return { status: 'cancelled' }
  }
  const method: DownloadMethod = sink === null ? 'blob' : 'file-picker'
  sink ??= blobSink(filename)
  let tail: Uint8Array = new Uint8Array(0)
  let bytes = 0
  let streamFailed = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.length
      tail = appendTail(tail, value)
      await sink.write(value)
    }
  } catch {
    if (signal?.aborted) {
      await sink.discard().catch(() => undefined)
      return { status: 'cancelled' }
    }
    // The connection broke or the server stopped writing: keep what arrived, report it.
    streamFailed = true
  }
  await sink.finish()
  const complete = !streamFailed && endsWithRowsFooter(new TextDecoder().decode(tail))
  return { status: complete ? 'complete' : 'incomplete', filename, method, bytes }
}

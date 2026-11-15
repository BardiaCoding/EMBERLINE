// Feature: harmonized-fire-calendar, Property 35: Export file names are safe
// Validates: Requirements 18.3
// @vitest-environment node
// Inputs are synthetic. Shared vectors come from the Python reference implementation.
import { readFileSync } from 'node:fs'
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { exportFilename, MAX_STEM_CHARS, sanitizeFilename } from '@/lib/filenames'

const SAFE_STEM = /^[A-Za-z0-9_-]+$/

const text = fc.oneof(
  fc.string({ unit: 'binary', maxLength: 300 }),
  fc
    .array(
      fc.constantFrom(
        '/',
        '\\',
        '.',
        '..',
        ' ',
        ':',
        '*',
        '?',
        '"',
        '<',
        '>',
        '|',
        '%',
        '\n',
        'é',
        'ñ',
        '日本',
        'a',
        'Z',
        '-',
        '_',
      ),
      { maxLength: 100 },
    )
    .map((p) => p.join('')),
)
const isoDate = fc
  .date({
    min: new Date('2000-01-01T00:00:00Z'),
    max: new Date('2100-12-31T00:00:00Z'),
    noInvalidDate: true,
  })
  .map((d) => d.toISOString().slice(0, 10))
const extension = fc.stringMatching(/^[a-z0-9]{1,10}$/)

describe('Property 35: export file names are safe', () => {
  it('stem is safe, bounded and deterministic', () => {
    fc.assert(
      fc.property(text, text, isoDate, isoDate, extension, (kind, area, start, end, ext) => {
        const name = exportFilename(kind.slice(0, 60), area, start, end, ext)
        expect(exportFilename(kind.slice(0, 60), area, start, end, ext)).toBe(name)
        const dot = name.lastIndexOf('.')
        expect(name.slice(dot + 1)).toBe(ext)
        const stem = name.slice(0, dot)
        expect(stem).toMatch(SAFE_STEM)
        expect(stem.length).toBeLessThanOrEqual(MAX_STEM_CHARS)
      }),
    )
  })

  it('sanitizeFilename is safe and bounded', () => {
    fc.assert(
      fc.property(text, fc.integer({ min: 1, max: 150 }), (t, max) => {
        const out = sanitizeFilename(t, max)
        expect(out).toMatch(SAFE_STEM)
        expect(out.length).toBeLessThanOrEqual(max)
      }),
    )
  })
})

interface Vectors {
  sanitize: { text: string; max_chars: number; expected: string }[]
  export: {
    kind: string
    area: string
    start: string
    end: string
    extension: string
    expected: string
  }[]
}
const vectors = JSON.parse(
  readFileSync(new URL('../../../tests/data/filename_vectors.json', import.meta.url), 'utf8'),
) as Vectors

describe('TypeScript matches the Python reference on shared vectors', () => {
  it('sanitizeFilename', () => {
    for (const v of vectors.sanitize) {
      expect(sanitizeFilename(v.text, v.max_chars), JSON.stringify(v.text)).toBe(v.expected)
    }
  })
  it('exportFilename', () => {
    for (const v of vectors.export) {
      expect(exportFilename(v.kind, v.area, v.start, v.end, v.extension)).toBe(v.expected)
    }
  })
})

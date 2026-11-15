import { describe, expect, it } from 'vitest'
import { exportFilename, MAX_STEM_CHARS, sanitizeFilename } from './filenames'

describe('sanitizeFilename', () => {
  it('folds accents and replaces unsafe runs with one hyphen', () => {
    expect(sanitizeFilename('Sierra Nevada / Tahoe')).toBe('Sierra-Nevada-Tahoe')
    expect(sanitizeFilename('Cañón')).toBe('Canon')
  })
  it('falls back when nothing is left and trims edges', () => {
    expect(sanitizeFilename('日本')).toBe('export')
    expect(sanitizeFilename('--a b--')).toBe('a-b')
  })
  it('limits the length', () => {
    expect(sanitizeFilename('a'.repeat(300)).length).toBe(MAX_STEM_CHARS)
  })
})

describe('exportFilename', () => {
  it('joins kind, area and dates', () => {
    expect(
      exportFilename(
        'Harmonized count by year',
        'California region',
        '2020-01-01',
        '2020-12-31',
        'png',
      ),
    ).toBe('Harmonized-count-by-year_California-region_2020-01-01_2020-12-31.png')
  })
  it('keeps the stem within 100 characters and rejects bad extensions', () => {
    const name = exportFilename('k'.repeat(50), 'x'.repeat(200), '2020-01-01', '2020-12-31', 'svg')
    expect(name.length - '.svg'.length).toBeLessThanOrEqual(MAX_STEM_CHARS)
    expect(() => exportFilename('a', 'b', '2020-01-01', '2020-12-31', 'PNG')).toThrow()
  })
})

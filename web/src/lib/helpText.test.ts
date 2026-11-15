// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import helpTextJson from './helpText.json'
import { HELP_KEYS, helpText } from './helpText'

// Completeness and placement rules for the six help sentences.
// Requirements 15.21, 15.22, 15.23.

const MAX_WORDS = 30
const SRC_DIR = path.resolve(import.meta.dirname, '..')
const JSON_FILE = path.resolve(import.meta.dirname, 'helpText.json')

const wordCount = (text: string): number => text.trim().split(/\s+/).length

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : []
  })
}

describe('helpText.json completeness', () => {
  it('has exactly the six keys of HELP_KEYS', () => {
    expect([...HELP_KEYS].sort()).toEqual(
      [
        'anomaly',
        'baseline_median',
        'harmonized_count',
        'percentile_rank',
        'uncertainty_interval',
        'z_score',
      ].sort(),
    )
    expect(Object.keys(helpTextJson).sort()).toEqual([...HELP_KEYS].sort())
  })

  it.each(HELP_KEYS)('%s is one sentence of 1 to 30 words', (key) => {
    const sentence = helpText(key)
    expect(typeof sentence).toBe('string')
    expect(wordCount(sentence)).toBeGreaterThanOrEqual(1)
    expect(wordCount(sentence)).toBeLessThanOrEqual(MAX_WORDS)
    // One sentence: a single full stop, at the end.
    expect(sentence.trim().endsWith('.')).toBe(true)
    expect(sentence.trim().slice(0, -1)).not.toMatch(/[.!?]/)
  })

  it('says cell-days on the MODIS-equivalent scale for the harmonized count', () => {
    expect(helpText('harmonized_count')).toMatch(/cell-days/)
    expect(helpText('harmonized_count')).toMatch(/MODIS-equivalent/)
  })

  it('uses no two identical sentences', () => {
    const sentences = HELP_KEYS.map((key) => helpText(key))
    expect(new Set(sentences).size).toBe(sentences.length)
  })
})

describe('help sentence placement', () => {
  it('appears in no source file other than helpText.json', () => {
    const files = sourceFiles(SRC_DIR)
    expect(files.length).toBeGreaterThan(0)
    const offences: string[] = []
    for (const file of files) {
      const content = readFileSync(file, 'utf8')
      for (const key of HELP_KEYS) {
        if (content.includes(helpText(key))) {
          offences.push(`${path.relative(SRC_DIR, file)}: ${key}`)
        }
      }
    }
    expect(offences).toEqual([])
    // The JSON file itself is the one place that holds them.
    const json = readFileSync(JSON_FILE, 'utf8')
    for (const key of HELP_KEYS) expect(json).toContain(helpText(key))
  })
})

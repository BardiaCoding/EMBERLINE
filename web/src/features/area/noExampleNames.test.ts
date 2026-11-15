// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Requirement 11.16: example area names and geometries come only from `/meta`. The names
// configured in `config/app.yaml` must not appear in any front-end source file.
const SRC = new URL('../../', import.meta.url)
const CONFIG = new URL('../../../../config/app.yaml', import.meta.url)

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    const isSource = /\.(ts|tsx|css|json)$/.test(entry)
    const isTest = /\.test\.(ts|tsx)$/.test(entry) || path.includes(join('src', 'test'))
    return isSource && !isTest ? [path] : []
  })
}

function configuredNames(): string[] {
  const yaml = readFileSync(fileURLToPath(CONFIG), 'utf8')
  const block = yaml.slice(yaml.indexOf('example_areas:'))
  return [...block.matchAll(/^\s*-\s*name:\s*"([^"]+)"/gm)].map((m) => m[1]!)
}

describe('front-end source has no example area names', () => {
  const names = configuredNames()

  it('finds the configured names to look for', () => {
    expect(names.length).toBeGreaterThanOrEqual(3)
  })

  it('contains none of them in a non-test source file', () => {
    const files = sourceFiles(fileURLToPath(SRC))
    expect(files.length).toBeGreaterThan(10)
    const hits = files.flatMap((file) => {
      const text = readFileSync(file, 'utf8').toLowerCase()
      return names.filter((name) => text.includes(name.toLowerCase())).map((n) => `${file}: ${n}`)
    })
    expect(hits).toEqual([])
  })
})

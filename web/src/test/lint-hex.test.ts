// @vitest-environment node
import { ESLint } from 'eslint'

// Tests the ESLint rule that forbids raw hex colours outside src/styles/palettes.ts
// (tokens.css is CSS and is not linted). Requirements 26.2, 31.6.
// The '#' is kept in a variable so this file does not trip the rule it tests.
const H = '#'
// The first type-aware ESLint run takes about 4 s alone and more when other test files run
// in parallel, which exceeded the default 5 s limit.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })
const eslint = new ESLint({ cwd: process.cwd() })
// Warm-up: the first type-aware lint pays the parser start-up cost, so do it once here.
beforeAll(async () => {
  await eslint.lintText('export const warm = 1\n', { filePath: 'src/lib/utils.ts' })
})

async function hexMessages(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath })
  return (result?.messages ?? [])
    .filter((m) => m.ruleId === 'no-restricted-syntax')
    .map((m) => m.message)
}

describe('raw hex colour lint rule', () => {
  it.each([
    [`export const c = '${H}fff'\n`, 'short'],
    [`export const c = '${H}FFAA00'\n`, 'long'],
    [`export const c = '${H}ffaa0080'\n`, 'with alpha'],
    [`export const c = \`border: 1px solid ${H}123abc\`\n`, 'in a template literal'],
  ])('rejects %s (%s)', async (code) => {
    expect((await hexMessages(code, 'src/lib/utils.ts')).length).toBeGreaterThan(0)
  })

  it('allows hex colours in src/styles/palettes.ts', async () => {
    const code = `export const c = '${H}ffaa00'\n`
    expect(await hexMessages(code, 'src/styles/palettes.ts')).toEqual([])
  })

  it('does not flag strings that only look like hex, such as element ids', async () => {
    const code = `export const c = '${H}main-content'\n`
    expect(await hexMessages(code, 'src/lib/utils.ts')).toEqual([])
  })
})

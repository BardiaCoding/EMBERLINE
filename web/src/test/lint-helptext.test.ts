// @vitest-environment node
import { ESLint } from 'eslint'
import { HELP_KEYS, helpText } from '@/lib/helpText'

// Tests the ESLint rule that keeps the help sentences inside src/lib/helpText.json.
// Requirement 15.20 (design.md section 11.4).

// The first type-aware ESLint run is slow, see lint-hex.test.ts.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

const eslint = new ESLint({ cwd: process.cwd() })
// Warm-up: the first type-aware lint pays the parser start-up cost, so do it once here.
beforeAll(async () => {
  await eslint.lintText('export const warm = 1\n', { filePath: 'src/lib/utils.ts' })
})

async function helpMessages(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath })
  return (result?.messages ?? [])
    .filter((m) => m.ruleId === 'no-restricted-syntax' && m.message.includes('helpText.json'))
    .map((m) => m.message)
}

describe('help sentence lint rule', () => {
  it.each(HELP_KEYS)('rejects the %s sentence as a string literal', async (key) => {
    const code = `export const t = ${JSON.stringify(helpText(key))}\n`
    expect((await helpMessages(code, 'src/lib/utils.ts')).length).toBeGreaterThan(0)
  })

  it('rejects the start of a sentence inside a template literal', async () => {
    const start = helpText('anomaly').split(' ').slice(0, 8).join(' ')
    const code = `export const t = \`\${1} ${start}\`\n`
    expect((await helpMessages(code, 'src/lib/utils.ts')).length).toBeGreaterThan(0)
  })

  it('allows reading a sentence through the accessor', async () => {
    const code = `import { helpText } from '@/lib/helpText'\nexport const t = helpText('anomaly')\n`
    expect(await helpMessages(code, 'src/lib/utils.ts')).toEqual([])
  })

  it('allows unrelated text', async () => {
    const code = `export const t = 'Select the cell for term help'\n`
    expect(await helpMessages(code, 'src/lib/utils.ts')).toEqual([])
  })
})

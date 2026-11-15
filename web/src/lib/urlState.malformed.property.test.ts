// Feature: harmonized-fire-calendar, Property 43: URL decoding tolerates malformed parameters
// Validates: Requirements 19.8
import fc from 'fast-check'
import { MANAGED_PARAMS, URL_VIEWS, decodeState, type DecodeOptions } from './urlState'

const OPTIONS: DecodeOptions = {
  fallback: { start: '2020-01-01', end: '2020-12-31' },
  tabs: ['calendar', 'trends'],
}

// Each choice is a query value that is either valid (kept) or malformed (rejected, default used).
type Choice = { valid: boolean; values: Record<string, string> }

const validDate: fc.Arbitrary<string> = fc
  .date({
    min: new Date('2001-01-01T00:00:00Z'),
    max: new Date('2030-12-31T00:00:00Z'),
    noInvalidDate: true,
  })
  .map((d) => d.toISOString().slice(0, 10))

const badDate = fc.constantFrom('2020-02-30', '2021-13-01', 'yesterday', '', '2020-1-1', '20200101')

const datePair: fc.Arbitrary<Choice> = fc.oneof(
  fc.tuple(validDate, validDate).map(([a, b]): Choice => {
    const [f, t] = a <= b ? [a, b] : [b, a]
    return { valid: true, values: { from: f, to: t } }
  }),
  fc
    .tuple(badDate, validDate)
    .map(([f, t]): Choice => ({ valid: false, values: { from: f, to: t } })),
  fc
    .tuple(validDate, badDate)
    .map(([f, t]): Choice => ({ valid: false, values: { from: f, to: t } })),
  // Start after end.
  fc
    .tuple(validDate, validDate)
    .filter(([a, b]) => a !== b)
    .map(([a, b]): Choice => {
      const [f, t] = a < b ? [b, a] : [a, b]
      return { valid: false, values: { from: f, to: t } }
    }),
)

const single = (
  name: string,
  good: fc.Arbitrary<string>,
  bad: fc.Arbitrary<string>,
): fc.Arbitrary<Choice> =>
  fc.oneof(
    good.map((v): Choice => ({ valid: true, values: { [name]: v } })),
    bad.map((v): Choice => ({ valid: false, values: { [name]: v } })),
  )

const choices: Record<string, fc.Arbitrary<Choice>> = {
  dates: datePair,
  v: single(
    'v',
    fc.constantFrom(...URL_VIEWS),
    fc.string().filter((s) => !(URL_VIEWS as readonly string[]).includes(s)),
  ),
  y: single(
    'y',
    fc.integer({ min: 1900, max: 2200 }).map(String),
    fc.constantFrom('abc', '1800', '2300', '', '20.5', '-3', '99999', ' 2020'),
  ),
  ss: single(
    'ss',
    fc.integer({ min: 1, max: 12 }).map(String),
    fc.constantFrom('0', '13', 'x', '', '1.5', '-1', '100'),
  ),
  bl: single(
    'bl',
    fc
      .tuple(fc.integer({ min: 1900, max: 2200 }), fc.integer({ min: 1900, max: 2200 }))
      .map(([a, b]) => `${Math.min(a, b)}-${Math.max(a, b)}`),
    fc.constantFrom('2020-2010', 'abc', '2000', '2000-', '1800-1900', '2000-2300', ''),
  ),
  tab: single(
    'tab',
    fc.constantFrom('calendar', 'trends'),
    fc.constantFrom('nope', 'Calendar', '', '9x', '<script>'),
  ),
  cell: single(
    'cell',
    fc.constantFrom('2002-07', '2026-11', '2000-1'),
    fc.constantFrom('', 'a b', 'x/y', '<>', '2002-13', '2002-00', '37.5000_-120.5000'),
  ),
  s: single(
    's',
    fc.constantFrom('abc123', 'A_b-9'),
    fc.constantFrom('', 'has space', 'a'.repeat(17), 'x/y', '%%'),
  ),
  a: fc
    .constantFrom('!!!', '', 'A', 'AAAA', '____', 'zzzzzzzz', 'a'.repeat(20_001), 'AAAAAAAA==')
    .map((v): Choice => ({ valid: false, values: { a: v } })),
  cmp: fc.constantFrom('weird', 'AREA', 'period', 'area').map((v): Choice => ({
    valid: false,
    values: v === 'area' ? { cmp: 'area', a2: '***' } : { cmp: v },
  })),
}

const unknownParam = fc
  .tuple(
    fc
      .string({ minLength: 1, maxLength: 8 })
      .filter((n) => !(MANAGED_PARAMS as readonly string[]).includes(n)),
    fc.string({ maxLength: 12 }),
  )
  .map(([k, v]) => [k, v] as const)

describe('Property 43: URL decoding tolerates malformed parameters', () => {
  it('keeps valid parameters, defaults and lists each rejected one, ignores unknown ones', () => {
    const names = Object.keys(choices)
    const picks = fc.record(
      Object.fromEntries(
        names.map((n) => [n, fc.option(choices[n] as fc.Arbitrary<Choice>, { nil: undefined })]),
      ),
    )
    fc.assert(
      fc.property(picks, fc.array(unknownParam, { maxLength: 4 }), (chosen, unknowns) => {
        const params = new URLSearchParams()
        const present = names.flatMap((n) => {
          const c = (chosen as Record<string, Choice | undefined>)[n]
          return c === undefined ? [] : [[n, c] as const]
        })
        for (const [, c] of present) for (const [k, v] of Object.entries(c.values)) params.set(k, v)
        for (const [k, v] of unknowns) if (!params.has(k)) params.set(k, v)

        const { state, rejected } = decodeState(`?${params.toString()}`, OPTIONS)
        const rejectedNames = rejected.map((r) => r.param)
        for (const r of rejected) {
          expect(r.reason.length).toBeGreaterThan(0)
          expect((MANAGED_PARAMS as readonly string[]).includes(r.param)).toBe(true)
        }
        // Unknown parameters are never rejected.
        for (const [k] of unknowns)
          if (!(MANAGED_PARAMS as readonly string[]).includes(k))
            expect(rejectedNames).not.toContain(k)

        const get = (n: string): Choice | undefined =>
          (chosen as Record<string, Choice | undefined>)[n]
        const checkSimple = (n: string, kept: boolean, defaulted: boolean): void => {
          const c = get(n)
          if (c === undefined) return
          if (c.valid) {
            expect(rejectedNames).not.toContain(n)
            expect(kept).toBe(true)
          } else {
            expect(rejectedNames).toContain(n)
            expect(defaulted).toBe(true)
          }
        }

        const dates = get('dates')
        if (dates !== undefined) {
          if (dates.valid) {
            expect(state.start).toBe(dates.values['from'])
            expect(state.end).toBe(dates.values['to'])
            expect(rejectedNames).not.toContain('from')
            expect(rejectedNames).not.toContain('to')
          } else {
            expect(state.start).toBe(OPTIONS.fallback.start)
            expect(state.end).toBe(OPTIONS.fallback.end)
            expect(rejectedNames).toContain('from')
            expect(rejectedNames).toContain('to')
          }
        } else {
          expect([state.start, state.end]).toEqual([OPTIONS.fallback.start, OPTIONS.fallback.end])
        }

        const v = get('v')
        checkSimple('v', state.view === v?.values['v'], state.view === 'counts')
        const y = get('y')
        checkSimple('y', state.year === Number(y?.values['y']), state.year === undefined)
        const ss = get('ss')
        checkSimple(
          'ss',
          state.seasonStart === Number(ss?.values['ss']),
          state.seasonStart === undefined,
        )
        const bl = get('bl')
        checkSimple(
          'bl',
          state.baseline !== undefined &&
            `${state.baseline[0]}-${state.baseline[1]}` === bl?.values['bl'],
          state.baseline === undefined,
        )
        const tab = get('tab')
        checkSimple('tab', state.tab === tab?.values['tab'], state.tab === undefined)
        const cell = get('cell')
        checkSimple('cell', state.cell === cell?.values['cell'], state.cell === undefined)

        // Area: `a` wins over `s`; a malformed `a` falls back to the full region.
        const a = get('a')
        const s = get('s')
        if (a !== undefined) {
          expect(rejectedNames).toContain('a')
          expect(state.area).toEqual({ kind: 'region' })
        } else if (s !== undefined) {
          checkSimple(
            's',
            state.area.kind === 'share' && state.area.id === s.values['s'],
            state.area.kind === 'region',
          )
        } else {
          expect(state.area).toEqual({ kind: 'region' })
        }

        // A malformed comparison gives no comparison, or a comparison with the valid defaults.
        const cmp = get('cmp')
        if (cmp !== undefined && cmp.values['cmp'] === 'weird') {
          expect(state.compare).toEqual({ mode: 'none' })
          expect(rejectedNames).toContain('cmp')
        }
        if (cmp !== undefined && cmp.values['cmp'] === 'area') {
          expect(state.compare).toEqual({ mode: 'none' })
          expect(rejectedNames).toContain('a2')
        }
        if (cmp !== undefined && cmp.values['cmp'] === 'period') {
          expect(state.compare).toEqual({ mode: 'none' })
          expect(rejectedNames).toContain('cmp')
        }
      }),
    )
  })

  it('never throws on arbitrary query strings and lists only managed parameters with a reason', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (search) => {
        const { state, rejected } = decodeState(search, OPTIONS)
        expect(state.start <= state.end).toBe(true)
        for (const r of rejected) {
          expect((MANAGED_PARAMS as readonly string[]).includes(r.param)).toBe(true)
          expect(r.reason.length).toBeGreaterThan(0)
        }
      }),
    )
  })

  it('never throws when managed parameter names get arbitrary values', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.constantFrom(...MANAGED_PARAMS), fc.string({ maxLength: 60 })), {
          maxLength: 15,
        }),
        (pairs) => {
          const params = new URLSearchParams()
          for (const [k, v] of pairs) params.append(k, v)
          const out = decodeState(params.toString(), OPTIONS)
          expect(Array.isArray(out.rejected)).toBe(true)
        },
      ),
    )
  })
})

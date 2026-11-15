import fc from 'fast-check'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { textToneFor } from '@/lib/binning'
import {
  BLUE_ORANGE_DIVERGING,
  CHART_COLOURS_DARK,
  CHART_COLOURS_LIGHT,
  CIVIDIS_STOPS,
  SELECTION_COLOUR,
  cividisClasses,
  type ChartColours,
} from '@/styles/palettes'
import {
  CVD_KINDS,
  contrastRatio,
  cvdDeltaE,
  deltaE2000,
  hexToRgb,
  oklchToRgb,
  rgbToLab,
} from './colour'

const tokensCss = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8')

// Requirements 27.1 (contrast), 27.3 and 27.4 (colour-vision safe data colours).

type Tokens = Record<string, string>

/** Declarations of the first rule whose selector line starts with `selector`. */
function parseBlock(css: string, selector: string, indent = ''): Tokens {
  const start = css.indexOf(`${indent}${selector} {`)
  if (start < 0) throw new Error(`No ${selector} block in tokens.css`)
  const end = css.indexOf(`\n${indent}}`, start)
  const out: Tokens = {}
  for (const m of css.slice(start, end).matchAll(/--([\w-]+):\s*(oklch\([^)]*\))\s*;/g)) {
    out[m[1]!] = m[2]!
  }
  return out
}

const light = parseBlock(tokensCss, ':root')
const dark = { ...light, ...parseBlock(tokensCss, ':root.dark') }
const darkMedia = { ...light, ...parseBlock(tokensCss, ':root:not(.light):not(.dark)', '  ') }
const themes = { light, dark } as const

const TEXT_PAIRS: [string, string][] = [
  ['foreground', 'background'],
  ['card-foreground', 'card'],
  ['popover-foreground', 'popover'],
  ['primary-foreground', 'primary'],
  ['secondary-foreground', 'secondary'],
  ['accent-foreground', 'accent'],
  ['muted-foreground', 'background'],
  ['muted-foreground', 'card'],
  ['muted-foreground', 'muted'],
  ['destructive', 'background'],
  ['destructive', 'card'],
  // Dimmed text while results update (Req 28.7), on every surface it can sit on.
  ['foreground-dim', 'background'],
  ['foreground-dim', 'card'],
  ['foreground-dim', 'muted'],
  ['muted-foreground-dim', 'background'],
  ['muted-foreground-dim', 'card'],
  ['muted-foreground-dim', 'muted'],
]
const NON_TEXT_PAIRS: [string, string][] = [
  // Control boundaries and the focus ring (27.1, 27.2).
  ['input', 'background'],
  ['input', 'card'],
  ['ring', 'background'],
  ['ring', 'card'],
]

describe('colour helpers', () => {
  it('matches the CIEDE2000 reference pair of Sharma et al. and WCAG black on white', () => {
    expect(deltaE2000([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 3)
    expect(contrastRatio('oklch(0 0 0)', 'oklch(1 0 0)')).toBeCloseTo(21, 0)
    expect(rgbToLab(hexToRgb(CIVIDIS_STOPS[0]!))[0]).toBeLessThan(
      rgbToLab(hexToRgb(CIVIDIS_STOPS[9]!))[0],
    )
    const [r, g, b] = oklchToRgb('oklch(1 0 0)')
    expect([r, g, b].every((v) => Math.abs(v - 1) < 1e-3)).toBe(true)
  })
})

describe('design token contrast (WCAG 2.2 AA)', () => {
  it('dark tokens in the OS-preference media block equal the .dark class tokens', () => {
    expect(darkMedia).toEqual(dark)
  })
  for (const [name, tokens] of Object.entries(themes)) {
    it.each(TEXT_PAIRS)(`${name}: %s on %s is at least 4.5:1`, (fg, bg) => {
      expect(contrastRatio(tokens[fg]!, tokens[bg]!)).toBeGreaterThanOrEqual(4.5)
    })
    it.each(NON_TEXT_PAIRS)(`${name}: %s against %s is at least 3:1`, (fg, bg) => {
      expect(contrastRatio(tokens[fg]!, tokens[bg]!)).toBeGreaterThanOrEqual(3)
    })
  }
})

describe('palette swatch contrast', () => {
  it('every blue-orange class and every cividis class has a text tone with at least 4.5:1', () => {
    const swatches = [
      ...BLUE_ORANGE_DIVERGING,
      ...CIVIDIS_STOPS,
      ...[2, 3, 4, 5, 6, 7, 8, 9, 10].flatMap((n) => cividisClasses(n)),
    ]
    for (const colour of swatches) {
      const tone = textToneFor(colour)
      const ratio = contrastRatio(colour, tone === 'light' ? 'oklch(1 0 0)' : 'oklch(0 0 0)')
      expect(ratio, colour).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('the Selection_Area outline has at least 3:1 against the light map base colour', () => {
    // OpenStreetMap standard land colour, the lightest base the outline is drawn on.
    expect(contrastRatio(SELECTION_COLOUR, hexLiteral('f2efe9'))).toBeGreaterThanOrEqual(3)
  })
})

function hexLiteral(rrggbb: string): string {
  return `${String.fromCharCode(35)}${rrggbb}`
}

describe('chart colours', () => {
  const sets: [string, ChartColours, Tokens][] = [
    ['light', CHART_COLOURS_LIGHT, light],
    ['dark', CHART_COLOURS_DARK, dark],
  ]
  it.each(sets)('%s: text 4.5:1, data marks and axes 3:1 against the card', (_n, c, t) => {
    const card = t['card']!
    for (const key of ['text', 'mutedText'] as const) {
      expect(contrastRatio(c[key], card), key).toBeGreaterThanOrEqual(4.5)
    }
    // `band` is a 30 % opacity fill that only shades the 10th to 90th range; the median line
    // and the legend carry the reading, so the fill is not held to 3:1.
    for (const key of ['primary', 'secondary', 'axis'] as const) {
      expect(contrastRatio(c[key], card), key).toBeGreaterThanOrEqual(3)
    }
    for (const key of ['text', 'mutedText'] as const) {
      expect(contrastRatio(c[key], c.tooltipBackground), `tooltip ${key}`).toBeGreaterThanOrEqual(
        4.5,
      )
    }
    // Dashed border of a provisional bar (primary) against its fill.
    expect(contrastRatio(c.primary, c.provisionalFill), 'provisional').toBeGreaterThanOrEqual(3)
  })
  it.each(sets)('%s: primary and secondary stay apart under colour-vision deficiency', (_n, c) => {
    for (const kind of [undefined, ...CVD_KINDS]) {
      expect(cvdDeltaE(c.primary, c.secondary, kind), String(kind)).toBeGreaterThanOrEqual(5)
    }
  })
})

describe('colour-vision deficiency (Machado, CIEDE2000 at least 5 between adjacent classes)', () => {
  const MIN = 5
  for (const kind of [undefined, ...CVD_KINDS]) {
    it(`blue-orange diverging classes stay distinguishable (${kind ?? 'normal vision'})`, () => {
      for (let i = 1; i < BLUE_ORANGE_DIVERGING.length; i++) {
        const d = cvdDeltaE(BLUE_ORANGE_DIVERGING[i - 1]!, BLUE_ORANGE_DIVERGING[i]!, kind)
        expect(d, `classes ${i - 1} and ${i}`).toBeGreaterThanOrEqual(MIN)
      }
    })
  }
  it('blue-orange: the below and above sides never collapse (most extreme classes, all CVD)', () => {
    for (const kind of CVD_KINDS) {
      expect(
        cvdDeltaE(BLUE_ORANGE_DIVERGING[0]!, BLUE_ORANGE_DIVERGING[8]!, kind),
      ).toBeGreaterThanOrEqual(MIN)
    }
  })
  it('cividis classes stay distinguishable for every class count of the counts view', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 10 }),
        fc.constantFrom(undefined, ...CVD_KINDS),
        (n, kind) => {
          const classes = cividisClasses(n)
          for (let i = 1; i < classes.length; i++) {
            expect(cvdDeltaE(classes[i - 1]!, classes[i]!, kind)).toBeGreaterThanOrEqual(MIN)
          }
        },
      ),
    )
  })
})

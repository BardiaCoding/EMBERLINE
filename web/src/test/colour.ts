// Colour maths for the accessibility tests (task 19.8): WCAG contrast, OKLCH parsing,
// Machado colour-vision simulation and CIEDE2000. Test helper only.

export type Rgb = readonly [number, number, number]

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
function linearToSrgb(c: number): number {
  const v = clamp01(c)
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055
}

/** `#rrggbb` to sRGB components in 0..1. */
export function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/** `oklch(L C H)` (L 0..1, hue in degrees) to gamut-clamped sRGB in 0..1. */
export function oklchToRgb(value: string): Rgb {
  const m = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value.trim())
  if (!m) throw new Error(`Not an oklch() colour: ${value}`)
  const L = Number(m[1])
  const C = Number(m[2])
  const h = (Number(m[3]) * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    linearToSrgb(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s),
  ]
}

export function toRgb(colour: string): Rgb {
  return colour.startsWith('oklch(') ? oklchToRgb(colour) : hexToRgb(colour)
}

export function relativeLuminance([r, g, b]: Rgb): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
}

/** WCAG 2.x contrast ratio of two colours (hex or oklch strings). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(toRgb(a))
  const lb = relativeLuminance(toRgb(b))
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Machado, Oliveira and Fernandes (2009) matrices, severity 1.0, applied in linear RGB. */
export const MACHADO = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
} as const satisfies Record<string, readonly (readonly number[])[]>

export type CvdKind = keyof typeof MACHADO
export const CVD_KINDS = Object.keys(MACHADO) as CvdKind[]

export function simulate(rgb: Rgb, kind: CvdKind): Rgb {
  const lin = rgb.map(srgbToLinear)
  const m = MACHADO[kind]
  const out = m.map((row) => row[0] * lin[0]! + row[1] * lin[1]! + row[2] * lin[2]!)
  return [linearToSrgb(out[0]!), linearToSrgb(out[1]!), linearToSrgb(out[2]!)]
}

type Lab = readonly [number, number, number]

export function rgbToLab(rgb: Rgb): Lab {
  const [r, g, b] = rgb.map(srgbToLinear) as [number, number, number]
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116)
  const fx = f(x)
  const fy = f(y)
  const fz = f(z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

/** CIEDE2000 colour difference (kL = kC = kH = 1). */
export function deltaE2000(lab1: Lab, lab2: Lab): number {
  const rad = Math.PI / 180
  const [L1, a1, b1] = lab1
  const [L2, a2, b2] = lab2
  const C1 = Math.hypot(a1, b1)
  const C2 = Math.hypot(a2, b2)
  const Cbar = (C1 + C2) / 2
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)))
  const a1p = (1 + G) * a1
  const a2p = (1 + G) * a2
  const C1p = Math.hypot(a1p, b1)
  const C2p = Math.hypot(a2p, b2)
  const hue = (b: number, a: number): number => {
    if (b === 0 && a === 0) return 0
    const h = Math.atan2(b, a) / rad
    return h < 0 ? h + 360 : h
  }
  const h1p = hue(b1, a1p)
  const h2p = hue(b2, a2p)
  const dLp = L2 - L1
  const dCp = C2p - C1p
  let dhp = 0
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p
    if (dhp > 180) dhp -= 360
    else if (dhp < -180) dhp += 360
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * rad) / 2)
  const Lbp = (L1 + L2) / 2
  const Cbp = (C1p + C2p) / 2
  let hbp = h1p + h2p
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hbp /= 2
    else hbp = (hbp + (h1p + h2p < 360 ? 360 : -360)) / 2
  }
  const T =
    1 -
    0.17 * Math.cos((hbp - 30) * rad) +
    0.24 * Math.cos(2 * hbp * rad) +
    0.32 * Math.cos((3 * hbp + 6) * rad) -
    0.2 * Math.cos((4 * hbp - 63) * rad)
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2))
  const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7))
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2)
  const Sc = 1 + 0.045 * Cbp
  const Sh = 1 + 0.015 * Cbp * T
  const Rt = -Math.sin(2 * dTheta * rad) * Rc
  return Math.sqrt(
    (dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh),
  )
}

/** CIEDE2000 between two colours as seen with the given colour-vision deficiency (or none). */
export function cvdDeltaE(a: string, b: string, kind?: CvdKind): number {
  const ra = toRgb(a)
  const rb = toRgb(b)
  return deltaE2000(
    rgbToLab(kind ? simulate(ra, kind) : ra),
    rgbToLab(kind ? simulate(rb, kind) : rb),
  )
}

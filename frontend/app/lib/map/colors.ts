import type { Verdict, PlanningStatus, TransportMode } from '~/types/api'

// MapLibre paint properties need concrete colours, and the design tokens may be
// oklch(), which MapLibre cannot parse. Resolve each token once through a canvas,
// which normalises any CSS colour to rgb.

const cache = new Map<string, string>()
let ctx: CanvasRenderingContext2D | null = null

function toRgb(css: string): string | null {
  ctx ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillStyle = '#000'
  ctx.fillStyle = css
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
  return a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${(a! / 255).toFixed(3)})`
}

/** Concrete colour for a CSS custom property, e.g. token('--brand'). */
export function token(name: string, fallback = '#64748b'): string {
  const hit = cache.get(name)
  if (hit) return hit
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  // shadcn-style tokens are sometimes bare HSL triples ("221 83% 53%").
  const css = !raw ? '' : /^[\d.]+\s+[\d.]+%\s+[\d.]+%/.test(raw) ? `hsl(${raw})` : raw
  const value = (css && toRgb(css)) || fallback
  if (css) cache.set(name, value)
  return value
}

/** Call if the theme changes (tokens re-resolved on next read). */
export function clearTokenCache() {
  cache.clear()
}

export const verdictVar: Record<Verdict, string> = {
  below_market: '--verdict-below',
  in_line: '--verdict-inline',
  above_market: '--verdict-above',
}

export const planningVar: Record<PlanningStatus, string> = {
  granted: '--planning-granted',
  pending: '--planning-pending',
  refused: '--planning-refused',
  appealed: '--planning-appealed',
}

export const transportVar: Record<TransportMode, string> = {
  luas: '--transport-luas',
  dart: '--transport-dart',
  rail: '--transport-rail',
  bus: '--transport-bus',
}

/** Verdict of a comparable relative to the asking rent (±5% is in line). */
export function verdictVsAsking(rent: number, asking: number): Verdict {
  const diff = (rent - asking) / asking
  if (diff < -0.05) return 'below_market'
  if (diff > 0.05) return 'above_market'
  return 'in_line'
}

import type { Feature, FeatureCollection, Polygon } from 'geojson'
import type { ListingSummary } from '~/types/api'

// Hexagon binning for the rent heatmap: each cell is coloured by the average
// "% vs local median" of the listings inside it (not by how many there are).

export interface HexProps { mean: number; count: number; band: 1 | 2 | 3 | 4 | 5 }

/** Rent bands on A's --band-1..5 scale (well below → well above the median). */
export function bandFor(diffPct: number): HexProps['band'] {
  if (diffPct < -10) return 1
  if (diffPct < -3) return 2
  if (diffPct <= 3) return 3
  if (diffPct <= 10) return 4
  return 5
}

/** Hex radius that reads well at a zoom: ~150 m at street level, ~10 km at county level. */
export function hexRadiusForZoom(zoom: number): number {
  return Math.min(12000, Math.max(120, 150 * 2 ** (15 - Math.round(zoom))))
}

/** Pointy-top hex bins in a local metric projection around the listings' latitude. */
export function hexbin(items: ListingSummary[], radiusM: number): FeatureCollection<Polygon, HexProps> {
  if (!items.length) return { type: 'FeatureCollection', features: [] }
  const lat0 = items.reduce((a, l) => a + l.location.lat, 0) / items.length
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180)
  const ky = 110540
  const w = Math.sqrt(3) * radiusM

  const cells = new Map<string, { q: number; r: number; sum: number; count: number }>()
  for (const l of items) {
    const x = l.location.lng * kx
    const y = l.location.lat * ky
    // pixel → axial (fractional), then cube-round
    const qf = ((Math.sqrt(3) / 3) * x - y / 3) / radiusM
    const rf = ((2 / 3) * y) / radiusM
    let q = Math.round(qf), r = Math.round(rf)
    const s = Math.round(-qf - rf)
    const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s + qf + rf)
    if (dq > dr && dq > ds) q = -r - s
    else if (dr > ds) r = -q - s
    const key = `${q},${r}`
    const c = cells.get(key) ?? { q, r, sum: 0, count: 0 }
    c.sum += l.diff_pct
    c.count++
    cells.set(key, c)
  }

  const features: Feature<Polygon, HexProps>[] = []
  for (const c of cells.values()) {
    const cx = w * (c.q + c.r / 2)
    const cy = 1.5 * radiusM * c.r
    const ring: [number, number][] = []
    for (let i = 0; i <= 6; i++) {
      const a = ((60 * (i % 6) - 30) * Math.PI) / 180
      // 0.94: a hairline gap between cells reads better than a solid sheet.
      ring.push([(cx + radiusM * 0.94 * Math.cos(a)) / kx, (cy + radiusM * 0.94 * Math.sin(a)) / ky])
    }
    const mean = c.sum / c.count
    features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: { mean: Math.round(mean * 10) / 10, count: c.count, band: bandFor(mean) } })
  }
  return { type: 'FeatureCollection', features }
}

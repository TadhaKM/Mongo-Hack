import type { Map as MlMap, GeoJSONSource, GeoJSONFeature } from 'maplibre-gl'
import type { Feature, MultiPolygon, Polygon, Position } from 'geojson'
import type { LngLat } from '~/types/api'
import { BUILDING_LAYER } from './config'
import { EMPTY, featureCollection } from './geo'
import { ensureLayer, ensureSource, removeLayersAndSource } from './core'
import { token } from './colors'

const SOURCE = 'selected-building'
const LAYER = 'selected-building-3d'
/** Geocodes often land on the pavement: accept the nearest footprint within this distance. */
const NEAREST_MAX_M = 25

function ensureHighlightLayer(map: MlMap) {
  ensureSource(map, SOURCE, { type: 'geojson', data: EMPTY })
  ensureLayer(map, {
    id: LAYER,
    type: 'fill-extrusion',
    source: SOURCE,
    paint: {
      'fill-extrusion-color': token('--brand', '#2563eb'),
      // +0.3 m so the highlight wins the depth test against the original building.
      'fill-extrusion-height': ['+', ['coalesce', ['get', 'render_height'], 10], 0.3],
      'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
      'fill-extrusion-opacity': 0.95,
    },
  })
}

/**
 * Highlight the 3D building at `location`. Works in geographic space (not screen
 * space), so tall buildings in front of the pin at high pitch cannot steal the hit.
 * Returns true if a building was found (needs building tiles loaded, zoom >= 13).
 */
export function highlightBuildingAt(map: MlMap, location: LngLat): boolean {
  const layer = map.getLayer(BUILDING_LAYER)
  if (!layer) return false
  ensureHighlightLayer(map)
  const features = map.querySourceFeatures(layer.source, { sourceLayer: layer.sourceLayer })
  const footprint = findFootprint(features, location)
  const src = map.getSource(SOURCE) as GeoJSONSource | undefined
  src?.setData(footprint ? featureCollection([footprint]) : EMPTY)
  return !!footprint
}

/** Highlight now, and retry once the map is idle if tiles were still loading. */
export function highlightBuildingWhenSettled(map: MlMap, location: LngLat): Promise<boolean> {
  if (highlightBuildingAt(map, location)) return Promise.resolve(true)
  return new Promise(resolve => map.once('idle', () => resolve(highlightBuildingAt(map, location))))
}

export function clearBuildingHighlight(map: MlMap | null) {
  const src = map?.getSource(SOURCE) as GeoJSONSource | undefined
  src?.setData(EMPTY)
}

export function removeBuildingHighlight(map: MlMap | null) {
  removeLayersAndSource(map, [LAYER], SOURCE)
}

// --- geometry ---------------------------------------------------------------

function polygonsOf(f: GeoJSONFeature): Position[][][] {
  const g = f.geometry
  if (g.type === 'Polygon') return [g.coordinates]
  if (g.type === 'MultiPolygon') return g.coordinates
  return []
}

function inRing(x: number, y: number, ring: Position[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as [number, number]
    const [xj, yj] = ring[j] as [number, number]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function inPolygon(x: number, y: number, poly: Position[][]): boolean {
  return !!poly[0] && inRing(x, y, poly[0]) && !poly.slice(1).some(h => inRing(x, y, h))
}

/** Approximate metres from a point to the nearest edge of a polygon (fine at city scale). */
function metresToPolygon(p: LngLat, poly: Position[][]): number {
  const kx = 111320 * Math.cos((p.lat * Math.PI) / 180)
  const ky = 110540
  let best = Infinity
  for (const ring of poly) {
    for (let i = 1; i < ring.length; i++) {
      const ax = (ring[i - 1]![0]! - p.lng) * kx, ay = (ring[i - 1]![1]! - p.lat) * ky
      const bx = (ring[i]![0]! - p.lng) * kx, by = (ring[i]![1]! - p.lat) * ky
      const dx = bx - ax, dy = by - ay
      const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)))
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy))
    }
  }
  return best
}

/** True if any vertex of `b` lies within ~0.5 m of an edge of `a` (pieces split at a tile edge). */
function touches(a: Position[][], b: Position[][]): boolean {
  return (b[0] ?? []).some(v => metresToPolygon({ lng: v[0]!, lat: v[1]! }, a) < 0.5)
}

/** Copy of `ring` with every vertex moved `m` metres away from its centroid. */
function inflateRing(ring: Position[], m: number): Position[] {
  const n = ring.length - 1 || 1
  let cx = 0, cy = 0
  for (let i = 0; i < n; i++) { cx += ring[i]![0]!; cy += ring[i]![1]! }
  cx /= n; cy /= n
  const kx = 111320 * Math.cos((cy * Math.PI) / 180)
  const ky = 110540
  return ring.map(([x, y]) => {
    const dx = (x! - cx) * kx, dy = (y! - cy) * ky
    const d = Math.hypot(dx, dy) || 1
    return [cx + (dx * (1 + m / d)) / kx, cy + (dy * (1 + m / d)) / ky]
  })
}

function findFootprint(features: GeoJSONFeature[], p: LngLat): Feature<Polygon | MultiPolygon> | null {
  let hit: GeoJSONFeature | undefined
  let nearest: GeoJSONFeature | undefined
  let nearestM = NEAREST_MAX_M
  for (const f of features) {
    for (const poly of polygonsOf(f)) {
      if (inPolygon(p.lng, p.lat, poly)) { hit = f; break }
      const d = metresToPolygon(p, poly)
      if (d < nearestM) { nearestM = d; nearest = f }
    }
    if (hit) break
  }
  const chosen = hit ?? nearest
  if (!chosen) return null
  // A building crossing a tile edge comes back as clipped pieces that share an edge: merge
  // same-id pieces that touch what we have. Ids are shared by whole estates (OSM relations),
  // so pieces that merely have the same id are not enough.
  const start = polygonsOf(chosen).filter(poly => (hit ? inPolygon(p.lng, p.lat, poly) : metresToPolygon(p, poly) <= nearestM + 0.01))
  const coordinates = [...start]
  const pool = chosen.id == null ? [] : features.filter(f => f.id === chosen.id).flatMap(polygonsOf).filter(poly => !start.includes(poly))
  for (let grew = true; grew;) {
    grew = false
    for (let i = pool.length - 1; i >= 0; i--) {
      const poly = pool[i]!
      if (coordinates.some(c => touches(c, poly))) {
        coordinates.push(poly)
        pool.splice(i, 1)
        grew = true
      }
    }
  }
  // Push walls ~0.4 m outward so they sit in front of the original building's walls (no z-fighting).
  const inflated = coordinates.map(poly => poly.map(ring => inflateRing(ring, 0.4)))
  return {
    type: 'Feature',
    geometry: inflated.length === 1 ? { type: 'Polygon', coordinates: inflated[0]! } : { type: 'MultiPolygon', coordinates: inflated },
    properties: { render_height: chosen.properties.render_height, render_min_height: chosen.properties.render_min_height },
  }
}

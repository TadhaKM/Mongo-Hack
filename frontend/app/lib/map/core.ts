import { Map as MlMap, type ErrorEvent as MlErrorEvent, type MapOptions, type LayerSpecification, type SourceSpecification } from 'maplibre-gl'
import type { InjectionKey, ShallowRef } from 'vue'
import {
  BUILDING_LAYER, BUILDING_SOFT_COLOR, BUILDING_SOFT_OPACITY, MAP_STYLE, MAP_STYLE_FALLBACK, STYLE_LOAD_TIMEOUT_MS,
} from './config'
import { ensureMapWorker } from './worker'

/** Provided by AnalysisMap; null until the style has loaded. Layer components inject this. */
export const MAP_KEY: InjectionKey<ShallowRef<MlMap | null>> = Symbol('rentcheck-map')

export interface CreateMapResult {
  map: MlMap
  /** Resolves once a style (primary or fallback) has loaded. `fallback` is true if Positron was used. */
  ready: Promise<{ fallback: boolean }>
}

/**
 * Create a MapLibre map on Liberty. If the style has not loaded within 8 s
 * (or errors before loading), switch to the Positron fallback.
 */
export function createMap(options: Omit<MapOptions, 'style'> & { style?: string }): CreateMapResult {
  ensureMapWorker()
  const map = new MlMap({ style: options.style ?? MAP_STYLE, attributionControl: { compact: true }, ...options })
  // Liberty references a few POI icons its sprite lacks; stand in a blank image instead of warning.
  map.setMissingStyleImageResolver((id) => {
    if (!map.hasImage(id)) map.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) })
  })
  const ready = new Promise<{ fallback: boolean }>((resolve) => {
    let settled = false
    const useFallback = () => {
      if (settled) return
      settled = true
      map.setStyle(MAP_STYLE_FALLBACK)
      map.once('style.load', () => resolve({ fallback: true }))
    }
    const timer = setTimeout(useFallback, STYLE_LOAD_TIMEOUT_MS)
    map.once('style.load', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ fallback: false })
    })
    map.on('error', (e: MlErrorEvent) => {
      // Only a failure to fetch the style itself warrants the fallback; tile errors are routine.
      if (!settled && !map.isStyleLoaded() && /style/i.test(String(e?.error?.message ?? ''))) {
        clearTimeout(timer)
        useFallback()
      }
    })
  })
  return { map, ready }
}

/** Grey out default 3D buildings so the selected extrusion stands out. */
export function softenBuildings(map: MlMap) {
  if (!map.getLayer(BUILDING_LAYER)) return
  map.setPaintProperty(BUILDING_LAYER, 'fill-extrusion-color', BUILDING_SOFT_COLOR)
  map.setPaintProperty(BUILDING_LAYER, 'fill-extrusion-opacity', BUILDING_SOFT_OPACITY)
}

/**
 * Run `fn` once layers can be added. Only call with a map that has fired 'load'
 * (AnalysisMap provides it after load). isStyleLoaded() is also false while any
 * source is loading tiles, so don't gate on it: try, and retry on 'idle' if refused.
 */
export function whenStyleReady(map: MlMap, fn: () => void) {
  try {
    fn()
  } catch (e) {
    if (!/style is not done loading/i.test(String((e as Error)?.message))) throw e
    map.once('idle', () => whenStyleReady(map, fn))
  }
}

export function ensureSource(map: MlMap, id: string, spec: SourceSpecification) {
  if (!map.getSource(id)) map.addSource(id, spec)
}

export function ensureLayer(map: MlMap, spec: LayerSpecification, beforeId?: string) {
  if (map.getLayer(spec.id)) return
  map.addLayer(spec, beforeId && map.getLayer(beforeId) ? beforeId : undefined)
}

/** Remove layers then their source; safe if already gone or the map was removed. */
export function removeLayersAndSource(map: MlMap | null, layerIds: string[], sourceId?: string) {
  if (!map || !map.style) return
  try {
    for (const id of layerIds) if (map.getLayer(id)) map.removeLayer(id)
    if (sourceId && map.getSource(sourceId)) map.removeSource(sourceId)
  } catch {
    // map torn down mid-unmount
  }
}

/** First symbol layer, so our overlays sit under labels. */
export function firstSymbolLayer(map: MlMap): string | undefined {
  return map.getStyle().layers.find(l => l.type === 'symbol')?.id
}

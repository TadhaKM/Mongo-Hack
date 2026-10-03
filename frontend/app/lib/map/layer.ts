import { Popup, type Map as MlMap } from 'maplibre-gl'
import { inject, onBeforeUnmount, watch, type ShallowRef } from 'vue'
import { MAP_KEY, removeLayersAndSource, whenStyleReady } from './core'
import { REGISTRY_KEY, type FeatureRegistry } from './registry'

/** Map + registry provided by AnalysisMap. Layer components render inside its slot. */
export function useMapContext(): { map: ShallowRef<MlMap | null>; registry: FeatureRegistry } {
  const map = inject(MAP_KEY)
  const registry = inject(REGISTRY_KEY)
  if (!map || !registry) throw new Error('Map layers must be rendered inside <AnalysisMap>')
  return { map, registry }
}

/**
 * Run `add` once the map style is ready, and remove the layers/source on unmount.
 */
export function useLayerLifecycle(map: ShallowRef<MlMap | null>, opts: { layers: string[]; source?: string; add: (m: MlMap) => void }) {
  const stop = watch(map, (m) => {
    if (m) whenStyleReady(m, () => opts.add(m))
  }, { immediate: true })
  onBeforeUnmount(() => {
    stop()
    removeLayersAndSource(map.value, opts.layers, opts.source)
  })
}

/** Small hover card. Content is built with text nodes only (API data is untrusted). */
export class HoverTip {
  private popup = new Popup({ closeButton: false, closeOnClick: false, className: 'rc-tip', offset: 14, maxWidth: '240px' })

  show(map: MlMap, at: [number, number], title: string, lines: string[]) {
    const root = document.createElement('div')
    const t = document.createElement('strong')
    t.textContent = title
    root.appendChild(t)
    for (const line of lines) {
      const d = document.createElement('div')
      d.className = 'rc-tip__muted'
      d.textContent = line
      root.appendChild(d)
    }
    this.popup.setLngLat(at).setDOMContent(root).addTo(map)
  }

  hide() {
    this.popup.remove()
  }
}

/** Set or clear `hover` feature-state on a source with promoteId. */
export function setHoverState(map: MlMap | null, source: string, prev: string | null, next: string | null) {
  if (!map?.getSource(source)) return
  if (prev) map.setFeatureState({ source, id: prev }, { hover: false })
  if (next) map.setFeatureState({ source, id: next }, { hover: true })
}

/** Animate a paint property from 0 to `to` (uses MapLibre paint transitions). */
export function fadeIn(map: MlMap, layer: string, prop: string, to: number, duration = 600) {
  if (!map.getLayer(layer)) return
  map.setPaintProperty(layer, `${prop}-transition`, { duration, delay: 0 })
  map.setPaintProperty(layer, prop, 0)
  requestAnimationFrame(() => {
    if (map.getLayer(layer)) map.setPaintProperty(layer, prop, to)
  })
}

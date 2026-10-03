<script setup lang="ts">
import { Marker, type GeoJSONSource } from 'maplibre-gl'
import { h, render, type Component } from 'vue'
import { Bus, TrainFront, TramFront } from '@lucide/vue'
import type { LngLat, TransportMode, TransportStop } from '~/types/api'
import { featureCollection } from '~/lib/map/geo'
import { ensureLayer, ensureSource, firstSymbolLayer } from '~/lib/map/core'
import { token } from '~/lib/map/colors'
import { HoverTip, useLayerLifecycle, useMapContext } from '~/lib/map/layer'
import { parseFeatureId, type FeatureId } from '~/composables/useMapSelection'

const props = withDefaults(defineProps<{ stops: TransportStop[]; home: LngLat; visible?: boolean }>(), { visible: true })

const SOURCE = 'analysis-transport-lines'
const LINE = 'analysis-transport-line'
const ICONS: Record<TransportMode, Component> = { luas: TramFront, dart: TrainFront, rail: TrainFront, bus: Bus }
const MODE_LABEL: Record<TransportMode, string> = { luas: 'Luas', dart: 'DART', rail: 'Rail', bus: 'Bus' }

const { map, registry } = useMapContext()
const sel = useMapSelection()
const tip = new HoverTip()
const markers = new Map<string, { marker: Marker; el: HTMLElement }>()

/** Nearest stop of each mode, for the thin connector lines. */
function lineData() {
  const nearest = new Map<TransportMode, TransportStop>()
  for (const s of props.stops) {
    const cur = nearest.get(s.mode)
    if (!cur || s.distance_m < cur.distance_m) nearest.set(s.mode, s)
  }
  return featureCollection([...nearest.values()].map(s => ({
    type: 'Feature' as const,
    geometry: { type: 'LineString' as const, coordinates: [[props.home.lng, props.home.lat], [s.location.lng, s.location.lat]] },
    properties: { mode: s.mode },
  })))
}

useLayerLifecycle(map, {
  layers: [LINE],
  source: SOURCE,
  add(m) {
    ensureSource(m, SOURCE, { type: 'geojson', data: lineData() })
    ensureLayer(m, {
      id: LINE, type: 'line', source: SOURCE,
      layout: { 'line-cap': 'round' },
      paint: {
        'line-color': ['match', ['get', 'mode'],
          'luas', token('--transport-luas'), 'dart', token('--transport-dart'),
          'rail', token('--transport-rail'), token('--transport-bus')],
        'line-width': 2,
        'line-dasharray': [1, 2],
        'line-opacity': 0.8,
      },
    }, firstSymbolLayer(m))
    syncMarkers()
  },
})

function syncMarkers() {
  const m = map.value
  if (!m) return
  const want = new Set(props.visible ? props.stops.map(s => s.id) : [])
  for (const [id, { marker }] of markers) {
    if (!want.has(id)) { marker.remove(); markers.delete(id) }
  }
  if (!props.visible) return
  for (const s of props.stops) {
    if (markers.has(s.id)) continue
    const el = document.createElement('button')
    el.type = 'button'
    el.className = 'rc-stop rc-stop--enter'
    el.style.setProperty('--stop-color', `var(--transport-${s.mode})`)
    el.setAttribute('aria-label', `${MODE_LABEL[s.mode]} stop ${s.name}, ${s.walk_min} min walk`)
    render(h(ICONS[s.mode], { size: 15, strokeWidth: 2.5 }), el)
    el.addEventListener('mouseenter', () => {
      sel.hover(`stop:${s.id}` as FeatureId)
      tip.show(m, [s.location.lng, s.location.lat], s.name, [
        `${MODE_LABEL[s.mode]}${s.routes.length ? ` · ${s.routes.slice(0, 3).join(', ')}` : ''}`,
        `${s.walk_min} min walk`,
      ])
    })
    el.addEventListener('mouseleave', () => { sel.hover(null); tip.hide() })
    el.addEventListener('click', (e) => { e.stopPropagation(); sel.focusFeature(`stop:${s.id}` as FeatureId) })
    const marker = new Marker({ element: el }).setLngLat([s.location.lng, s.location.lat]).addTo(m)
    markers.set(s.id, { marker, el })
  }
}

watch(() => props.stops, (stops) => {
  ;(map.value?.getSource(SOURCE) as GeoJSONSource | undefined)?.setData(lineData())
  registry.set('transport', stops.map(s => [`stop:${s.id}`, s.location]))
  syncMarkers()
}, { immediate: true })

watch(() => props.visible, (v) => {
  const m = map.value
  if (m?.getLayer(LINE)) m.setLayoutProperty(LINE, 'visibility', v ? 'visible' : 'none')
  syncMarkers()
})

watch(sel.hoveredFeature, (id) => {
  const hoveredId = id?.startsWith('stop:') ? parseFeatureId(id).id : null
  for (const [sid, { el }] of markers) el.classList.toggle('is-hovered', sid === hoveredId)
})

onBeforeUnmount(() => {
  tip.hide()
  for (const { marker, el } of markers.values()) { render(null, el); marker.remove() }
  markers.clear()
  registry.clear('transport')
})
</script>

<template>
  <span hidden />
</template>

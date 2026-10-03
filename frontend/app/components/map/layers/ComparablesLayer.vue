<script setup lang="ts">
import type { GeoJSONSource, MapLayerMouseEvent } from 'maplibre-gl'
import type { Comparable } from '~/types/api'
import { featureCollection, point } from '~/lib/map/geo'
import { ensureLayer, ensureSource } from '~/lib/map/core'
import { token, verdictVar, verdictVsAsking } from '~/lib/map/colors'
import { HoverTip, fadeIn, setHoverState, useLayerLifecycle, useMapContext } from '~/lib/map/layer'
import { parseFeatureId, type FeatureId } from '~/composables/useMapSelection'
import { eur, metres } from '~/lib/format'

const props = withDefaults(defineProps<{ items: Comparable[]; asking: number; bedrooms?: number | null; visible?: boolean }>(), { bedrooms: null, visible: true })

const SOURCE = 'analysis-comparables'
const LAYER = 'analysis-comparables-circle'
const { map, registry } = useMapContext()
const sel = useMapSelection()
const tip = new HoverTip()
let hovered: string | null = null
let shown = false

const shownItems = computed(() => props.bedrooms == null ? props.items : props.items.filter(c => c.bedrooms === props.bedrooms))

function data() {
  return featureCollection(shownItems.value.map(c => point(c.location, {
    id: c.id, rent: c.rent, bedrooms: c.bedrooms, distance_m: c.distance_m, similarity: c.similarity,
    verdict: verdictVsAsking(c.rent, props.asking),
  })))
}

useLayerLifecycle(map, {
  layers: [LAYER],
  source: SOURCE,
  add(m) {
    ensureSource(m, SOURCE, { type: 'geojson', data: data(), promoteId: 'id' })
    ensureLayer(m, {
      id: LAYER, type: 'circle', source: SOURCE,
      paint: {
        'circle-color': ['match', ['get', 'verdict'],
          'below_market', token(verdictVar.below_market),
          'above_market', token(verdictVar.above_market),
          token(verdictVar.in_line)],
        'circle-radius': ['+',
          ['interpolate', ['linear'], ['coalesce', ['get', 'similarity'], 0.5], 0, 4, 1, 9],
          ['case', ['boolean', ['feature-state', 'hover'], false], 4, 0]],
        'circle-stroke-color': ['case', ['boolean', ['feature-state', 'hover'], false], token('--brand', '#2563eb'), '#ffffff'],
        'circle-stroke-width': ['case', ['boolean', ['feature-state', 'hover'], false], 3, 1.5],
        'circle-opacity': 0,
        'circle-stroke-opacity': 0,
        'circle-radius-transition': { duration: 200, delay: 0 },
      },
    })
    m.on('mousemove', LAYER, onMove)
    m.on('mouseleave', LAYER, onLeave)
    m.on('click', LAYER, onClick)
    applyVisibility()
    if (shownItems.value.length) entrance()
  },
})

onBeforeUnmount(() => {
  const m = map.value
  m?.off('mousemove', LAYER, onMove)
  m?.off('mouseleave', LAYER, onLeave)
  m?.off('click', LAYER, onClick)
  tip.hide()
  registry.clear('comparables')
})

function entrance() {
  const m = map.value
  if (!m || shown) return
  shown = true
  fadeIn(m, LAYER, 'circle-opacity', 1)
  fadeIn(m, LAYER, 'circle-stroke-opacity', 1)
}

function onMove(e: MapLayerMouseEvent) {
  const f = e.features?.[0]
  if (!f) return
  map.value!.getCanvas().style.cursor = 'pointer'
  sel.hover(`cmp:${f.properties.id}` as FeatureId)
  const p = f.properties
  tip.show(map.value!, (f.geometry as GeoJSON.Point).coordinates as [number, number], `${eur(p.rent)}/month`, [
    `${p.bedrooms} bed · ${metres(p.distance_m)} away`,
  ])
}

function onLeave() {
  map.value!.getCanvas().style.cursor = ''
  sel.hover(null)
  tip.hide()
}

function onClick(e: MapLayerMouseEvent) {
  const f = e.features?.[0]
  if (f) sel.focusFeature(`cmp:${f.properties.id}` as FeatureId)
}

function applyVisibility() {
  const m = map.value
  if (m?.getLayer(LAYER)) m.setLayoutProperty(LAYER, 'visibility', props.visible ? 'visible' : 'none')
}

watch(shownItems, (items) => {
  const m = map.value
  ;(m?.getSource(SOURCE) as GeoJSONSource | undefined)?.setData(data())
  registry.set('comparables', items.map(c => [`cmp:${c.id}`, c.location]))
  if (items.length) entrance()
}, { immediate: true })

watch(() => props.visible, applyVisibility)

// Two-way hover: rows in A's table → pulse the dot here.
watch(sel.hoveredFeature, (id) => {
  const next = id?.startsWith('cmp:') ? parseFeatureId(id).id : null
  if (next === hovered) return
  setHoverState(map.value, SOURCE, hovered, next)
  hovered = next
})
</script>

<template>
  <span hidden />
</template>

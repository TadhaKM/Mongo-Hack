<script setup lang="ts">
import type { GeoJSONSource } from 'maplibre-gl'
import type { LngLat } from '~/types/api'
import { circlePolygon, EMPTY, featureCollection } from '~/lib/map/geo'
import { ensureLayer, ensureSource, firstSymbolLayer } from '~/lib/map/core'
import { token } from '~/lib/map/colors'
import { useLayerLifecycle, useMapContext } from '~/lib/map/layer'

const props = withDefaults(defineProps<{ center: LngLat; radiusM?: number | null; visible?: boolean }>(), { radiusM: 1500, visible: true })

const SOURCE = 'analysis-radius'
const FILL = 'analysis-radius-fill'
const LINE = 'analysis-radius-line'
const { map } = useMapContext()

function data() {
  return featureCollection([circlePolygon(props.center, props.radiusM ?? 1500)])
}

useLayerLifecycle(map, {
  layers: [LINE, FILL],
  source: SOURCE,
  add(m) {
    ensureSource(m, SOURCE, { type: 'geojson', data: data() })
    const accent = token('--brand', '#2563eb')
    const before = firstSymbolLayer(m)
    ensureLayer(m, { id: FILL, type: 'fill', source: SOURCE, paint: { 'fill-color': accent, 'fill-opacity': 0.05 } }, before)
    ensureLayer(m, {
      id: LINE, type: 'line', source: SOURCE,
      paint: { 'line-color': accent, 'line-width': 2, 'line-dasharray': [2, 2], 'line-opacity': 0.8 },
    }, before)
    applyVisibility()
  },
})

function applyVisibility() {
  const m = map.value
  for (const id of [FILL, LINE]) if (m?.getLayer(id)) m.setLayoutProperty(id, 'visibility', props.visible ? 'visible' : 'none')
}

watch(() => [props.center.lng, props.center.lat, props.radiusM], () => {
  (map.value?.getSource(SOURCE) as GeoJSONSource | undefined)?.setData(props.center ? data() : EMPTY)
})
watch(() => props.visible, applyVisibility)
</script>

<template>
  <span hidden />
</template>

<script setup lang="ts">
import 'maplibre-gl/dist/maplibre-gl.css'
import { Marker, type Map as MlMap } from 'maplibre-gl'
import type { LngLat } from '~/types/api'
import { MAP_STYLE_FALLBACK } from '~/lib/map/config'
import { createMap } from '~/lib/map/core'
import { boundsOf } from '~/lib/map/geo'
import { parseFeatureId, type FeatureId } from '~/composables/useMapSelection'

// Static, flat, non-interactive map for the printable report. Positron prints cleaner.
const props = defineProps<{ center: LngLat; points: { id: FeatureId; location: LngLat }[] }>()

const el = ref<HTMLDivElement>()
let map: MlMap | null = null

const DOT_VAR: Record<string, string> = {
  cmp: 'var(--verdict-inline)',
  stop: 'var(--transport-luas)',
  plan: 'var(--planning-pending)',
  amenity: 'var(--muted-foreground)',
  listing: 'var(--brand)',
}

onMounted(async () => {
  const { map: m, ready } = createMap({
    container: el.value!, style: MAP_STYLE_FALLBACK, center: [props.center.lng, props.center.lat], zoom: 14,
    pitch: 0, bearing: 0, interactive: false, attributionControl: { compact: true },
    canvasContextAttributes: { preserveDrawingBuffer: true }, // so the canvas prints
  })
  map = m
  await ready
  const b = boundsOf([props.center, ...props.points.map(p => p.location)])
  if (b && props.points.length) m.fitBounds(b, { padding: 28, maxZoom: 16, duration: 0 })

  for (const p of props.points) {
    const dot = document.createElement('div')
    dot.style.cssText = `width:10px;height:10px;border-radius:50%;border:1.5px solid #fff;box-shadow:0 0 0 0.5px rgb(0 0 0 / .3);background:${DOT_VAR[parseFeatureId(p.id).kind] ?? DOT_VAR.cmp}`
    new Marker({ element: dot }).setLngLat([p.location.lng, p.location.lat]).addTo(m)
  }
  const home = document.createElement('div')
  home.style.cssText = 'width:18px;height:18px;border-radius:50%;background:var(--brand);border:3px solid #fff;box-shadow:0 1px 4px rgb(0 0 0 / .35)'
  new Marker({ element: home }).setLngLat([props.center.lng, props.center.lat]).addTo(m)
})

onBeforeUnmount(() => {
  map?.remove()
  map = null
})
</script>

<template>
  <div ref="el" class="h-64 w-full overflow-hidden rounded-lg border print:break-inside-avoid" />
</template>

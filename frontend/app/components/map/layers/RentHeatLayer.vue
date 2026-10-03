<script setup lang="ts">
import type { GeoJSONSource, MapLayerMouseEvent } from 'maplibre-gl'
import type { ListingSummary } from '~/types/api'
import { ensureLayer, ensureSource, firstSymbolLayer } from '~/lib/map/core'
import { token } from '~/lib/map/colors'
import { hexbin, hexRadiusForZoom } from '~/lib/map/hex'
import { HoverTip, fadeIn, useLayerLifecycle, useMapContext } from '~/lib/map/layer'
import { pct } from '~/lib/format'

// "Where is rent high?": listings in view binned into hexagons, each coloured by the
// average % above/below the local median of the listings inside it.
const props = defineProps<{ items: ListingSummary[] }>()

const SOURCE = 'rent-heat'
const FILL = 'rent-heat-fill'
const LINE = 'rent-heat-line'
const { map } = useMapContext()
const tip = new HoverTip()
let zoomBucket = -1

function data() {
  const m = map.value
  return hexbin(props.items, hexRadiusForZoom(m ? m.getZoom() : 14))
}

useLayerLifecycle(map, {
  layers: [LINE, FILL],
  source: SOURCE,
  add(m) {
    zoomBucket = Math.round(m.getZoom())
    ensureSource(m, SOURCE, { type: 'geojson', data: data() })
    const bands = ['match', ['get', 'band'],
      1, token('--band-1'), 2, token('--band-2'), 3, token('--band-3'), 4, token('--band-4'), token('--band-5')]
    const before = firstSymbolLayer(m)
    ensureLayer(m, { id: FILL, type: 'fill', source: SOURCE, paint: { 'fill-color': bands as never, 'fill-opacity': 0 } }, before)
    ensureLayer(m, { id: LINE, type: 'line', source: SOURCE, paint: { 'line-color': bands as never, 'line-width': 1, 'line-opacity': 0 } }, before)
    fadeIn(m, FILL, 'fill-opacity', 0.5, 400)
    fadeIn(m, LINE, 'line-opacity', 0.8, 400)
    m.on('zoomend', onZoom)
    m.on('mousemove', FILL, onMove)
    m.on('mouseleave', FILL, onLeave)
  },
})

onBeforeUnmount(() => {
  const m = map.value
  m?.off('zoomend', onZoom)
  m?.off('mousemove', FILL, onMove)
  m?.off('mouseleave', FILL, onLeave)
  tip.hide()
})

function refresh() {
  ;(map.value?.getSource(SOURCE) as GeoJSONSource | undefined)?.setData(data())
}

/** Re-bin only when the zoom crosses a whole level (hex size changes). */
function onZoom() {
  const z = Math.round(map.value?.getZoom() ?? 0)
  if (z === zoomBucket) return
  zoomBucket = z
  refresh()
}

function onMove(e: MapLayerMouseEvent) {
  const f = e.features?.[0]
  if (!f) return
  const p = f.properties as { mean: number; count: number }
  tip.show(map.value!, [e.lngLat.lng, e.lngLat.lat], `${pct(p.mean, { sign: true })} vs local median`, [
    `Average of ${p.count} ${p.count === 1 ? 'rental' : 'rentals'} here`,
  ])
}

function onLeave() {
  tip.hide()
}

watch(() => props.items, refresh)
</script>

<template>
  <span hidden />
</template>

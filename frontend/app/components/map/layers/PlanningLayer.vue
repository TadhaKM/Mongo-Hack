<script setup lang="ts">
import type { GeoJSONSource, Map as MlMap, MapLayerMouseEvent } from 'maplibre-gl'
import type { PlanningApplication, PlanningStatus } from '~/types/api'
import { circlePolygon, featureCollection, point } from '~/lib/map/geo'
import { ensureLayer, ensureSource } from '~/lib/map/core'
import { planningVar, token } from '~/lib/map/colors'
import { HoverTip, setHoverState, useLayerLifecycle, useMapContext } from '~/lib/map/layer'
import { parseFeatureId, type FeatureId } from '~/composables/useMapSelection'
import { metres } from '~/lib/format'

const props = withDefaults(defineProps<{ items: PlanningApplication[]; visible?: boolean }>(), { visible: true })

const SOURCE = 'analysis-planning'
const COLUMNS = 'analysis-planning-columns'
const L_COLUMN = 'analysis-planning-column'
const L_HALO = 'analysis-planning-halo'
const L_ICON = 'analysis-planning-icon'
const STATUSES: PlanningStatus[] = ['granted', 'pending', 'refused', 'appealed']
const STATUS_LABEL: Record<PlanningStatus, string> = { granted: 'Granted', pending: 'Pending', refused: 'Refused', appealed: 'Appealed' }

const { map, registry } = useMapContext()
const sel = useMapSelection()
const tip = new HoverTip()
let hovered: string | null = null

function data() {
  return featureCollection(props.items.map(p => point(p.location, {
    id: p.id, reference: p.reference, status: p.status, summary: p.summary, distance_m: p.distance_m,
  })))
}

/** Translucent column on granted sites: "this is getting built". */
function columnData() {
  return featureCollection(props.items.filter(p => p.status === 'granted').map(p => circlePolygon(p.location, 15, 24)))
}

/** Rounded-square marker images, one per status, drawn once. */
function addIcons(m: MlMap) {
  const ratio = window.devicePixelRatio || 1
  const size = 22
  for (const status of STATUSES) {
    const name = `rc-plan-${status}`
    if (m.hasImage(name)) continue
    const c = document.createElement('canvas')
    c.width = c.height = size * ratio
    const ctx = c.getContext('2d')!
    ctx.scale(ratio, ratio)
    ctx.beginPath()
    ctx.roundRect(2, 2, size - 4, size - 4, 5)
    ctx.fillStyle = token(planningVar[status])
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = '#fff'
    ctx.stroke()
    m.addImage(name, ctx.getImageData(0, 0, c.width, c.height), { pixelRatio: ratio })
  }
}

useLayerLifecycle(map, {
  layers: [L_ICON, L_HALO, L_COLUMN],
  source: SOURCE,
  add(m) {
    addIcons(m)
    ensureSource(m, SOURCE, { type: 'geojson', data: data(), promoteId: 'id' })
    ensureSource(m, COLUMNS, { type: 'geojson', data: columnData() })
    ensureLayer(m, {
      id: L_COLUMN, type: 'fill-extrusion', source: COLUMNS,
      paint: { 'fill-extrusion-color': token('--planning-granted'), 'fill-extrusion-height': 40, 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.35 },
    })
    ensureLayer(m, {
      id: L_HALO, type: 'circle', source: SOURCE,
      paint: {
        'circle-radius': 18,
        'circle-color': token('--brand', '#2563eb'),
        'circle-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.25, 0],
      },
    })
    ensureLayer(m, {
      id: L_ICON, type: 'symbol', source: SOURCE,
      layout: { 'icon-image': ['concat', 'rc-plan-', ['get', 'status']], 'icon-allow-overlap': true, 'icon-ignore-placement': true },
    })
    m.on('mousemove', L_ICON, onMove)
    m.on('mouseleave', L_ICON, onLeave)
    m.on('click', L_ICON, onClick)
    applyVisibility()
  },
})

onBeforeUnmount(() => {
  const m = map.value
  m?.off('mousemove', L_ICON, onMove)
  m?.off('mouseleave', L_ICON, onLeave)
  m?.off('click', L_ICON, onClick)
  if (m?.style && m.getSource(COLUMNS) && !m.getLayer(L_COLUMN)) m.removeSource(COLUMNS)
  tip.hide()
  registry.clear('planning')
})

function onMove(e: MapLayerMouseEvent) {
  const f = e.features?.[0]
  if (!f) return
  const p = f.properties
  map.value!.getCanvas().style.cursor = 'pointer'
  sel.hover(`plan:${p.id}` as FeatureId)
  tip.show(map.value!, (f.geometry as GeoJSON.Point).coordinates as [number, number], p.reference, [
    `${STATUS_LABEL[p.status as PlanningStatus]} · ${metres(p.distance_m)} away`,
    String(p.summary ?? ''),
  ])
}

function onLeave() {
  map.value!.getCanvas().style.cursor = ''
  sel.hover(null)
  tip.hide()
}

function onClick(e: MapLayerMouseEvent) {
  const f = e.features?.[0]
  if (f) sel.focusFeature(`plan:${f.properties.id}` as FeatureId)
}

function applyVisibility() {
  const m = map.value
  for (const id of [L_ICON, L_HALO, L_COLUMN]) if (m?.getLayer(id)) m.setLayoutProperty(id, 'visibility', props.visible ? 'visible' : 'none')
}

watch(() => props.items, (items) => {
  const m = map.value
  ;(m?.getSource(SOURCE) as GeoJSONSource | undefined)?.setData(data())
  ;(m?.getSource(COLUMNS) as GeoJSONSource | undefined)?.setData(columnData())
  registry.set('planning', items.map(p => [`plan:${p.id}`, p.location]))
}, { immediate: true })

watch(() => props.visible, applyVisibility)

watch(sel.hoveredFeature, (id) => {
  const next = id?.startsWith('plan:') ? parseFeatureId(id).id : null
  if (next === hovered) return
  setHoverState(map.value, SOURCE, hovered, next)
  hovered = next
})
</script>

<template>
  <span hidden />
</template>

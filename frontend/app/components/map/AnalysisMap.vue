<script setup lang="ts">
import 'maplibre-gl/dist/maplibre-gl.css'
import '~/lib/map/map.css'
import { Marker, type Map as MlMap, type GeoJSONSource, type MapMouseEvent } from 'maplibre-gl'
import { useDebounceFn, useMediaQuery } from '@vueuse/core'
import { Box, Crosshair, MapPinPlus, ZoomIn } from '@lucide/vue'
import RadialMenu, { type RadialItem } from './RadialMenu.vue'
import { toast } from 'vue-sonner'
import type { ListingSummary, LngLat } from '~/types/api'
import {
  BBOX_DEBOUNCE_MS, CAMERA, DESKTOP_QUERY, DUBLIN_CENTER, PITCH_3D,
} from '~/lib/map/config'
import { MAP_KEY, createMap, softenBuildings } from '~/lib/map/core'
import { clearBuildingHighlight, highlightBuildingWhenSettled, removeBuildingHighlight } from '~/lib/map/building'
import { fitPoints, flyToProperty, flyToSnapshot, panelPadding, snapshot, startOrbit, type CameraSnapshot } from '~/lib/map/camera'
import { LISTINGS_SOURCE, PricePins, listingsGeoJSON } from '~/lib/map/pins'
import { token } from '~/lib/map/colors'
import { roundBBox, type BBox } from '~/lib/map/geo'
import { FeatureRegistry, REGISTRY_KEY } from '~/lib/map/registry'
import { useMapUi } from '~/lib/map/state'
import { parseFeatureId } from '~/composables/useMapSelection'

const props = defineProps<{ listings: ListingSummary[] }>()

const container = ref<HTMLDivElement>()
const map = shallowRef<MlMap | null>(null)
const registry = new FeatureRegistry()
provide(MAP_KEY, map)
provide(REGISTRY_KEY, registry)

const sel = useMapSelection()
const ui = useMapUi()
const desktop = useMediaQuery(DESKTOP_QUERY)
const flat = computed(() => !(ui.is3D.value ?? desktop.value))

const { data: selectedListing } = useListing(sel.selectedListingId)
const { data: analysis } = useAnalysis(sel.activeAnalysisId)

let pins: PricePins | null = null
let browseCam: CameraSnapshot | null = null
let stopOrbit: (() => void) | null = null
let dropMarker: Marker | null = null

/** Where the current property is: analysis result, selected listing, or dropped pin. */
const propertyLocation = computed<LngLat | null>(() =>
  analysis.value?.property?.location
  ?? selectedListing.value?.location
  ?? props.listings.find(l => l.id === sel.selectedListingId.value)?.location
  ?? sel.droppedPin.value?.location
  ?? null)

// --- setup ------------------------------------------------------------------

onMounted(async () => {
  const start = flat.value ? CAMERA.mobileBrowse : CAMERA.browse
  const { map: m, ready } = createMap({ container: container.value!, center: DUBLIN_CENTER, ...start })
  m.dragRotate.enable()
  m.touchZoomRotate.enableRotation()
  const { fallback } = await ready
  if (fallback) toast('Using simplified map')
  if (!m.loaded()) await new Promise(r => m.once('load', r))

  softenBuildings(m)
  addListingLayers(m)
  pins = new PricePins(m, {
    hover: id => sel.hover(id ? `listing:${id}` : null),
    select: id => sel.selectListing(id),
  })
  pins.setListings(props.listings)
  syncPinState()

  m.on('moveend', updateBBox)
  updateBBox()
  m.on('contextmenu', (e: MapMouseEvent) => openRadial(e.point, e.lngLat))
  m.on('movestart', closeRadial)
  m.on('click', closeRadial)
  attachLongPress(m)

  map.value = m
  if (import.meta.dev) (window as unknown as { __rcMap?: MlMap }).__rcMap = m
  // State restored from the URL before the map existed.
  if (sel.selectedListingId.value || sel.activeAnalysisId.value) onSelectionChange()
  if (sel.droppedPin.value) syncDropMarker()
})

onBeforeUnmount(() => {
  stopOrbit?.()
  pins?.destroy()
  dropMarker?.remove()
  removeBuildingHighlight(map.value)
  map.value?.remove()
  map.value = null
})

function addListingLayers(m: MlMap) {
  m.addSource(LISTINGS_SOURCE, {
    type: 'geojson', data: listingsGeoJSON(props.listings),
    cluster: true, clusterRadius: 50, clusterMaxZoom: 14,
  })
  const accent = token('--brand', '#2563eb')
  m.addLayer({
    id: 'listing-clusters', type: 'circle', source: LISTINGS_SOURCE, filter: ['has', 'point_count'],
    paint: {
      'circle-color': accent, 'circle-opacity': 0.9,
      'circle-radius': ['step', ['get', 'point_count'], 16, 10, 20, 30, 26],
      'circle-stroke-width': 3, 'circle-stroke-color': '#fff',
    },
  })
  m.addLayer({
    id: 'listing-cluster-count', type: 'symbol', source: LISTINGS_SOURCE, filter: ['has', 'point_count'],
    layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Bold'], 'text-size': 13, 'text-allow-overlap': true },
    paint: { 'text-color': '#fff' },
  })
  m.on('click', 'listing-clusters', async (e) => {
    const f = e.features?.[0]
    if (!f) return
    const src = m.getSource(LISTINGS_SOURCE) as GeoJSONSource
    const zoom = await src.getClusterExpansionZoom(f.properties.cluster_id)
    m.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom: zoom + 0.5 })
  })
  m.on('mouseenter', 'listing-clusters', () => { m.getCanvas().style.cursor = 'pointer' })
  m.on('mouseleave', 'listing-clusters', () => { m.getCanvas().style.cursor = '' })
}

const updateBBox = useDebounceFn(() => {
  const m = map.value
  if (!m || sel.activeAnalysisId.value) return
  const b = m.getBounds()
  ui.bbox.value = roundBBox([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] as BBox)
}, BBOX_DEBOUNCE_MS)

// --- listings & pins --------------------------------------------------------

watch(() => props.listings, (items) => {
  const src = map.value?.getSource(LISTINGS_SOURCE) as GeoJSONSource | undefined
  src?.setData(listingsGeoJSON(items))
  pins?.setListings(items)
})

watch(selectedListing, (l) => { if (l) pins?.remember(l) })

function syncPinState() {
  const hovered = sel.hoveredFeature.value
  pins?.setState({
    selectedId: sel.selectedListingId.value,
    hoveredId: hovered?.startsWith('listing:') ? parseFeatureId(hovered).id : null,
    visited: new Set(ui.visited.value),
    onlySelected: !!sel.activeAnalysisId.value,
  })
  const m = map.value
  if (m?.getLayer('listing-clusters')) {
    const vis = sel.activeAnalysisId.value ? 'none' : 'visible'
    m.setLayoutProperty('listing-clusters', 'visibility', vis)
    m.setLayoutProperty('listing-cluster-count', 'visibility', vis)
  }
}
watch([sel.selectedListingId, sel.hoveredFeature, sel.activeAnalysisId, ui.visited], syncPinState, { deep: true })

// --- selection: fly-in + building highlight ---------------------------------

let flyToken = 0
async function onSelectionChange() {
  const m = map.value
  if (!m) return
  const id = sel.selectedListingId.value
  const target = propertyLocation.value
  if (!id && !sel.activeAnalysisId.value && !sel.droppedPin.value) {
    clearBuildingHighlight(m)
    if (browseCam) flyToSnapshot(m, browseCam)
    browseCam = null
    return
  }
  if (!target) return
  browseCam ??= snapshot(m)
  if (id && !ui.visited.value.includes(id)) ui.visited.value = [...ui.visited.value, id]
  const t = ++flyToken
  clearBuildingHighlight(m)
  if (sel.activeAnalysisId.value) flyToAnalysis(target)
  else flyToProperty(m, target, { desktop: desktop.value, flat: flat.value })
  m.once('moveend', async () => {
    if (t !== flyToken || !map.value) return
    await highlightBuildingWhenSettled(m, target)
  })
}
watch(() => [sel.selectedListingId.value, sel.droppedPin.value, propertyLocation.value?.lng, propertyLocation.value?.lat], onSelectionChange)

// --- radial menu (right-click / long-press) ----------------------------------

const radial = ref<{ x: number; y: number; lngLat: LngLat } | null>(null)
const radialRef = ref<InstanceType<typeof RadialMenu> | null>(null)

const radialItems = computed<RadialItem[]>(() => [
  ...(sel.activeAnalysisId.value ? [] : [{ key: 'check', label: 'Check a property here', icon: MapPinPlus }]),
  { key: 'zoom', label: 'Zoom in here', icon: ZoomIn },
  { key: 'centre', label: 'Centre here', icon: Crosshair },
  { key: '3d', label: flat.value ? 'Show 3D' : 'Show 2D', icon: Box },
])

function openRadial(point: { x: number; y: number }, lngLat: { lng: number; lat: number }) {
  radial.value = { x: point.x, y: point.y, lngLat: { lng: lngLat.lng, lat: lngLat.lat } }
}

function closeRadial() {
  radialRef.value?.close()
}

function onRadialPick(key: string) {
  const m = map.value
  const at = radial.value?.lngLat
  if (!m || !at) return
  if (key === 'check') dropAt(at)
  else if (key === 'zoom') m.easeTo({ center: [at.lng, at.lat], zoom: Math.min(m.getZoom() + 2, 18), duration: 600 })
  else if (key === 'centre') m.easeTo({ center: [at.lng, at.lat], duration: 600 })
  else if (key === '3d') ui.is3D.value = flat.value
}

// --- dropped pin ------------------------------------------------------------

function dropAt(lngLat: { lng: number; lat: number }) {
  if (sel.activeAnalysisId.value) return
  sel.dropPin({ location: { lng: lngLat.lng, lat: lngLat.lat } })
}

function syncDropMarker() {
  const pin = sel.droppedPin.value
  const m = map.value
  if (!pin || !m) {
    dropMarker?.remove()
    dropMarker = null
    return
  }
  if (!dropMarker) {
    const el = document.createElement('div')
    el.className = 'rc-drop'
    el.setAttribute('aria-label', 'Check a property here')
    el.innerHTML = '<div class="rc-drop__dot"></div>'
    dropMarker = new Marker({ element: el }).setLngLat([pin.location.lng, pin.location.lat]).addTo(m)
  } else {
    dropMarker.setLngLat([pin.location.lng, pin.location.lat])
  }
}
watch(sel.droppedPin, syncDropMarker, { deep: true })

function attachLongPress(m: MlMap) {
  let timer: ReturnType<typeof setTimeout> | null = null
  const cancel = () => { if (timer) clearTimeout(timer); timer = null }
  m.on('touchstart', (e) => {
    if (e.originalEvent.touches.length !== 1) return cancel()
    const at = e.lngLat
    const pt = e.point
    timer = setTimeout(() => { timer = null; openRadial(pt, at) }, 500)
  })
  m.on('touchend', cancel)
  m.on('touchcancel', cancel)
  m.on('touchmove', cancel)
  m.on('movestart', cancel)
}

// --- analysis: orbit + framing ----------------------------------------------

const running = computed(() => !!sel.activeAnalysisId.value && analysis.value?.status === 'running')
watch(running, (now, before) => {
  const m = map.value
  if (!m) return
  if (now && !stopOrbit) {
    // Let any fly-in (possibly started later in this same tick) finish first.
    const begin = () => {
      if (!running.value || stopOrbit) return
      if (m.isMoving()) m.once('moveend', begin)
      else stopOrbit = startOrbit(m, () => { stopOrbit = null })
    }
    requestAnimationFrame(begin)
  } else if (!now) {
    stopOrbit?.()
    stopOrbit = null
    if (before && sel.activeAnalysisId.value) frameAnalysis()
  }
}, { immediate: true })

function frameAnalysis() {
  const m = map.value
  const home = propertyLocation.value
  if (!m) return
  fitPoints(m, [...registry.all(), ...(home ? [home] : [])], desktop.value)
}

watch(sel.activeAnalysisId, (id, prev) => {
  const home = propertyLocation.value
  if (id && !prev && map.value && home) {
    browseCam ??= snapshot(map.value)
    flyToAnalysis(home)
  }
  if (!id && prev) {
    stopOrbit?.()
    stopOrbit = null
    // Back from analysis to the card: return to the property.
    if (sel.selectedListingId.value || sel.droppedPin.value) onSelectionChange()
  }
})

/** Pull back so the radius and the layers filling in are in view while orbiting. */
function flyToAnalysis(home: LngLat) {
  const m = map.value
  if (!m) return
  m.flyTo({
    center: [home.lng, home.lat], zoom: CAMERA.analysis.zoom,
    pitch: flat.value ? 0 : CAMERA.analysis.pitch, bearing: m.getBearing(),
    padding: panelPadding(desktop.value),
    duration: 1200, essential: true,
  })
}

// --- focusFeature ------------------------------------------------------------

watch(sel.focusRequest, (req) => {
  const m = map.value
  if (!m || !req) return
  const loc = parseFeatureId(req.id).kind === 'listing'
    ? props.listings.find(l => `listing:${l.id}` === req.id)?.location
    : registry.get(req.id)
  if (!loc) return
  stopOrbit?.()
  stopOrbit = null
  m.easeTo({ center: [loc.lng, loc.lat], zoom: Math.max(m.getZoom(), 16), padding: panelPadding(desktop.value), duration: 800 })
})

// --- controls ---------------------------------------------------------------

watch(flat, (isFlat) => {
  map.value?.easeTo({ pitch: isFlat ? 0 : PITCH_3D, duration: 600 })
})

watch(ui.zoomBy, (req) => {
  if (req) map.value?.easeTo({ zoom: map.value.getZoom() + req.delta, duration: 300 })
})

watch(ui.recentre, () => {
  const m = map.value
  if (!m) return
  const home = propertyLocation.value
  if (home && (sel.selectedListingId.value || sel.activeAnalysisId.value || sel.droppedPin.value)) {
    flyToProperty(m, home, { desktop: desktop.value, flat: flat.value })
  } else {
    const c = flat.value ? CAMERA.mobileBrowse : CAMERA.browse
    m.flyTo({ center: DUBLIN_CENTER, ...c, pitch: flat.value ? 0 : c.pitch, padding: { left: 0, right: 0, top: 0, bottom: 0 } })
  }
})
</script>

<template>
  <div class="absolute inset-0">
    <div ref="container" class="h-full w-full" />
    <slot v-if="map" />
    <RadialMenu
      v-if="radial"
      :key="`${radial.x},${radial.y}`"
      ref="radialRef"
      :x="radial.x"
      :y="radial.y"
      :items="radialItems"
      @pick="onRadialPick"
      @closed="radial = null"
    />
  </div>
</template>

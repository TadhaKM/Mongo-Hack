import type { Map as MlMap, PaddingOptions } from 'maplibre-gl'
import type { LngLat } from '~/types/api'
import { CAMERA, FLY_DURATION_MS, PANEL_PADDING_LEFT } from './config'
import { boundsOf } from './geo'

export interface CameraSnapshot { center: [number, number]; zoom: number; pitch: number; bearing: number }

export function snapshot(map: MlMap): CameraSnapshot {
  const c = map.getCenter()
  return { center: [c.lng, c.lat], zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() }
}

/** Padding that keeps content clear of the desktop side panel (none on mobile). */
export function panelPadding(desktop: boolean, extra = 0): PaddingOptions {
  return desktop
    ? { top: 80 + extra, bottom: 40 + extra, left: PANEL_PADDING_LEFT + extra, right: 60 + extra }
    : { top: 120 + extra, bottom: 180 + extra, left: 20 + extra, right: 20 + extra }
}

/** Swoop in on a property. `flat` = 2D mode or mobile default. */
export function flyToProperty(map: MlMap, location: LngLat, opts: { desktop: boolean; flat: boolean }) {
  map.flyTo({
    center: [location.lng, location.lat],
    zoom: CAMERA.selected.zoom,
    pitch: opts.flat ? 0 : CAMERA.selected.pitch,
    bearing: opts.flat ? 0 : CAMERA.selected.bearing,
    padding: opts.desktop ? { left: PANEL_PADDING_LEFT, top: 0, right: 0, bottom: 0 } : { top: 0, left: 0, right: 0, bottom: 160 },
    duration: FLY_DURATION_MS,
    essential: true,
  })
}

export function flyToSnapshot(map: MlMap, s: CameraSnapshot) {
  map.flyTo({ ...s, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: FLY_DURATION_MS, essential: true })
}

/** Frame a set of points, keeping the current pitch and bearing. */
export function fitPoints(map: MlMap, points: LngLat[], desktop: boolean) {
  const b = boundsOf(points)
  if (!b) return
  // fitBounds with pitch + an arbitrary orbit bearing zooms far too wide, so solve the
  // camera top-down and ease there keeping the tilt.
  const pitch = map.getPitch()
  // The map keeps the padding of the last flyTo and cameraForBounds adds ours on top,
  // so ask only for the difference and keep the map's padding (no jump).
  const want = panelPadding(desktop, 20)
  const has = map.getPadding()
  const extra = {
    top: Math.max(0, want.top - has.top), bottom: Math.max(0, want.bottom - has.bottom),
    left: Math.max(0, want.left - has.left), right: Math.max(0, want.right - has.right),
  }
  const cam = map.cameraForBounds(b, { padding: extra, bearing: map.getBearing(), maxZoom: 16.5 })
  if (!cam?.center || cam.zoom == null) return
  map.easeTo({
    center: cam.center,
    zoom: cam.zoom,
    pitch,
    bearing: map.getBearing(),
    duration: 1200,
  })
}

/**
 * Slow orbit around the current centre. Stops itself when the user drags,
 * wheels or touches the map. Returns a stop function.
 */
export function startOrbit(map: MlMap, onUserInterrupt?: () => void): () => void {
  let stopped = false
  const spin = () => {
    if (stopped) return
    map.rotateTo(map.getBearing() + 30, { duration: 4000, easing: t => t })
    map.once('moveend', spin)
  }
  const interrupt = () => {
    if (stopped) return
    stop()
    onUserInterrupt?.()
  }
  const canvas = map.getCanvasContainer()
  map.on('dragstart', interrupt)
  canvas.addEventListener('wheel', interrupt, { passive: true })
  canvas.addEventListener('touchstart', interrupt, { passive: true })
  canvas.addEventListener('mousedown', interrupt)
  function stop() {
    if (stopped) return
    stopped = true
    map.off('moveend', spin)
    map.off('dragstart', interrupt)
    canvas.removeEventListener('wheel', interrupt)
    canvas.removeEventListener('touchstart', interrupt)
    canvas.removeEventListener('mousedown', interrupt)
    map.stop()
  }
  spin()
  return stop
}

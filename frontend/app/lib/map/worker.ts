import { setWorkerUrl } from 'maplibre-gl'
// MapLibre 6 finds its worker relative to its own module URL, which breaks once
// Vite pre-bundles it. Hand it a Vite-bundled worker instead (dev and build).
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

let done = false
export function ensureMapWorker() {
  if (done) return
  done = true
  setWorkerUrl(workerUrl)
}

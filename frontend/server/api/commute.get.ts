import type { CommuteOption, CommuteResponse, LngLat } from '../../app/types/api'

// GET /api/commute?from=lng,lat&to=lng,lat   or   ?from=lng,lat&q=Trinity College Dublin
// Real walking / cycling / driving routes from the free FOSSGIS OSRM servers (OpenStreetMap data).
// Public transport has no free routing API here, so it is an estimate built from the route, labelled as such.
const UA = 'MendAI-Hackathon/1.0 (ekene@marcprop.com)'
const geocodeCache = new Map<string, { location: LngLat; label: string } | null>()
const routeCache = new Map<string, CommuteResponse>()

const PROFILES = { walk: 'routed-foot', cycle: 'routed-bike', drive: 'routed-car' } as const

function parsePoint(v: unknown): LngLat | null {
  if (typeof v !== 'string') return null
  const [lng, lat] = v.split(',').map(Number)
  return Number.isFinite(lng) && Number.isFinite(lat) ? { lng: lng!, lat: lat! } : null
}

async function geocode(q: string) {
  const key = q.trim().toLowerCase()
  if (geocodeCache.has(key)) return geocodeCache.get(key)!
  const results = await $fetch<{ lat: string; lon: string; display_name: string; name?: string }[]>('https://nominatim.openstreetmap.org/search', {
    query: { q, format: 'jsonv2', countrycodes: 'ie', limit: 1 },
    headers: { 'User-Agent': UA },
    timeout: 6000,
  }).catch(() => [])
  const hit = results[0]
  const value = hit
    ? { location: { lng: Number(hit.lon), lat: Number(hit.lat) }, label: [hit.name || hit.display_name.split(',')[0], hit.display_name.split(',')[1]].filter(Boolean).map(x => x!.trim()).filter((x, i, a) => a.indexOf(x) === i).join(', ') }
    : null
  geocodeCache.set(key, value)
  return value
}

async function route(profile: string, from: LngLat, to: LngLat) {
  const url = `https://routing.openstreetmap.de/${profile}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}`
  const res = await $fetch<{ code: string; routes?: { distance: number; duration: number }[] }>(url, {
    query: { overview: 'false' }, headers: { 'User-Agent': UA }, timeout: 7000,
  }).catch(() => null)
  const r = res?.code === 'Ok' ? res.routes?.[0] : undefined
  return r ? { distance_m: Math.round(r.distance), duration_s: Math.round(r.duration) } : null
}

/** Rough door-to-door public transport time: walk to/from stops + wait + in-vehicle at urban bus/Luas speed. */
function transitEstimate(drive: { distance_m: number }): CommuteOption | null {
  const km = drive.distance_m / 1000
  if (km < 1.5) return null // walking is quicker than waiting
  const minutes = 8 + 6 + (km / 17) * 60
  return { mode: 'transit', distance_m: drive.distance_m, duration_s: Math.round(minutes * 60), basis: 'estimate' }
}

export default defineEventHandler(async (event): Promise<CommuteResponse | ReturnType<typeof apiError>> => {
  const query = getQuery(event)
  const from = parsePoint(query.from)
  if (!from) return apiError(event, 400, 'VALIDATION', 'from must be lng,lat')

  let to = parsePoint(query.to) ? { location: parsePoint(query.to)!, label: String(query.label ?? 'Destination') } : null
  if (!to && typeof query.q === 'string' && query.q.trim().length >= 3) to = await geocode(query.q)
  if (!to) return apiError(event, 404, 'DESTINATION_NOT_FOUND', 'We couldn\'t find that place in Ireland. Try a fuller name or an Eircode.')

  const key = `${from.lng.toFixed(5)},${from.lat.toFixed(5)}>${to.location.lng.toFixed(5)},${to.location.lat.toFixed(5)}`
  const cached = routeCache.get(key)
  if (cached) return { ...cached, to }

  const [walk, cycle, drive] = await Promise.all([
    route(PROFILES.walk, from, to.location),
    route(PROFILES.cycle, from, to.location),
    route(PROFILES.drive, from, to.location),
  ])
  const options: CommuteOption[] = []
  if (walk) options.push({ mode: 'walk', ...walk, basis: 'route' })
  if (cycle) options.push({ mode: 'cycle', ...cycle, basis: 'route' })
  const transit = drive ? transitEstimate(drive) : null
  if (transit) options.push(transit)
  if (drive) options.push({ mode: 'drive', ...drive, basis: 'route' })
  if (!options.length) return apiError(event, 502, 'ROUTING_UNAVAILABLE', 'Route times aren\'t available right now. Try Google Maps for directions.')

  const response: CommuteResponse = { from, to, options, attribution: 'Routes: OSRM (FOSSGIS) · Map data © OpenStreetMap contributors' }
  routeCache.set(key, response)
  return response
})

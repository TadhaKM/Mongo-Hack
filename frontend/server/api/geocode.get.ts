import type { GeocodeResponse } from '../../app/types/api'
import { GEOCODE_INDEX } from '../fixtures/data'

// GET /api/geocode?q=
export default defineEventHandler((event): GeocodeResponse | ReturnType<typeof apiError> => {
  const q = String(getQuery(event).q ?? '').trim().toLowerCase()
  if (q.length < 3) return { results: [] }
  if (/\b(london|paris|new york|belfast|uk|england)\b/.test(q))
    return apiError(event, 422, 'OUT_OF_COVERAGE', 'RentCheck currently covers Ireland only.')
  const words = q.split(/[\s,]+/).filter(Boolean)
  const results = GEOCODE_INDEX
    .filter(r => words.every(w => r.label.toLowerCase().includes(w)))
    .slice(0, 6)
  return { results }
})

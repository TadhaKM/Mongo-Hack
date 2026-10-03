import type { ListingsResponse, PropertyType } from '../../../app/types/api'
import { LISTINGS } from '../../fixtures/data'

// GET /api/listings?bbox=minLng,minLat,maxLng,maxLat&bedrooms=&max_rent=&type=
export default defineEventHandler((event): ListingsResponse | ReturnType<typeof apiError> => {
  const q = getQuery(event)
  let items = LISTINGS
  if (typeof q.bbox === 'string') {
    const box = q.bbox.split(',').map(Number)
    if (box.length !== 4 || box.some(n => Number.isNaN(n))) return apiError(event, 400, 'VALIDATION', 'bbox must be minLng,minLat,maxLng,maxLat')
    const [minLng, minLat, maxLng, maxLat] = box as [number, number, number, number]
    items = items.filter(l => l.location.lng >= minLng && l.location.lng <= maxLng && l.location.lat >= minLat && l.location.lat <= maxLat)
  }
  if (q.bedrooms != null && q.bedrooms !== '') {
    const beds = Number(q.bedrooms)
    items = items.filter(l => (beds >= 3 ? l.bedrooms >= beds : l.bedrooms === beds))
  }
  if (q.max_rent != null && q.max_rent !== '') items = items.filter(l => l.rent <= Number(q.max_rent))
  if (typeof q.type === 'string' && q.type) items = items.filter(l => l.property_type === (q.type as PropertyType))
  // Summary shape only: strip the detail fields.
  return {
    items: items.slice(0, 300).map(({ id, rent, bedrooms, property_type, area, location, verdict, diff_pct, is_sample }) =>
      ({ id, rent, bedrooms, property_type, area, location, verdict, diff_pct, is_sample })),
  }
})

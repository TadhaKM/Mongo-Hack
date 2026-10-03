// GET /api/db/query?lng=&lat=&bedrooms=&type=: a LIVE query against the database, returned with the exact pipeline and its timing.
// Finds the nearest rent place that has a recent figure for this size of home, then reads its latest figure and trend.
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const lng = Number(q.lng ?? -6.2546), lat = Number(q.lat ?? 53.3438), bedrooms = Number(q.bedrooms ?? 2)
  const propertyType = String(q.type ?? 'apartment')
  if (![lng, lat, bedrooms].every(Number.isFinite) || lng < -11 || lng > -5 || lat < 51 || lat > 56) throw createError({ statusCode: 400, statusMessage: 'lng/lat must be inside Ireland (longitude first)' })
  const db = await engineDb().catch(() => null)
  if (!db) throw createError({ statusCode: 503, statusMessage: 'Database not connected (MONGODB_URI not set or unreachable).' })

  const cutoff = new Date(); cutoff.setUTCMonth(cutoff.getUTCMonth() - 24)
  const pipeline = [
    { $geoNear: { near: { type: 'Point', coordinates: [lng, lat] }, key: 'centroid', distanceField: 'distM', maxDistance: 30000, spherical: true, query: { level: 'rtb_zone' } } },
    { $limit: 25 },
    { $lookup: { from: 'rental_indexes', let: { id: '$_id' }, as: 'cell', pipeline: [
      { $match: { $expr: { $eq: ['$areaId', '$$id'] }, measure: 'registered_average', propertyType, bedrooms, periodStart: { $gte: cutoff } } },
      { $sort: { periodStart: -1 } }, { $limit: 1 }] } },
    { $match: { 'cell.0': { $exists: true } } },
    { $limit: 1 },
    { $project: { name: 1, distM: { $round: ['$distM', 0] }, cell: { $first: '$cell' } } },
  ]
  const t0 = Date.now()
  const [hit] = await db.collection('areas').aggregate(pipeline).toArray()
  const geoMs = Date.now() - t0
  if (!hit) return { found: false, message: 'No place with a recent figure for that size of home within 30 km.', pipeline, ms: geoMs }
  const t1 = Date.now()
  const series = await db.collection('rental_indexes').find({ areaId: hit._id, measure: 'registered_average', propertyType, bedrooms })
    .sort({ periodStart: -1 }).limit(8).project({ periodLabel: 1, avgRent: 1 }).toArray()
  return {
    found: true, place: hit.name, distanceM: hit.distM, latest: { period: hit.cell.periodLabel, averageRent: hit.cell.avgRent },
    recentQuarters: series.reverse().map(s => ({ period: s.periodLabel, averageRent: s.avgRent })),
    provenance: hit.cell.src, document: hit.cell, pipeline, ms: { nearestPlace: geoMs, trend: Date.now() - t1 },
  }
})

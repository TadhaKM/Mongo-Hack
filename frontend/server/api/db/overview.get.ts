// GET /api/db/overview: what is actually in the database, with every collection's data class (real vs sample).
const COLLECTIONS: { name: string; purpose: string }[] = [
  { name: 'rental_indexes', purpose: 'Official rent averages by place, property type, bedrooms and quarter (CSO / RTB)' },
  { name: 'areas', purpose: 'Places and counties the rent figures belong to, with locations' },
  { name: 'sources', purpose: 'Registry of every dataset: publisher, URL, licence, version, real or sample' },
  { name: 'rental_observations', purpose: 'Individual advertised rents (sample listings)' },
  { name: 'transport_stops', purpose: 'Luas, DART, rail and bus stops' },
  { name: 'planning_applications', purpose: 'Nearby planning applications' },
  { name: 'property_sales', purpose: 'Property price register sales (price context, never rent)' },
  { name: 'area_stats', purpose: 'Vacancy and census-style area statistics' },
  { name: 'analyses', purpose: 'Stored analyses with their evidence' },
  { name: 'query_runs', purpose: 'The exact queries behind every figure (audit trail)' },
  { name: 'analysis_results', purpose: 'Results per analysis and tool' },
]

let cache: { at: number; body: unknown } | null = null

export default defineEventHandler(async () => {
  if (cache && Date.now() - cache.at < 60_000) return cache.body
  let db
  try { db = await engineDb() } catch (e) { return { connected: false, reason: `Could not connect: ${(e as Error).message}` } }
  if (!db) return { connected: false, reason: 'MONGODB_URI is not set on this deployment.' }

  const t0 = Date.now()
  const hello = await db.admin().command({ buildInfo: 1 }).catch(() => ({ version: '?' }))
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name))
  const collections = await Promise.all(COLLECTIONS.map(async (c) => {
    if (!existing.has(c.name)) return { ...c, count: 0, classes: {} as Record<string, number> }
    const col = db.collection(c.name)
    const count = await col.estimatedDocumentCount()
    const classes: Record<string, number> = {}
    if (count && count < 500_000 && c.name !== 'sources' && !['analyses', 'query_runs', 'analysis_results'].includes(c.name)) {
      for (const g of await col.aggregate([{ $group: { _id: { $ifNull: ['$src.dataClass', 'unmarked'] }, n: { $sum: 1 } } }]).toArray()) classes[String(g._id)] = g.n
    }
    return { ...c, count, classes }
  }))
  const sources = existing.has('sources')
    ? (await db.collection('sources').find({}).project({ title: 1, organisation: 1, url: 1, licence: 1, version: 1, dataClass: 1, retrievedAt: 1 }).toArray()).map(s => ({ id: s._id, ...s, _id: undefined }))
    : []
  const sample = existing.has('rental_indexes')
    ? await db.collection('rental_indexes').find({ propertyType: 'apartment', bedrooms: 2, areaLevel: 'rtb_zone' }).sort({ periodStart: -1 }).limit(1).next()
    : null
  const body = {
    connected: true, database: db.databaseName, serverVersion: hello.version, pingMs: Date.now() - t0,
    totals: { documents: collections.reduce((a, c) => a + c.count, 0), collections: collections.filter(c => c.count).length },
    collections, sources, sample,
  }
  cache = { at: Date.now(), body }
  return body
})

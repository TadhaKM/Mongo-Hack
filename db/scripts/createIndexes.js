// Idempotent. Safe to run on every deploy.   node db/scripts/createIndexes.js
// Database: rentcheck_engine (Person 4's API keeps "rentcheck"). See docs/mongodb-schema.md for what each index serves.
import "../lib/env.js";
export const DB_NAME = "rentcheck_engine";

export const INDEXES = {
  sources: [],   // _id is the slug; the collection is tiny

  areas: [
    [{ geometry: "2dsphere", level: 1 }, { name: "geometry_level" }],                 // point-in-polygon ($geoIntersects)
    [{ centroid: "2dsphere", level: 1 }, { name: "centroid_level" }],                 // nearest zones ($geoNear)
    [{ level: 1, code: 1 }, { unique: true, name: "level_code" }],
    [{ "parents.lea": 1 }, { name: "parents_lea" }],                                  // comparable engine: same-LEA small areas
    [{ "parents.electoral_division": 1 }, { name: "parents_ed" }],                    // comparable engine: same-ED small areas
  ],

  // Advertised / registered rents at a point. The comparable engine's main collection.
  rental_observations: [
    [{ geo: "2dsphere", measure: 1, propertyType: 1, bedrooms: 1, observedAt: -1 }, { name: "geo_comparables" }], // $geoNear + query
    [{ areaId: 1, measure: 1, propertyType: 1, bedrooms: 1, observedAt: -1 }, { name: "area_series" }],            // non-geo area queries
    [{ "src.sourceId": 1, "src.recordId": 1 }, { unique: true, name: "source_record" }],                           // idempotent loads
    [{ propertyId: 1, observedAt: -1 }, { sparse: true, name: "property_history" }],                               // re-listing history
  ],

  // Official area-level rent index cells.
  rental_indexes: [
    [{ areaId: 1, measure: 1, propertyType: 1, bedrooms: 1, periodStart: -1 }, { unique: true, name: "series" }],  // latest cell + history
    [{ areaLevel: 1, propertyType: 1, bedrooms: 1, periodStart: -1 }, { name: "level_period" }],                   // rank areas in one period
  ],

  transport_stops: [
    [{ geo: "2dsphere" }, { name: "geo" }],
    [{ modes: 1, geo: "2dsphere" }, { name: "modes_geo" }],
    [{ areaId: 1 }, { name: "areaId" }],
    [{ "src.recordId": 1 }, { unique: true, name: "recordId" }],
  ],

  planning_applications: [
    [{ geo: "2dsphere", applicationDate: -1, status: 1 }, { name: "geo_date_status" }],
    [{ "src.recordId": 1 }, { unique: true, name: "recordId" }],
    [{ areaId: 1, applicationDate: -1 }, { name: "area_date" }],
  ],

  property_sales: [
    [{ geo: "2dsphere", saleDate: -1, fullMarketPrice: 1 }, { name: "geo_date" }],
    [{ areaId: 1, saleDate: -1 }, { name: "area_date" }],
    [{ "src.recordId": 1 }, { unique: true, name: "recordId" }],
  ],

  area_stats: [
    [{ areaId: 1, stat: 1, dimension: 1, periodStart: -1 }, { unique: true, name: "area_stat_period" }],
    [{ stat: 1, areaLevel: 1, periodStart: -1 }, { name: "stat_level_period" }],
  ],

  properties: [
    [{ addressKey: 1 }, { unique: true, name: "addressKey" }],       // get-or-create
    [{ geo: "2dsphere" }, { name: "geo" }],
    [{ areaId: 1 }, { name: "areaId" }],
  ],

  analyses: [
    [{ propertyId: 1, createdAt: -1 }, { name: "property_created" }],
    [{ inputHash: 1, createdAt: -1 }, { name: "input_created" }],    // cache lookup
    // Optional 30-day expiry for demo databases; remove if reports must be kept:
    // [{ createdAt: 1 }, { expireAfterSeconds: 2592000, name: "ttl" }],
  ],
};

export async function createIndexes(db) {
  for (const [coll, specs] of Object.entries(INDEXES)) {
    for (const [keys, opts] of specs) await db.collection(coll).createIndex(keys, opts);
  }
}

if (process.argv[1]?.endsWith("createIndexes.js")) {
  const { MongoClient } = await import("mongodb");
  const { applyValidators } = await import("../schemas/validators.js");
  const client = await MongoClient.connect(process.env.MONGODB_URI ?? "mongodb://localhost:27017");
  const db = client.db(process.env.MONGODB_DB ?? DB_NAME);
  await applyValidators(db);
  await createIndexes(db);
  console.log("validators and indexes applied to", db.databaseName);
  await client.close();
}

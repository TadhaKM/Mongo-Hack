// Copies Person 4's ingested data (database "rentcheck", their schema) into this schema (database "rentcheck_engine"),
// so the geospatial and rent tools in db/tools run on the same real data as the live API.
//
//   npm run db:sync      BACKEND_MONGODB_URI / BACKEND_MONGODB_DB  = source (default: MONGODB_URI, "rentcheck")
//                        MONGODB_URI / MONGODB_DB                  = target (default: localhost, "rentcheck_engine")
//
// Idempotent: every write is an upsert on the target's natural key. Rows that cannot be represented faithfully are
// skipped and counted in the returned report, never guessed. Not synced, on purpose:
//   property_sales  Person 4's PPR rows have no coordinates and no "not full market price" flag (both required here)
//   properties, analyses  runtime data; each side writes its own
//   rental_observations  Person 4 has no listing-level rents, so the comparable engine reports "none"
import "../lib/env.js";
import { point } from "../lib/geo.js";
import { DB_NAME, createIndexes } from "./createIndexes.js";
import { applyValidators } from "../schemas/validators.js";

// Person 4 boundary collection -> this schema's area level and id prefix.
const BOUNDARIES = [
  ["small_areas", "small_area", "sa"],
  ["electoral_divisions", "electoral_division", "ed"],
  ["local_electoral_areas", "lea", "lea"],
  ["local_authorities", "local_authority", "la"],
  ["counties", "county", "county"],
  ["rtb_areas", "rtb_zone", "rtbzone"],
];
const PARENT_LEVELS = BOUNDARIES.slice(1).map(([, level]) => level);
// sourceIds the db tools cite by name (db/tools/*.js), keyed by the Person 4 collection they come from.
const SOURCE_IDS = { rent_index: "rtb_rent_index", transport_stops: "nta_gtfs", planning_applications: "planning_national",
  census_saps: "cso_saps_2022", vacancy: "cso_vacancy" };
const MODES = { tram: "luas", bus: "bus", rail: "rail" };   // GTFS route_type labels from Person 4's importer
const PROPERTY_TYPES = new Set(["apartment", "house", "detached", "semi_detached", "terraced", "studio"]);
const CENSUS_KEYS = {   // same aliases the agents accept (agents/rentcheck_agents/investigators/location.py)
  population: ["population_total", "total_population", "t1_1agett"],
  households: ["households_total", "total_households", "private_households"],
  renterPct: ["private_rented_pct", "rented_private_pct", "pct_private_rented"],
  carAvailablePct: ["car_available_pct", "pct_car_available"],
};

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const firstNum = (obj, keys) => {
  const norm = Object.fromEntries(Object.entries(obj ?? {}).map(([k, v]) => [slug(k), v]));
  for (const k of keys) if (num(norm[k]) != null) return num(norm[k]);
  return null;
};

/** ISO strings, dd/mm/yyyy, BSON dates and ArcGIS epoch milliseconds -> Date (UTC), or null. */
export function parseDate(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "number") return new Date(v > 1e11 ? v : v * 1000);
  const s = String(v).trim();
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  const d = dmy ? new Date(Date.UTC(+dmy[3], +dmy[2] - 1, +dmy[1])) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function propertyType(v) {
  const t = slug(v ?? "").replace(/^semi_detached_house$/, "semi_detached").replace(/^terrace(d)?(_house)?$/, "terraced");
  if (!t || t.startsWith("all")) return "all";
  return PROPERTY_TYPES.has(t) ? t : "unknown";
}

export function planningStatus(decision, status) {
  const d = String(decision ?? "").toLowerCase(), s = String(status ?? "").toLowerCase();
  if (/refus|reject/.test(d)) return "refused";
  if (/grant|conditional|approv|permit/.test(d)) return "granted";
  if (/withdraw/.test(d + s)) return "withdrawn";
  if (/invalid/.test(d + s)) return "invalid";
  if (/appeal/.test(d + s)) return "appealed";
  if (!d && !/decided|decision made|final/.test(s)) return "pending";
  return "unknown";
}

/** Vertex mean of the largest outer ring. Good enough for "nearest zone"; parents fall back to the polygon itself. */
function centroid(geometry) {
  const rings = geometry.type === "Polygon" ? [geometry.coordinates[0]] : geometry.coordinates.map((p) => p[0]);
  const ring = rings.reduce((a, b) => (b.length > a.length ? b : a)).slice(0, -1);
  const [x, y] = ring.reduce(([sx, sy], [px, py]) => [sx + px, sy + py], [0, 0]);
  return { type: "Point", coordinates: [x / ring.length, y / ring.length] };
}

/** Spherical polygon area in km2 (same method as turf/area). */
function areaKm2(geometry) {
  const R = 6378137, rad = Math.PI / 180;
  const ring = (c) => {
    let total = 0;
    for (let i = 0; i < c.length - 1; i++) total += (c[i + 1][0] - c[i][0]) * rad * (2 + Math.sin(c[i][1] * rad) + Math.sin(c[i + 1][1] * rad));
    return Math.abs((total * R * R) / 2);
  };
  const poly = (p) => ring(p[0]) - p.slice(1).reduce((a, h) => a + ring(h), 0);
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return Math.round((polys.reduce((a, p) => a + poly(p), 0) / 1e6) * 1000) / 1000;
}

function src(sourceId, recordId, p4Source, now) {
  const retrievedAt = parseDate(p4Source?.retrieved_at) ?? now;
  const version = p4Source?.dataset_date != null ? String(p4Source.dataset_date) : `retrieved-${retrievedAt.toISOString().slice(0, 10)}`;
  return { sourceId, recordId: String(recordId), version, retrievedAt };
}

function validPoint(geo) {
  try { return point(Number(geo?.coordinates?.[0]), Number(geo?.coordinates?.[1])); } catch { return null; }
}

async function pool(items, size, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

/** Read a cursor in chunks so national-scale collections never sit in memory at once. */
async function inChunks(cursor, size, fn) {
  let chunk = [];
  for await (const doc of cursor) {
    chunk.push(doc);
    if (chunk.length === size) { await fn(chunk); chunk = []; }
  }
  if (chunk.length) await fn(chunk);
}

async function write(target, coll, ops, stat) {
  for (let i = 0; i < ops.length; i += 1000) {
    try {
      const r = await target.collection(coll).bulkWrite(ops.slice(i, i + 1000), { ordered: false });
      stat.written += r.upsertedCount + r.matchedCount;
    } catch (e) {
      if (!e.writeErrors) throw e;
      stat.written += (e.result?.upsertedCount ?? 0) + (e.result?.matchedCount ?? 0);
      for (const w of [e.writeErrors].flat()) skip(stat, `rejected by validator/index: ${w.code}`);
    }
  }
}
const skip = (stat, reason) => { stat.skipped[reason] = (stat.skipped[reason] ?? 0) + 1; };
const newStat = () => ({ read: 0, written: 0, skipped: {} });

export async function syncFromBackend(source, target, { now = new Date() } = {}) {
  await applyValidators(target);
  await createIndexes(target);
  const report = {};
  const seenSources = new Map();   // sourceId -> {p4 source subdoc, collections}
  const noteSource = (sourceId, p4Source, coll) => {
    const s = seenSources.get(sourceId) ?? { first: p4Source, collections: new Set() };
    s.collections.add(coll);
    seenSources.set(sourceId, s);
  };

  // ---- areas: every boundary level, then parents for small areas
  const stat = (report.areas = newStat());
  for (const [coll, level, prefix] of BOUNDARIES) {
    const ops = [];
    for await (const b of source.collection(coll).find()) {
      stat.read++;
      // Nearest-place regions around geocoded RIQ02 places: importRiq02.js owns them (it has the place centroid and the county/place split)
      if (b.source?.dataset === "riq02_rtb_areas") { skip(stat, "RIQ02 regions are loaded by db/scripts/importRiq02.js"); continue; }
      if (!b.code || !b.geometry || !["Polygon", "MultiPolygon"].includes(b.geometry.type)) { skip(stat, `${coll}: no code or polygon`); continue; }
      const sourceId = slug(b.source?.dataset ?? "boundaries");
      noteSource(sourceId, b.source, "areas");
      ops.push({ replaceOne: { filter: { _id: `${prefix}:${b.code}` }, upsert: true, replacement: {
        level, code: String(b.code), name: b.name ?? String(b.code), geometry: b.geometry, centroid: centroid(b.geometry),
        areaKm2: areaKm2(b.geometry), src: src(sourceId, b._record_key ?? b.code, b.source, now) } } });
    }
    await write(target, "areas", ops, stat);
  }
  const areas = target.collection("areas");
  const smallAreas = await areas.find({ level: "small_area" }, { projection: { geometry: 1, centroid: 1 } }).toArray();
  await pool(smallAreas, 16, async (sa) => {
    let hits = await areas.find({ level: { $in: PARENT_LEVELS }, geometry: { $geoIntersects: { $geometry: sa.centroid } } }, { projection: { level: 1 } }).toArray();
    if (!hits.length) hits = await areas.find({ level: { $in: PARENT_LEVELS }, geometry: { $geoIntersects: { $geometry: sa.geometry } } }, { projection: { level: 1 } }).toArray();
    const parents = {};
    for (const h of hits) parents[h.level] ??= h._id;
    await areas.updateOne({ _id: sa._id }, { $set: { parents } });
  });

  // point -> small area id, as assigned at load in this schema
  const smallAreaOf = async (geo) => (await areas.findOne({ level: "small_area", geometry: { $geoIntersects: { $geometry: geo } } }, { projection: { _id: 1 } }))?._id;

  // ---- census (embedded on the small area)
  const census = (report.census = newStat());
  for await (const c of source.collection("census_saps").find()) {
    census.read++;
    const values = Object.fromEntries(Object.entries(CENSUS_KEYS).map(([k, keys]) => [k, firstNum(c.values, keys)]).filter(([, v]) => v != null));
    if (!Object.keys(values).length) { skip(census, "no recognised census fields"); continue; }
    const year = num(c.source?.dataset_date) ?? 2022;
    const r = await areas.updateOne({ _id: `sa:${c.small_area_code}`, level: "small_area" }, { $set: { census: { year, ...values } } });
    if (r.matchedCount) { census.written++; noteSource(SOURCE_IDS.census_saps, c.source, "areas"); } else skip(census, "small area boundary not loaded");
  }

  // ---- rental_indexes (one cell per area x type x bedrooms x period; duplicates after type normalisation are skipped)
  const rent = (report.rental_indexes = newStat());
  const cells = new Map();
  for await (const r of source.collection("rent_index").find().sort({ _record_key: 1 })) {
    rent.read++;
    // RIQ02 is the average rent of newly registered tenancies (measure registered_average, place vs county levels), not the
    // standardised index. importRiq02.js loads it with the right measure and ids; syncing it here would mislabel it.
    if (r.source?.dataset === "cso_riq02") { skip(rent, "RIQ02 is loaded by db/scripts/importRiq02.js"); continue; }
    const amount = num(r.rent?.monthly_eur), year = num(r.period?.year), quarter = num(r.period?.quarter);
    if ((r.validation?.status ?? "ok") !== "ok" || !(amount > 0)) { skip(rent, "flagged or missing rent"); continue; }
    if (!r.geography?.code || !year) { skip(rent, "no area code or year"); continue; }
    const beds = num(r.property?.bedrooms);
    if (beds != null && (beds < 0 || !Number.isInteger(beds))) { skip(rent, "invalid bedrooms"); continue; }
    const key = { areaId: `rtbzone:${r.geography.code}`, measure: "index_mean", propertyType: propertyType(r.property?.type),
      bedrooms: beds == null ? null : Math.min(beds, 5), periodStart: new Date(Date.UTC(year, quarter ? (quarter - 1) * 3 : 0, 1)) };
    const id = JSON.stringify(key);
    if (cells.has(id)) { skip(rent, "duplicate cell after property-type normalisation"); continue; }
    const { bedrooms, ...rest } = key;
    cells.set(id, { replaceOne: { filter: key, upsert: true, replacement: {
      ...rest, ...(bedrooms != null && { bedrooms }), areaLevel: "rtb_zone", avgRent: amount,
      periodLabel: quarter ? `${year}Q${quarter}` : String(year), src: src(SOURCE_IDS.rent_index, r._record_key, r.source, now) } } });
    noteSource(SOURCE_IDS.rent_index, r.source, "rental_indexes");
  }
  await write(target, "rental_indexes", [...cells.values()], rent);

  // ---- transport_stops
  const stops = (report.transport_stops = newStat());
  await inChunks(source.collection("transport_stops").find(), 1000, async (chunk) => {
    stops.read += chunk.length;
    const stopOps = [];
    await pool(chunk, 16, async (s) => {
      const geo = validPoint(s.location);
      if (!geo || !s.stop_id) { skip(stops, "no stop_id or location outside Ireland"); return; }
      const modes = [...new Set((s.transport_modes ?? []).map((m) => MODES[m] ?? "other"))];
      const ids = s.route_ids ?? [], details = s.route_details ?? [];
      const routes = details.length === ids.length && details.length
        ? details.map((d, i) => ({ routeId: String(ids[i]), shortName: d.short_name ?? String(ids[i]), ...(d.long_name && { longName: d.long_name }),
          mode: MODES[d.mode] ?? "other", ...(d.agency_id && { agency: d.agency_id }) }))
        : ids.map((id) => ({ routeId: String(id), shortName: String(id), ...(modes.length === 1 && { mode: modes[0] }) }));
      const areaId = await smallAreaOf(geo);
      stopOps.push({ replaceOne: { filter: { _id: `nta:${s.stop_id}` }, upsert: true, replacement: {
        stopId: String(s.stop_id), name: s.name ?? String(s.stop_id), geo, modes, routes, ...(areaId && { areaId }),
        src: src(SOURCE_IDS.transport_stops, s.stop_id, s.source, now) } } });
      noteSource(SOURCE_IDS.transport_stops, s.source, "transport_stops");
    });
    await write(target, "transport_stops", stopOps, stops);
  });

  // ---- planning_applications
  const plan = (report.planning_applications = newStat());
  await inChunks(source.collection("planning_applications").find(), 1000, async (chunk) => {
    plan.read += chunk.length;
    const planOps = [];
    await pool(chunk, 16, async (a) => {
      const geo = validPoint(a.location), applicationDate = parseDate(a.application_date);
      if (!geo) { skip(plan, "no location or outside Ireland"); return; }
      if (!applicationDate) { skip(plan, "no usable application date"); return; }
      const units = num(a.num_residential_units);
      const decisionDate = parseDate(a.decision_date ?? a.raw?.DecisionDate);
      const areaId = await smallAreaOf(geo);
      const recordId = a._record_key ?? `${a.local_authority}|${a.application_ref}`;
      planOps.push({ replaceOne: { filter: { "src.recordId": String(recordId) }, upsert: true, replacement: {
        reference: String(a.application_ref), ...(a.local_authority && { authority: a.local_authority }), geo,
        ...(a.proposal && { proposal: a.proposal }), applicationDate, status: planningStatus(a.decision, a.status),
        ...(a.decision && { decision: { outcome: a.decision, ...(decisionDate && { date: decisionDate }) } }),
        ...(units > 0 && { development: { residentialUnits: Math.round(units) } }), ...(areaId && { areaId }),
        src: src(SOURCE_IDS.planning_applications, recordId, a.source, now) } } });
      noteSource(SOURCE_IDS.planning_applications, a.source, "planning_applications");
    });
    await write(target, "planning_applications", planOps, plan);
  });

  // ---- area_stats: vacancy (Person 4 keys it by small-area code)
  const vac = (report.area_stats = newStat());
  const vacOps = [];
  for await (const v of source.collection("vacancy").find()) {
    vac.read++;
    const values = Object.fromEntries([["vacancyRatePct", ["vacancy_rate_pct", "vacancy_rate"]], ["vacantDwellings", ["vacant_dwellings", "vacant"]],
      ["totalDwellings", ["total_dwellings", "housing_stock", "dwellings"]]].map(([k, keys]) => [k, firstNum(v.values, keys)]).filter(([, x]) => x != null));
    const year = num(v.data_year) ?? num(v.source?.dataset_date);
    if (!v.geography?.code || !year || values.vacancyRatePct == null) { skip(vac, "no area code, year or vacancy rate"); continue; }
    const periodStart = new Date(Date.UTC(year, 0, 1));
    const key = { areaId: `sa:${v.geography.code}`, stat: "vacancy", periodStart };
    vacOps.push({ replaceOne: { filter: key, upsert: true, replacement: {
      ...key, areaLevel: "small_area", periodEnd: periodStart, periodLabel: String(year), values,
      src: src(SOURCE_IDS.vacancy, v._record_key ?? v.geography.code, v.source, now) } } });
    noteSource(SOURCE_IDS.vacancy, v.source, "area_stats");
  }
  await write(target, "area_stats", vacOps, vac);

  // ---- sources: one per sourceId actually used, described from Person 4's per-record source metadata
  const srcOps = [...seenSources].map(([_id, { first, collections }]) => {
    const retrievedAt = parseDate(first?.retrieved_at) ?? now;
    return { replaceOne: { filter: { _id }, upsert: true, replacement: {
      title: first?.dataset ?? _id, ...(first?.organisation && { organisation: first.organisation }), ...(first?.source_url && { url: first.source_url }),
      version: src(_id, "", first, now).version, retrievedAt, recordIdField: "_record_key", collections: [...collections],
      notes: "Synced from Person 4's database by db/scripts/syncFromBackend.js. Licence not recorded at ingestion." } } };
  });
  await write(target, "sources", srcOps, (report.sources = newStat()));
  report.sources.read = srcOps.length;
  return report;
}

if (process.argv[1]?.endsWith("syncFromBackend.js")) {
  const { MongoClient } = await import("mongodb");
  const srcUri = process.env.BACKEND_MONGODB_URI ?? process.env.MONGODB_URI ?? "mongodb://localhost:27017";
  const srcDb = process.env.BACKEND_MONGODB_DB ?? "rentcheck";
  const dstUri = process.env.MONGODB_URI ?? "mongodb://localhost:27017";
  const dstDb = process.env.MONGODB_DB ?? DB_NAME;
  if (srcUri === dstUri && srcDb === dstDb) throw new Error(`Source and target are both ${dstDb}; the two schemas must live in different databases.`);
  const [a, b] = await Promise.all([MongoClient.connect(srcUri), MongoClient.connect(dstUri)]);
  try {
    const report = await syncFromBackend(a.db(srcDb), b.db(dstDb));
    console.log(`synced ${srcDb} -> ${dstDb}\n${JSON.stringify(report, null, 1)}`);
  } finally {
    await Promise.all([a.close(), b.close()]);
  }
}

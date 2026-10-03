// Real data: CSO PxStat RIQ02 "RTB Average Monthly Rent Report" (446 places x 6 property types x bedrooms x 73 quarters).
//
//   node db/scripts/importRiq02.js [--since 2015] [--no-db] [--no-emit]
//
//   1. downloads the cube (cached in data/raw/riq02.json) and reads geocoded place centroids (data/derived/riq02_locations.json)
//   2. loads the ENGINE database (rentcheck_engine):  sources, areas (level rtb_zone), rental_indexes (measure registered_average)
//   3. writes files in the formats the BACKEND's own pipeline already ingests, so both databases hold the same real data:
//        data/derived/riq02_rtb.csv             ->  python scripts/ingest.py rtb --path data/derived/riq02_rtb.csv
//        data/derived/riq02_rtb_areas.geojson   ->  python scripts/ingest.py boundary --path ... --collection rtb_areas
//
// Honest limits: RIQ02 is an average of NEWLY REGISTERED tenancies by place name. It has no sample sizes, ~83% of cells are
// suppressed in the latest quarter, and CSO publishes no coordinates, so place centroids come from geocoding (approximate).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Delaunay } from "d3-delaunay";
import { parseRiq02, quarterOf } from "./riq02Parse.js";

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? dflt : (process.argv[i + 1]?.startsWith("--") || process.argv[i + 1] == null ? true : process.argv[i + 1]); };
const SINCE = +arg("since", 2015);
const RAW = new URL("../../data/raw/riq02.json", import.meta.url);
const LOCS = new URL("../../data/derived/riq02_locations.json", import.meta.url);
const OUT = new URL("../../data/derived/", import.meta.url);
const API = "https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadDataset/RIQ02/JSON-stat/2.0/en";
const SOURCE_ID = "cso_riq02";
const COUNTIES = new Set("carlow cavan clare cork donegal dublin galway kerry kildare kilkenny laois leitrim limerick longford louth mayo meath monaghan offaly roscommon sligo tipperary waterford westmeath wexford wicklow".split(" "));
// RIQ02 mixes levels: "Dublin" is the whole county, "Rialto, Dublin 8" a neighbourhood. They must never be compared as like with like.
export const levelOf = (label) => (COUNTIES.has(clean(label).toLowerCase()) ? "county" : "rtb_zone");
const clean = (s) => s.replace(/\s+,/g, ",").replace(/\s+/g, " ").trim();

const areaIdOf = (l) => `${levelOf(l.label) === "county" ? "county" : "rtbzone"}:riq-${l.code}`;

export async function loadCube() {
  if (!existsSync(RAW)) {
    mkdirSync(new URL("../../data/raw/", import.meta.url), { recursive: true });
    const res = await fetch(API); if (!res.ok) throw new Error(`CSO API ${res.status}`);
    writeFileSync(RAW, Buffer.from(await res.arrayBuffer()));
  }
  return parseRiq02(JSON.parse(readFileSync(RAW, "utf8")));
}

const polyAreaKm2 = (ring) => { // equirectangular shoelace, fine at this scale
  const k = Math.cos((53.4 * Math.PI) / 180) * 111.32, m = 110.57;
  let a = 0; for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return Math.abs(a / 2) * k * m;
};

/** Voronoi cells (nearest-place regions) for the places with reliable data. Distances are made roughly metric by scaling longitude. */
export function voronoiCells(places) {
  const kx = Math.cos((53.4 * Math.PI) / 180);
  const bounds = [-10.8 * kx, 51.3, -5.9 * kx, 55.5];
  const v = Delaunay.from(places.map((p) => [p.lng * kx, p.lat])).voronoi(bounds);
  return places.map((_, i) => { const c = v.cellPolygon(i); return c ? c.map(([x, y]) => [+(x / kx).toFixed(5), +y.toFixed(5)]) : null; });
}

export async function build({ since = SINCE } = {}) {
  const cube = await loadCube();
  const geo = JSON.parse(readFileSync(LOCS, "utf8"));
  const placeOf = (code) => geo[code] && !geo[code].unresolved ? geo[code] : null;

  // "reliable" places: have an all-bedrooms/all-types average in at least 3 of the last 4 quarters. Only these get a Voronoi region.
  const lastQ = cube.quarters.slice(-4).map((q) => q.label);
  const allAll = new Map();
  for (const c of cube.cells) if (c.bedrooms == null && c.propertyType === "all" && lastQ.includes(c.quarter.label)) allAll.set(c.location.code, (allAll.get(c.location.code) ?? 0) + 1);
  const reliable = cube.locations.filter((l) => placeOf(l.code) && levelOf(l.label) === "rtb_zone" && (allAll.get(l.code) ?? 0) >= 3).map((l) => ({ ...l, ...placeOf(l.code) }));
  const cells = voronoiCells(reliable);
  const cellOf = new Map(reliable.map((p, i) => [p.code, cells[i]]));

  const now = new Date(), version = cube.meta.updated?.slice(0, 10) ?? "unknown";
  const src = (recordId) => ({ sourceId: SOURCE_ID, recordId, version, retrievedAt: now });
  const areas = cube.locations.filter((l) => placeOf(l.code)).map((l) => {
    const p = placeOf(l.code), ring = cellOf.get(l.code);
    return {
      _id: areaIdOf(l), level: levelOf(l.label), code: l.code, name: clean(l.label),
      ...(ring && { geometry: { type: "Polygon", coordinates: [ring] }, areaKm2: +polyAreaKm2(ring).toFixed(1) }),
      centroid: { type: "Point", coordinates: [p.lng, p.lat] },
      geoMethod: ring ? "voronoi_of_geocoded_centroid" : "geocoded_centroid",
      geocode: { provider: "nominatim", osmType: p.osmType, osmClass: p.osmClass, displayName: p.displayName },
      src: src(l.code),
    };
  });
  const known = new Set(areas.map((a) => a.code));

  const startYear = since;
  const indexes = [];
  const csv = ["area_code,area_name,average_rent,bedrooms,property_type,year,quarter,record_id"];
  for (const c of cube.cells) {
    if (c.quarter.year < startYear) continue;
    const code = c.location.code, name = clean(c.location.label);
    const rid = `${code}|${c.propertyType}|${c.bedrooms ?? "all"}|${c.quarter.label}`;
    // backend CSV: every place with data (the backend resolves places by polygon, so only reliable ones are reachable)
    csv.push([code, `"${name}"`, c.avgRent, c.bedrooms ?? "", c.propertyType === "terraced" ? "terraced" : c.propertyType === "semi_detached" ? "semi-detached" : c.propertyType, c.quarter.year, c.quarter.quarter, `"${rid}"`].join(","));
    if (!known.has(code)) continue;
    indexes.push({
      areaId: `${levelOf(c.location.label) === "county" ? "county" : "rtbzone"}:riq-${code}`, areaLevel: levelOf(c.location.label), propertyType: c.propertyType,
      ...(c.bedrooms != null && { bedrooms: c.bedrooms }), ...(c.bedroomLabel && { bedroomLabel: c.bedroomLabel }),
      measure: "registered_average", avgRent: c.avgRent, periodStart: c.quarter.start, periodLabel: c.quarter.label, src: src(rid),
    });
  }

  const feature = (a) => ({ type: "Feature", properties: { code: a.code, name: a.name, geoMethod: a.geoMethod, note: "Nearest-place region around a geocoded centroid; approximate, not an official boundary" }, geometry: a.geometry });
  const geojson = { type: "FeatureCollection", features: areas.filter((a) => a.geometry).map(feature) };
  const source = {
    _id: SOURCE_ID, title: "RTB Average Monthly Rent Report (RIQ02)", organisation: "Residential Tenancies Board, published by the Central Statistics Office",
    url: "https://data.cso.ie/table/RIQ02", downloadUrl: API, licence: "CC BY 4.0 (CSO open data)", version, publishedAt: new Date(cube.meta.updated), retrievedAt: now,
    recordIdField: "location|propertyType|bedrooms|quarter", geographyLevel: "rtb_zone and county", collections: ["rental_indexes", "areas"],
    coverage: { from: cube.quarters[0].start, to: cube.quarters.at(-1).start },
    description: "Average monthly rent of newly registered tenancies by place, property type, bedrooms and quarter.",
    notes: "Area averages, not listings. No sample sizes; most cells are suppressed in the latest quarter. Ranges (1 to 2 bed, 1 to 3 bed) are not loaded. CSO publishes no coordinates: place centroids are geocoded with OpenStreetMap Nominatim (c) OpenStreetMap contributors, ODbL, so matching a property to a place is approximate.",
  };
  return { source, areas, indexes, csv: csv.join("\n") + "\n", geojson, stats: { locations: cube.locations.length, geocoded: areas.length, withRegion: geojson.features.length, rentCells: indexes.length, csvRows: csv.length - 1, skippedRanges: cube.skipped.range, version } };
}

if (process.argv[1]?.endsWith("importRiq02.js")) {
  const out = await build();
  console.log("built", out.stats);
  if (!arg("no-emit", false)) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(new URL("riq02_rtb.csv", OUT), out.csv);
    writeFileSync(new URL("riq02_rtb_areas.geojson", OUT), JSON.stringify(out.geojson));
    console.log("wrote data/derived/riq02_rtb.csv and riq02_rtb_areas.geojson (for the backend's ingest.py)");
  }
  if (!arg("no-db", false)) {
    const { MongoClient } = await import("mongodb");
    const { createIndexes } = await import("./createIndexes.js");
    const { applyValidators } = await import("../schemas/validators.js");
    const client = await MongoClient.connect(process.env.MONGODB_URI ?? "mongodb://localhost:27017");
    const db = client.db(process.env.MONGODB_DB ?? "rentcheck_engine");
    await applyValidators(db); await createIndexes(db);
    await db.collection("sources").replaceOne({ _id: out.source._id }, out.source, { upsert: true });
    // replace this dataset release atomically-enough for a demo: delete what this source loaded, then insert
    await db.collection("areas").deleteMany({ "src.sourceId": SOURCE_ID });
    await db.collection("rental_indexes").deleteMany({ "src.sourceId": SOURCE_ID });
    await db.collection("areas").insertMany(out.areas);
    for (let i = 0; i < out.indexes.length; i += 5000) await db.collection("rental_indexes").insertMany(out.indexes.slice(i, i + 5000), { ordered: false });
    console.log(`loaded into ${db.databaseName}: ${out.areas.length} areas, ${out.indexes.length} rental_indexes`);
    await client.close();
  }
}

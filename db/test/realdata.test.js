// Real-data test: the CSO RIQ02 rent cube loaded through the importer into a real mongod, then queried by the engine.
// Skips (exit 0) if data/raw/riq02.json or data/derived/riq02_locations.json are not present.
//   node db/scripts/geocodeRiq02Locations.js   (once)   then   npm run db:test:real
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { build } from "../scripts/importRiq02.js";
import { createIndexes } from "../scripts/createIndexes.js";
import { applyValidators } from "../schemas/validators.js";
import { TOOLS, startAnalysis, callTool } from "../tools/index.js";
import { Ledger } from "../lib/envelope.js";

const raw = new URL("../../data/raw/riq02.json", import.meta.url), locs = new URL("../../data/derived/riq02_locations.json", import.meta.url);
if (!existsSync(raw) || !existsSync(locs)) { console.log("skipped: real data not downloaded/geocoded (see header)"); process.exit(0); }

const cube = JSON.parse(readFileSync(raw, "utf8"));
// independent reader of the JSON-stat cube (does not use riq02Parse.js)
const keys = (d) => (Array.isArray(cube.dimension[d].category.index) ? cube.dimension[d].category.index : Object.keys(cube.dimension[d].category.index));
const [, TD, BD, PD, LD] = cube.id, T = keys(TD), B = keys(BD), P = keys(PD), L = keys(LD);
const rawAt = (q, b, p, l) => cube.value[((T.indexOf(q) * B.length + B.indexOf(b)) * P.length + P.indexOf(p)) * L.length + L.indexOf(l)];

const mongod = await MongoMemoryServer.create({ binary: { version: process.env.MONGOMS_VERSION ?? "7.0.14" } });
const client = await MongoClient.connect(mongod.getUri());
const db = client.db("rentcheck_engine");
let passed = 0;
const check = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; } };
const run = (tool, p) => TOOLS[tool](db, p, new Ledger());

try {
  const out = await build({ since: 2018 });
  console.log("  built", JSON.stringify(out.stats));
  await applyValidators(db); await createIndexes(db);
  await db.collection("sources").insertOne(out.source);
  await db.collection("areas").insertMany(out.areas);
  for (let i = 0; i < out.indexes.length; i += 5000) await db.collection("rental_indexes").insertMany(out.indexes.slice(i, i + 5000));

  assert.equal(await db.collection("rental_indexes").countDocuments(), out.indexes.length);
  passed++; console.log("  ok   all real rental_indexes documents were accepted by the validators and unique index");

  const dublin = "120500";   // CSO location code for "Dublin"
  check("a real value round-trips: Dublin, 2-bed apartment, 2025Q4 equals the CSO cube", () => {
    const expected = rawAt("20254", "02", "04", dublin); assert.ok(expected > 1500, `raw value ${expected}`);
    const doc = out.indexes.find((d) => d.areaId === `county:riq-${dublin}` && d.propertyType === "apartment" && d.bedrooms === 2 && d.periodLabel === "2025Q4");
    assert.equal(doc.avgRent, expected); assert.equal(doc.measure, "registered_average"); assert.equal(doc.src.sourceId, "cso_riq02");
  });
  check("20 random non-null cells all match the raw cube", () => {
    let s = 99, n = 0; const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
    while (n < 20) {
      const d = out.indexes[Math.floor(rnd() * out.indexes.length)];
      const code = d.src.recordId.split("|")[0], q = T.find((t) => cube.dimension[TD].category.label[t] === d.periodLabel);
      const b = d.bedrooms == null ? "-" : { 1: "01", 2: "02", 3: "03", 4: "08" }[d.bedrooms];
      const p = { all: "-", detached: "01", semi_detached: "02", terraced: "03", apartment: "04", other_flat: "05" }[d.propertyType];
      assert.equal(rawAt(q, b, p, code), d.avgRent); n++;
    }
  });

  const bench = await run("benchmarkRent", { rtbZoneId: `county:riq-${dublin}`, propertyType: "apartment", bedrooms: 2, askingRent: 2600 });
  const rawLatest = rawAt("20254", "02", "04", dublin);
  check("benchmark on real data: latest RTB average, difference, band, and the registered-average caveat", () => {
    assert.equal(bench.data.mean, rawLatest); assert.equal(bench.data.measure, "registered_average"); assert.equal(bench.data.periodLabel, "2025Q4");
    assert.equal(bench.data.diffEur, Math.round((2600 - rawLatest) * 100) / 100); assert.ok(["above_average", "well_above_average"].includes(bench.data.band));
    assert.ok(bench.warnings.some((w) => w.includes("newly registered"))); assert.deepEqual(bench.evidence[0].sourceIds, ["cso_riq02"]);
  });

  // a real series with a gap: the trend must not compare against the wrong quarter
  const series = (code, b, p) => T.map((t, i) => ({ t, label: cube.dimension[TD].category.label[t], v: rawAt(t, b, p, code) })).filter((x) => +x.t.slice(0, 4) >= 2021);
  let gapCase = null;
  for (const l of L) { const s = series(l, "02", "04"); const idx = s.findIndex((x, i) => x.v == null && s[i - 1]?.v != null && s.slice(0, i).filter((y) => y.v != null).length > 4); if (idx > 0 && s.slice(idx + 1).filter((y) => y.v != null).length > 6 && out.areas.some((a) => a.code === l)) { gapCase = { l, s, idx, id: out.areas.find((a) => a.code === l)._id }; break; } }
  const t = await run("rentTrend", { rtbZoneId: gapCase.id, propertyType: "apartment", bedrooms: 2, sinceYears: 6 });
  check("trend over a REAL series with suppressed quarters: gaps counted, year-on-year only when both quarters exist", () => {
    const rawPts = gapCase.s.filter((x, i, a) => i >= a.findIndex((y) => y.v != null));   // from first real value
    assert.equal(t.data.gaps, rawPts.filter((x) => x.v == null).length - rawPts.slice(rawPts.map((x) => x.v).lastIndexOf(rawPts.filter((x) => x.v != null).at(-1).v) + 1).length);
    t.data.series.forEach((p) => { if (p.yoyPct != null) { const i = rawPts.findIndex((x) => x.label === p.period); assert.ok(rawPts[i].v != null && rawPts[i - 4].v != null, `${p.period} yoy without both quarters`); } });
    assert.ok(t.data.series.some((p) => p.yoyPct != null) && t.data.series.some((p) => p.rent == null));
  });

  // location -> rent place, using real coordinates
  const trinity = { lng: -6.2546, lat: 53.3438 };   // Trinity College Dublin
  const loc = await run("locateRentArea", { ...trinity, propertyType: "apartment", bedrooms: 2 });
  check("a Dublin city-centre point resolves to a nearby real PLACE (not the county) with data, distance disclosed, with a warning", () => {
    assert.equal(loc.data.method, "nearest_with_data"); assert.equal(loc.data.level, "rtb_zone"); assert.ok(loc.data.zoneId.startsWith("rtbzone:")); assert.ok(loc.data.distM < 8000, `${loc.data.zoneName} ${loc.data.distM} m`);
    assert.ok(/dublin/i.test(loc.data.zoneName) || /dublin/i.test(JSON.stringify(out.areas.find((a) => a._id === loc.data.zoneId).geocode.displayName)));
    assert.ok(loc.warnings[0].includes("approximate"));
  });
  const countyOnly = await run("locateRentArea", { ...trinity, propertyType: "apartment", bedrooms: 2, maxDistanceM: 300 });
  check("when no place is in reach the COUNTY average is used, clearly labelled as a different, coarser level", () => {
    assert.equal(countyOnly.data.level, "county"); assert.ok(countyOnly.data.zoneId.startsWith("county:")); assert.equal(countyOnly.data.countyFallback, true);
    assert.ok(countyOnly.warnings[0].includes("COUNTY-wide")); assert.ok(countyOnly.evidence[0].claim.includes("COUNTY-wide")); assert.equal(countyOnly.evidence[0].context.areaLevel, "county");
  });
  const counties = await run("zoneComparables", { ...trinity, propertyType: "apartment", bedrooms: 2, askingRent: 2600, level: "county", maxDistanceM: 120000 });
  check("comparing counties compares only counties (levels are never mixed)", () => { assert.ok(counties.data.n >= 3); assert.ok(counties.data.zones.every((z) => z.areaId.startsWith("county:"))); });
  const far = await run("locateRentArea", { lng: -10.9, lat: 51.05, propertyType: "apartment", bedrooms: 2 });
  check("a point beyond reach of any place or county (out at sea) returns no match instead of guessing", () => assert.equal(far.data, null));

  const ctx = await run("rentContext", { ...trinity, propertyType: "apartment", bedrooms: 2, askingRent: 2600 });
  check("rentContext: place, benchmark vs asking, 5-year trend and surrounding places in one call, with unique evidence ids", () => {
    assert.ok(ctx.data.benchmark.diffPct != null && ctx.data.trend.n > 8 && ctx.data.surrounding.n >= 3);
    assert.ok(ctx.data.surrounding.zones.every((z) => z.areaId.startsWith("rtbzone:")), "a place is compared with places only");
    const ids = ctx.evidence.map((e) => e.id); assert.equal(new Set(ids).size, ids.length); assert.ok(ids.length >= 6);
    assert.ok(ctx.evidence.every((e) => e.sourceIds.includes("cso_riq02")));
  });

  const comp = await TOOLS.rentalComparables(db, { latitude: trinity.lat, longitude: trinity.lng, bedrooms: 2, propertyType: "apartment", monthlyRent: 2600, floorArea: 60 }, new Ledger());
  check("with no listings loaded the comparable engine says so and still returns the real RTB cross-check", () => {
    assert.equal(comp.data.status, "none"); assert.equal(comp.data.medianRent, null);
    assert.equal(comp.data.history.rtbIndex.zoneMethod, "nearest_with_data"); assert.ok(comp.data.history.rtbIndex.benchmark.band);
    assert.ok(comp.warnings.some((w) => w.includes("nearest published place")));
  });

  // stored analysis + claim verification on real figures
  const { analysisId: aid } = await startAnalysis(db, { address: "Trinity College Dublin", latitude: trinity.lat, longitude: trinity.lng, bedrooms: 2, propertyType: "apartment", monthlyRent: 2600 });
  await callTool(db, aid, "rentContext", { ...trinity, propertyType: "apartment", bedrooms: 2, askingRent: 2600 });
  const stored = await db.collection("analyses").findOne({ _id: aid });
  const ev = stored.evidence.find((e) => (e.claimRaw ?? e.claim).startsWith("Latest RTB average registered rent"));
  const ver = await callTool(db, aid, "verifyClaims", { analysisId: aid, claims: [{ id: ev.id, asserted: ev.value }, { id: ev.id, asserted: ev.value + 100 }] });
  check("real figures are stored as evidence and verifyClaims rejects an altered one", () => assert.deepEqual(ver.data.results.map((r) => r.status), ["verified", "mismatch"]));

  // outputs for the backend's own pipeline
  const lines = out.csv.trim().split("\n");
  check("backend CSV is complete and parseable by the backend importer's column names", () => {
    assert.equal(lines[0], "area_code,area_name,average_rent,bedrooms,property_type,year,quarter,record_id"); assert.equal(lines.length - 1, out.stats.csvRows);
    assert.ok(lines.slice(1).every((l) => l.split(",").length >= 8));
  });
  const withGeom = out.areas.filter((a) => a.geometry);
  check("backend GeoJSON regions are closed polygons, one per reliable place", () => {
    assert.equal(out.geojson.features.length, withGeom.length); assert.ok(withGeom.length > 100);
    for (const f of out.geojson.features) { const r = f.geometry.coordinates[0]; assert.deepEqual(r[0], r.at(-1)); assert.ok(r.length >= 4); }
  });
  let inside = 0;
  for (const a of withGeom) if (await db.collection("areas").findOne({ _id: a._id, geometry: { $geoIntersects: { $geometry: a.centroid } } }, { projection: { _id: 1 } })) inside++;
  check("each region contains its own place centroid (MongoDB $geoIntersects accepts the polygons)", () => assert.equal(inside, withGeom.length, `${inside}/${withGeom.length}`));

  console.log(`\n${passed} checks passed${process.exitCode ? " (with failures above)" : ""}`);
} finally {
  await client.close();
  await mongod.stop();
}

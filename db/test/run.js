// Runs every tool against a real in-memory mongod loaded with synthetic seed data.
// `npm run db:test`   (first run downloads a mongod binary)
// These tests use SYNTHETIC seed data, so they must opt in; the default policy (real_only) would block every result.
process.env.DATA_POLICY = "allow_synthetic";
import assert from "node:assert/strict";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { createIndexes } from "../scripts/createIndexes.js";
import { applyValidators } from "../schemas/validators.js";
import { seed } from "../scripts/seed.js";
import { startAnalysis, callTool, completeAnalysis, TOOLS as TOOLS_DIRECT } from "../tools/index.js";
import { Ledger } from "../lib/envelope.js";

const mongod = await MongoMemoryServer.create({ binary: { version: process.env.MONGOMS_VERSION ?? "7.0.14" } });
const client = await MongoClient.connect(mongod.getUri());
const db = client.db("rentcheck");
let passed = 0;
const check = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; } };
const show = (label, v) => console.log(`\n--- ${label}\n${JSON.stringify(v, null, 1).slice(0, 900)}`);

try {
  await applyValidators(db);
  await createIndexes(db);
  const C = await seed(db);
  const input = { address: "12 Example Rd, Ranelagh", latitude: C.lat, longitude: C.lng, monthlyRent: 2350, bedrooms: 2, propertyType: "apartment", floorArea: 68, analysisDate: new Date().toISOString() };
  const { analysisId: aid, propertyId, property } = await startAnalysis(db, input, { geoMethod: "geocoder", geoConfidence: 0.9 });
  const again = await startAnalysis(db, { ...input, address: "12, Example Rd. Ranelagh" });
  check("same address (different punctuation) reuses the same property", () => { assert.equal(String(again.propertyId), String(propertyId)); assert.equal(property.areaId, "sa:268001001"); assert.equal(property.parents.rtb_zone, "rtbzone:dublin-6"); });
  const here = { lng: C.lng, lat: C.lat };
  const q = { propertyType: "apartment", bedrooms: 2 };

  const loc = await callTool(db, aid, "locateProperty", here);
  check("E locateProperty finds the small area", () => { assert.equal(loc.data.areaId, "sa:268001001"); assert.equal(loc.data.parents.rtb_zone, "rtbzone:dublin-6"); });
  const zone = loc.data.parents.rtb_zone, lea = loc.data.parents.lea;

  const vac = await callTool(db, aid, "vacancyForLocation", here);
  check("vacancy resolves to LEA level (finest available) with warning", () => { assert.equal(vac.data.areaLevel, "lea"); assert.equal(vac.data.vacancyRatePct, 3.1); assert.ok(vac.warnings.length); });

  const tr = await callTool(db, aid, "nearbyTransport", { ...here, radiusM: 500 });
  show("nearbyTransport", tr.data);
  check("A transport within 500 m excludes far stops", () => { assert.equal(tr.data.total.stops, 5); assert.ok(tr.data.total.nearestM < 200); assert.ok(tr.data.total.score > 0); });
  const empty = await TOOLS_DIRECT.nearbyTransport(db, { lng: -9.0, lat: 52.0, radiusM: 500 }, new Ledger());
  check("A transport: no stops in range returns no data and no score (not a made-up score)", () => { assert.equal(empty.data, null); assert.equal(empty.evidence.length, 0); assert.match(empty.warnings[0], /No transport stops/); });
  const ns = await callTool(db, aid, "nearestStops", here);
  check("D nearest stop per mode includes DART beyond 500 m", () => { const m = Object.fromEntries(ns.data.nearestByMode.map((x) => [x.mode, x.distM])); assert.ok(m.luas < 250); assert.ok(m.dart > 500); });

  const pl = await callTool(db, aid, "nearbyPlanning", { ...here, radiusM: 1000, sinceYears: 4 });
  show("nearbyPlanning", pl.data);
  check("B planning within 1 km, date-filtered, units counted", () => {
    assert.equal(pl.data.total, 6); // 3456/24 1010/23 2020/25 3030/22 4040/24 5050/25 ; 6060/21 too old (>4y), 7070/24 far
    assert.equal(pl.data.pipelineUnits, 42 + 12 + 80 + 6);
    assert.equal(pl.data.largest[0].reference, "2020/25"); });

  const sales = await callTool(db, aid, "recentSales", { ...here, radiusM: 1000, sinceYears: 3 });
  check("sales exclude low-confidence and non-market rows", () => { assert.ok(sales.data.overall.n >= 5); assert.ok(sales.data.overall.median > 400000); });

  const bench = await callTool(db, aid, "benchmarkRent", { rtbZoneId: zone, ...q, askingRent: 2350 });
  show("benchmarkRent", bench.data);
  check("2 benchmark computes diff and band", () => { assert.ok(bench.data.diffPct > 5); assert.ok(["above_average", "well_above_average"].includes(bench.data.band)); assert.equal(bench.data.areaMeanCI95.length, 2); });

  const zc = await callTool(db, aid, "zoneComparables", { ...here, ...q, askingRent: 2350 });
  check("3 zone comparables rank across zones", () => { assert.equal(zc.data.n, 5); assert.ok(zc.data.zScore != null); assert.ok(zc.data.zonesCheaper >= 3); });

  const trend = await callTool(db, aid, "rentTrend", { rtbZoneId: zone, ...q, sinceYears: 4 });
  check("4 trend: rising ~1.3%/quarter with YoY", () => { assert.equal(trend.data.direction, "rising"); assert.ok(trend.data.avgQoQ > 1 && trend.data.avgQoQ < 1.6); assert.ok(trend.data.latestYoY > 4 && trend.data.latestYoY < 6.5); });

  const cl = await callTool(db, aid, "comparableListings", { ...here, ...q, radiusM: 2000, askingRent: 2350 });
  show("comparableListings", cl.data.comparables.slice(0, 3));
  const d = cl.data.comparables.map((x) => x.distM);
  check("C/G/H listings within 2 km, each with distance, sorted nearest-first, 1-bed excluded", () => {
    assert.ok(d.every((x, i) => i === 0 || d[i - 1] <= x)); assert.ok(d.every((x) => x <= 2000));
    assert.ok(cl.data.comparables.every((x) => x.deltaVsAskingPct != null)); assert.ok(!cl.data.comparables.some((x) => x.address === "1-bed decoy")); });

  const lm = await callTool(db, aid, "listingMarket", { ...here, ...q, askingRent: 2350, radiusM: 2000 });
  check("8 listing market: median, distribution, percentile", () => { assert.ok(lm.data.stats.median > 2000); assert.ok(lm.data.distribution.length > 2); assert.ok(lm.data.askingRank.atOrBelow > 0); });

  const same = await callTool(db, aid, "rentsInSameArea", { ...here, ...q });
  show("rentsInSameArea", same.data);
  check("F same-area data: index cells by hierarchy, advertised rents by polygon, kept separate", () => { assert.ok(same.data.indexCells.some((x) => x.level === "rtb_zone")); assert.ok(same.data.advertised.inLeaPolygon >= 10); });

  const np = await callTool(db, aid, "neighbourhoodProfile", { areaId: loc.data.areaId });
  show("neighbourhoodProfile", np.data);
  check("10 profile joins five datasets", () => { assert.equal(np.data.stops, 7); assert.ok(np.data.vacancy); assert.ok(np.data.terminations.length === 2); assert.ok(np.data.sales.n > 5); assert.ok(np.data.planning.length >= 3); });

  const risk = await callTool(db, aid, "tenancyRisk", { leaId: lea });
  show("tenancyRisk", risk.data);
  check("11 ranks LEA among 4 (highest = rank 2 behind dublin-3)", () => { assert.equal(risk.data.of, 4); assert.equal(risk.data.rank, 2); assert.equal(risk.data.percentile, 67); });

  await completeAnalysis(db, aid, { areaId: loc.data.areaId });
  const stored = await db.collection("analyses").findOne({ _id: aid });
  check("evidence ids are unique and sequential", () => { const ids = stored.evidence.map((e) => e.id); assert.equal(new Set(ids).size, ids.length); assert.equal(ids[0], "ev1"); assert.ok(stored.evidence.length > 15); });

  // Op 7: tamper with one claim
  const find = (tool, claimStart) => stored.evidence.find((e) => e.tool === tool && (e.claimRaw ?? e.claim).startsWith(claimStart));
  const meanEv = find("benchmarkRent", "Latest RTB mean"), stopsEv = find("nearbyTransport", "Transport stops within");
  const ver = await callTool(db, aid, "verifyClaims", { analysisId: aid, claims: [
    { id: meanEv.id, asserted: meanEv.value, tol: 1 },
    { id: stopsEv.id, asserted: stopsEv.value + 3 },
    { id: "ev999", asserted: 50 },
    { id: find("benchmarkRent", "Asking rent band").id, asserted: stored.evidence.find((e) => (e.claimRaw ?? e.claim).startsWith("Asking rent band")).value }] });
  show("verifyClaims", ver.data);
  check("7 verifyClaims: claims on SYNTHETIC evidence are never verified (even when correct or tampered); unknown ids are flagged", () => {
    const s = Object.fromEntries(ver.data.results.map((r) => [r.id, r.status]));
    assert.equal(s[meanEv.id], "not_real_data"); assert.equal(s[stopsEv.id], "not_real_data"); assert.equal(s.ev999, "no_such_evidence"); assert.equal(ver.data.allVerified, false); });

  const fr = await callTool(db, aid, "evidenceFreshness", { analysisId: aid, levels: ["lea", "rtb_zone"] });
  show("evidenceFreshness", fr.data.items.slice(0, 3));
  check("12 freshness lists only requested levels with age", () => { assert.ok(fr.data.items.length > 0); assert.ok(fr.data.items.every((i) => ["lea", "rtb_zone"].includes(i.areaLevel))); });

  // Index use: every geo query must plan with the 2dsphere index, never a collection scan.
  const planOf = async (coll, pipeline) => JSON.stringify(await db.collection(coll).aggregate(pipeline).explain("queryPlanner"));
  const g = { near: { type: "Point", coordinates: [C.lng, C.lat] }, key: "geo", distanceField: "d", spherical: true };
  for (const [coll, extra] of [["transport_stops", {}], ["planning_applications", {}], ["property_sales", {}], ["rental_observations", { query: { measure: "advertised" } }]]) {
    const p = await planOf(coll, [{ $geoNear: { ...g, maxDistance: 500, ...extra } }]);
    check(`explain: ${coll} $geoNear uses GEO_NEAR_2DSPHERE`, () => assert.ok(p.includes("GEO_NEAR_2DSPHERE"), p.slice(0, 300)));
  }
  const pa = JSON.stringify(await db.collection("areas").find({ level: "small_area", geometry: { $geoIntersects: { $geometry: { type: "Point", coordinates: [C.lng, C.lat] } } } }).explain("queryPlanner"));
  check("explain: areas $geoIntersects uses IXSCAN on geometry_level", () => assert.ok(pa.includes("IXSCAN") && pa.includes("geometry_level"), pa.slice(0, 400)));

  console.log(`\n${passed} checks passed${process.exitCode ? " (with failures above)" : ""}`);
} finally {
  await client.close();
  await mongod.stop();
}

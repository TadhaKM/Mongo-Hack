// Comparable-engine tests against a real mongod. `npm run db:test:comparables`
// These tests use SYNTHETIC seed data, so they must opt in; the default policy (real_only) would block every result.
process.env.DATA_POLICY = "allow_synthetic";
import assert from "node:assert/strict";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { createIndexes } from "../scripts/createIndexes.js";
import { applyValidators } from "../schemas/validators.js";
import { seed } from "../scripts/seed.js";
import { startAnalysis, callTool, getAnalysis, TOOLS } from "../tools/index.js";
import { Ledger } from "../lib/envelope.js";
import { COMP_V1 } from "../config/comparableScoring.js";

const mongod = await MongoMemoryServer.create({ binary: { version: process.env.MONGOMS_VERSION ?? "7.0.14" } });
const client = await MongoClient.connect(mongod.getUri());
const db = client.db("rentcheck");
let passed = 0;
const check = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; } };
// MongoDB $round rounds half to even (2262.5 -> 2262), unlike Math.round
const rhe = (x) => { const f = Math.floor(x), diff = x - f; return diff > 0.5 ? f + 1 : diff < 0.5 ? f : (f % 2 === 0 ? f : f + 1); };
const median = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

try {
  await applyValidators(db);
  await createIndexes(db);
  const C = await seed(db);
  const input = { latitude: C.lat, longitude: C.lng, bedrooms: 2, propertyType: "apartment", monthlyRent: 2350, floorArea: 68, analysisDate: new Date().toISOString() };
  const run = (i) => TOOLS.rentalComparables(db, i, new Ledger());

  const r = await run(input);
  const d = r.data;
  if (process.env.SHOW) console.log(JSON.stringify({ ...d, comparables: d.comparables.slice(0, 2), history: { ...d.history, listingsByMonth: d.history.listingsByMonth.slice(0, 2) } }, null, 1));

  check("returns sufficient status with the headline fields", () => {
    assert.equal(d.status, "sufficient"); assert.ok(d.comparableCount >= 8);
    for (const k of ["medianRent", "averageRent", "minRent", "maxRent", "rentRange", "differenceFromMedian", "percentageDifference", "dateRange", "mostRecent", "coverage"]) assert.ok(d[k] != null, k);
  });
  const rents = d.comparables.map((c) => c.rent);
  check("median/mean/min/max/range match an independent JS calculation on the returned comparables", () => {
    assert.equal(d.comparableCount, rents.length);
    assert.equal(d.medianRent, rhe(median(rents)));
    assert.equal(d.averageRent, rhe(rents.reduce((a, b) => a + b, 0) / rents.length));
    assert.equal(d.minRent, Math.min(...rents)); assert.equal(d.maxRent, Math.max(...rents));
    assert.equal(d.rentRange.spread, d.maxRent - d.minRent);
    assert.equal(d.differenceFromMedian, 2350 - d.medianRent);
    assert.equal(d.percentageDifference, Math.round(((2350 - d.medianRent) / d.medianRent) * 1000) / 10);
  });
  check("scores are in range, sorted descending, and equal the weighted sum of the reported factors", () => {
    const sc = d.comparables.map((c) => c.score);
    assert.ok(sc.every((x, i) => x >= COMP_V1.minScore && x <= 100 && (i === 0 || sc[i - 1] >= x)));
    for (const c of d.comparables) {
      const w = Object.entries(COMP_V1.weights).reduce((a, [k, wt]) => a + wt * c.factors[k], 0);
      assert.ok(Math.abs(w - c.score) <= 0.6, `${c.address}: ${w} vs ${c.score}`); // factors are rounded to 2dp
    }
  });
  check("hard filters: decoy 1-bed excluded; all are 2-bed, flat-compatible, within radius and window", () => {
    assert.ok(!d.comparables.some((c) => c.address === "1-bed decoy"));
    assert.ok(d.comparables.every((c) => c.bedrooms === 2 && ["apartment", "studio"].includes(c.propertyType)));
    const last = d.search.ladder.at(-1);
    assert.ok(d.comparables.every((c) => c.distM <= last.radiusM && c.ageDays <= last.windowDays));
  });
  check("top comparable is very close; mostRecent matches dateRange.to", () => {
    assert.ok(d.comparables[0].factors.distance > 0.9);
    assert.equal(new Date(d.mostRecent.observedAt).getTime(), new Date(d.dateRange.to).getTime());
  });
  check("coverage, monthly history and RTB cross-check present", () => {
    assert.ok(d.coverage.nearestM < 100); assert.ok(d.coverage.byTier.small_area > 0);
    assert.ok(d.history.listingsByMonth.length >= 2); assert.equal(d.history.rtbIndex.trend.direction, "rising"); assert.ok(d.history.rtbIndex.benchmark.band);
  });
  check("evidence covers count, median, mean, min, max, difference; carries refs and sources", () => {
    const claims = r.evidence.map((e) => e.claim).join("|");
    for (const s of ["Comparable listings used", "Median comparable", "Average comparable", "Lowest", "Highest", "Target rent minus", "Target rent versus", "Distance to nearest"]) assert.ok(claims.includes(s), s);
    const med = r.evidence.find((e) => (e.claimRaw ?? e.claim).startsWith("Median comparable"));
    assert.equal(med.value, d.medianRent); assert.equal(med.refs.length, d.comparableCount); assert.deepEqual(med.sourceIds, ["listings"]); assert.equal(med.context.model, "comp-v1");
  });
  const r2 = await run(input);
  check("deterministic: identical input gives identical output", () => assert.deepEqual(JSON.parse(JSON.stringify(r2.data)), JSON.parse(JSON.stringify(r.data))));

  const small = await run({ ...input, floorArea: 40 });
  check("floor area matters: a much smaller target lowers the floor-area factors", () => {
    const f = (x) => x.data.comparables.reduce((a, c) => a + c.factors.floorArea, 0) / x.data.comparables.length;
    assert.ok(f(small) < f(r));
  });
  const noOptional = await run({ ...input, propertyType: undefined, floorArea: undefined, monthlyRent: undefined });
  check("missing optional inputs still work, with warnings and a null target comparison", () => {
    assert.equal(noOptional.data.differenceFromMedian, null); assert.equal(noOptional.data.targetRent, null);
    assert.ok(noOptional.warnings.some((w) => w.includes("No floor area")) && noOptional.warnings.some((w) => w.includes("No property type")));
  });

  const none = await run({ ...input, bedrooms: 4 });
  check("no comparables: status none, statistics null, no invented numbers, evidence says 0", () => {
    assert.equal(none.data.status, "none"); assert.equal(none.data.comparableCount, 0);
    assert.equal(none.data.medianRent, null); assert.equal(none.data.rentRange, null);
    assert.equal(none.data.search.ladder.length, COMP_V1.ladder.length); assert.equal(none.evidence[0].value, 0);
  });

  const near = (dx) => ({ type: "Point", coordinates: [C.lng + dx, C.lat] });
  const mk = (n, bedrooms, amt, dx) => ({ measure: "advertised", areaId: "sa:268001001", propertyType: "apartment", bedrooms,
    rent: { amount: amt, period: "month" }, address: `thin-${bedrooms}-${n}`, geo: near(dx), observedAt: new Date(Date.now() - 864e5 * 3),
    src: { sourceId: "listings", recordId: `thin-${bedrooms}-${n}`, version: "t", retrievedAt: new Date(), ingestedAt: new Date(), transform: "test@1", dataClass: "synthetic", geoConfidence: 0.9 } });
  await db.collection("rental_observations").insertMany([mk(1, 3, 3000, 0.0003), mk(2, 3, 3200, 0.0006)]);
  const two = await run({ ...input, bedrooms: 3 });
  check("2 comparables: status insufficient, comparables listed, statistics withheld", () => {
    assert.equal(two.data.status, "insufficient"); assert.equal(two.data.comparableCount, 2); assert.equal(two.data.comparables.length, 2);
    assert.equal(two.data.medianRent, null); assert.equal(two.data.minRent, null); assert.ok(two.data.withheld); assert.ok(two.warnings.some((w) => w.includes("withheld")));
    assert.ok(!two.evidence.some((e) => (e.claimRaw ?? e.claim).startsWith("Median")));
  });
  await db.collection("rental_observations").insertMany([mk(3, 3, 3100, 0.0009), mk(4, 3, 3300, 0.0012)]);
  const four = await run({ ...input, bedrooms: 3, monthlyRent: 3500 });
  check("4 comparables: status limited, statistics published with low confidence and a caution", () => {
    assert.equal(four.data.status, "limited"); assert.equal(four.data.confidence, "low"); assert.equal(four.data.medianRent, 3150); assert.equal(four.data.differenceFromMedian, 350);
    assert.ok(four.warnings.some((w) => w.includes("indicative")));
  });
  check("thin data walks the whole widening ladder before giving up", () => assert.equal(four.data.search.ladder.length, COMP_V1.ladder.length));

  const away = await run({ ...input, latitude: 53.35, longitude: -6.1 });
  check("location outside loaded areas is flagged, not an error", () => assert.ok(away.warnings.some((w) => w.includes("not inside a loaded small area"))));

  await assert.rejects(() => run({ ...input, latitude: -6.2, longitude: 53.3 }), /outside Ireland/);
  await assert.rejects(() => run({ ...input, bedrooms: 2.5 }), /bedrooms/);
  passed++; console.log("  ok   validation rejects swapped lat/lng and non-integer bedrooms");

  const plan = JSON.stringify(await db.collection("rental_observations").aggregate([{ $geoNear: { near: { type: "Point", coordinates: [C.lng, C.lat] }, key: "geo", distanceField: "d", maxDistance: 1000, spherical: true,
    query: { measure: "advertised", bedrooms: 2, propertyType: { $in: ["apartment", "studio"] }, observedAt: { $gte: new Date(0) } } } }]).explain("queryPlanner"));
  check("explain: comparable search uses GEO_NEAR_2DSPHERE on the compound index", () => assert.ok(plan.includes("GEO_NEAR_2DSPHERE") && plan.includes("geo_comparables")));

  // The generated mongosh script must be valid and give exactly what the engine's own pipeline gives.
  const { sampleScript, SAMPLE } = await import("../scripts/printComparablePipeline.js");
  const { buildComparablePipeline } = await import("../tools/comparables.js");
  const body = sampleScript().split("\n").filter((l) => !l.startsWith("//")).join("\n");
  const viaText = await new Function("db", "ISODate", `return ${body}`)(new Proxy(db, { get: (t, k) => t.collection(k) }), (s) => new Date(s)).toArray();
  const viaCode = await db.collection("rental_observations").aggregate(buildComparablePipeline(SAMPLE)).toArray();
  check("generated mongosh script runs and matches the engine pipeline", () => {
    assert.deepEqual(JSON.parse(JSON.stringify(viaText)), JSON.parse(JSON.stringify(viaCode))); assert.ok(viaText[0].n >= 0 && Array.isArray(viaText[0].selected));
  });

  const { analysisId: aid } = await startAnalysis(db, { ...input, address: "12 Example Rd, Ranelagh" });
  const viaTool = await callTool(db, aid, "rentalComparables", input);
  const stored = await getAnalysis(db, aid);
  check("callTool stores results and evidence on the analysis with unique ids", () => {
    const ids = stored.evidence.map((e) => e.id); assert.equal(new Set(ids).size, ids.length); assert.equal(stored.results.rentalComparables.medianRent, viaTool.data.medianRent);
  });
  const med = stored.evidence.find((e) => (e.claimRaw ?? e.claim).startsWith("Median comparable"));
  const ver = await callTool(db, aid, "verifyClaims", { analysisId: aid, claims: [{ id: med.id, asserted: med.value }, { id: med.id, asserted: med.value + 150 }] });
  check("verifyClaims refuses synthetic evidence whether the number is right or altered", () => assert.deepEqual(ver.data.results.map((x) => x.status), ["not_real_data", "not_real_data"]));   // synthetic seed data can never be verified; tamper detection on real data is in realdata.test.js and provenance.test.js

  // Measurement types cannot be mixed: the database itself rejects the dangerous inserts.
  const base = { areaId: "sa:268001001", propertyType: "apartment", bedrooms: 2, src: { sourceId: "t", recordId: "x", version: "1", retrievedAt: new Date(), ingestedAt: new Date(), transform: "test@1", dataClass: "synthetic" } };
  const rejects = async (coll, doc) => { try { await db.collection(coll).insertOne(doc); return false; } catch (e) { return e.code === 121; } };
  const pt0 = { type: "Point", coordinates: [C.lng, C.lat] };
  const bad = {
    "observation without measure": await rejects("rental_observations", { ...base, rent: { amount: 2000, period: "month" }, geo: pt0, observedAt: new Date() }),
    "observation with measure 'index_mean'": await rejects("rental_observations", { ...base, measure: "index_mean", rent: { amount: 2000, period: "month" }, geo: pt0, observedAt: new Date() }),
    "observation whose rent period is not monthly": await rejects("rental_observations", { ...base, measure: "advertised", rent: { amount: 24000, period: "year" }, geo: pt0, observedAt: new Date() }),
    "index cell carrying a point (looks like an observation)": await rejects("rental_indexes", { ...base, areaLevel: "rtb_zone", measure: "index_mean", avgRent: 2000, geo: pt0, periodStart: new Date(), periodLabel: "2026Q1" }),
    "sale carrying a rent field": await rejects("property_sales", { address: "x", salePrice: 400000, saleDate: new Date(), fullMarketPrice: true, rent: { amount: 2000 }, src: base.src }),
  };
  for (const [name, rejected] of Object.entries(bad)) check(`validator rejects: ${name}`, () => assert.ok(rejected));

  const ev = stored.evidence.find((e) => (e.claimRaw ?? e.claim).startsWith("Median comparable"));
  check("stored evidence carries query parameters, geographic scope, observation period and timestamp", () => {
    assert.equal(ev.queryParameters.bedrooms, 2); assert.equal(ev.geographicScope.level, "point"); assert.equal(ev.geographicScope.radiusM, 1000);
    assert.ok(ev.observationPeriod.windowDays > 0); assert.ok(ev.generatedAt instanceof Date); assert.equal(ev.evidenceType, "rentalComparables");
  });

  console.log(`\n${passed} checks passed${process.exitCode ? " (with failures above)" : ""}`);
} finally {
  await client.close();
  await mongod.stop();
}

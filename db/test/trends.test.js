// Time-series trend tests against a real mongod. `npm run db:test:trends`
// Every expected number is recomputed independently in JS from the same deterministic history.
import assert from "node:assert/strict";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { createIndexes } from "../scripts/createIndexes.js";
import { applyValidators } from "../schemas/validators.js";
import { seed, seedHistory } from "../scripts/seed.js";
import { startAnalysis, callTool, TOOLS } from "../tools/index.js";
import { rebuildObservationSeries, buildTrendPipeline, startOfPeriod, addPeriods } from "../tools/trends.js";
import { TREND_V1 } from "../config/trendConfig.js";
import { Ledger } from "../lib/envelope.js";

const mongod = await MongoMemoryServer.create({ binary: { version: process.env.MONGOMS_VERSION ?? "7.0.14" } });
const client = await MongoClient.connect(mongod.getUri());
const db = client.db("rentcheck");
let passed = 0;
const check = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; } };
const rhe = (x) => { const f = Math.floor(x), d = x - f; return d > 0.5 ? f + 1 : d < 0.5 ? f : (f % 2 === 0 ? f : f + 1); }; // MongoDB $round is half-to-even
const median = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (a, b) => Math.round(((a - b) / b) * 1000) / 10;
const haversineM = (a, b) => { const R = 6378100, rad = Math.PI / 180, dLat = (b[1] - a[1]) * rad, dLng = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
const label = (d, unit) => unit === "quarter" ? `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}` : unit === "year" ? String(d.getUTCFullYear()) : d.toISOString().slice(0, 7);

try {
  await applyValidators(db);
  await createIndexes(db);
  const C = await seed(db);
  const now = new Date();
  await seedHistory(db, now);
  const hist = await db.collection("rental_observations").find().toArray();   // the full system of record, base seed included
  const count = await rebuildObservationSeries(db);
  const run = (input) => TOOLS.rentalTrend(db, { analysisDate: now, ...input }, new Ledger());
  const LEA = { type: "lea", id: "lea:dublin-city-south-east" };

  // Expected series computed straight from the generated documents
  const expected = (filter, unit = "month", periods = 24) => {
    const to = startOfPeriod(now, unit), lag = TREND_V1.units[unit].lag, from = addPeriods(to, unit, -(periods + lag));   // lookback + reported window
    const by = new Map();
    for (const d of hist.filter(filter)) if (d.observedAt >= from && d.observedAt < to) {
      const k = label(startOfPeriod(d.observedAt, unit), unit); (by.get(k) ?? by.set(k, []).get(k)).push(d.rent.amount);
    }
    const pts = [];
    const total = periods + lag;
    for (let i = 0; i < total; i++) {
      const p = addPeriods(from, unit, i), rs = by.get(label(p, unit)) ?? [];
      pts.push({ label: label(p, unit), n: rs.length, sufficient: rs.length >= TREND_V1.minPerBucket, medianRent: rs.length >= 5 ? rhe(median(rs)) : null, avgRent: rs.length >= 5 ? rhe(rs.reduce((a, b) => a + b, 0) / rs.length) : null });
    }
    pts.forEach((p, i) => { const q = pts[i - lag]; p.yoyMedianPct = p.medianRent != null && q?.medianRent != null ? pct(p.medianRent, q.medianRent) : null; p.yoyAvgPct = p.avgRent != null && q?.avgRent != null ? pct(p.avgRent, q.avgRent) : null; });
    return pts.slice(lag);   // only the requested window is reported
  };
  const isMain = (src = "listings") => (d) => d.measure === "advertised" && d.src.sourceId === src && d.bedrooms === 2 && d.propertyType === "apartment" && ["sa:268001001", "sa:268001002"].includes(d.areaId);

  // ---- the collection itself
  const info = (await db.listCollections({ name: "rental_observation_series" }).toArray())[0];
  check("series is a MongoDB time-series collection with timeField, metaField and 1-year custom buckets", () => {
    assert.equal(info.type, "timeseries"); assert.equal(info.options.timeseries.timeField, "observedAt"); assert.equal(info.options.timeseries.metaField, "meta");
    assert.equal(info.options.timeseries.bucketMaxSpanSeconds, 31536000);
  });
  check("series holds exactly the observations (nothing added or lost)", () => assert.equal(count, hist.length));
  const idx = (await db.collection("rental_observation_series").indexes()).map((i) => i.name);
  check("series indexes exist (lea_series, area_series, geo)", () => { for (const n of ["lea_series", "area_series", "geo"]) assert.ok(idx.includes(n), n); });
  const again = await rebuildObservationSeries(db);
  check("rebuild is idempotent", () => assert.equal(again, count));

  // ---- 1/2: monthly median and average, geographic area scope
  const r = await run({ scope: LEA, measure: "advertised", bedrooms: 2, propertyType: "apartment", sourceId: "listings", unit: "month", periods: 24 });
  const s0 = r.data.series[0];
  const exp = expected(isMain());
  check("monthly median and average match an independent calculation for all 24 months", () => {
    assert.equal(r.data.series.length, 1); assert.equal(s0.points.length, 24);
    s0.points.forEach((p, i) => { assert.equal(p.label, exp[i].label); assert.equal(p.n, exp[i].n, p.label); assert.equal(p.medianRent, exp[i].medianRent, `median ${p.label}`); assert.equal(p.avgRent, exp[i].avgRent, `avg ${p.label}`); });
  });
  // ---- 3: year-on-year, gap-safe
  check("year-on-year equals the same month a year earlier, and is null when either month is missing or thin", () => {
    s0.points.forEach((p, i) => { assert.equal(p.yoyMedianPct, exp[i].yoyMedianPct, `yoy median ${p.label}`); assert.equal(p.yoyAvgPct, exp[i].yoyAvgPct, `yoy avg ${p.label}`); });
    const gapIdx = exp.findIndex((p) => p.n === 0), thinIdx = exp.findIndex((p) => p.n > 0 && !p.sufficient);
    assert.ok(gapIdx >= 0 && thinIdx >= 0, "history must contain a gap and a thin month");
    assert.equal(s0.points[gapIdx].medianRent, null); assert.equal(s0.points[thinIdx].medianRent, null); assert.equal(s0.points[thinIdx].n, 2);
    for (const j of [gapIdx, thinIdx]) if (s0.points[j + 12]) assert.equal(s0.points[j + 12].yoyMedianPct, null, `yoy ${s0.points[j + 12].label} must not compare against a missing month`);
    assert.ok(s0.points.slice(12).some((p) => p.yoyMedianPct > 5 && p.yoyMedianPct < 14), "~0.8%/month growth is roughly 10% a year");
  });
  check("summary: latest YoY, total change and direction are consistent with the points", () => {
    assert.equal(s0.direction, "rising"); assert.equal(s0.latestYoYMedianPct, [...s0.points].reverse().find((p) => p.yoyMedianPct != null).yoyMedianPct);
    const suff = s0.points.filter((p) => p.sufficient); assert.equal(s0.totalChangeMedianPct, pct(suff.at(-1).medianRent, suff[0].medianRent)); assert.equal(s0.sufficientPeriods, suff.length);
  });

  // ---- quarterly and yearly
  const rq = await run({ scope: LEA, bedrooms: 2, propertyType: "apartment", sourceId: "listings", unit: "quarter", periods: 8 });
  const eq = expected(isMain(), "quarter", 8);
  check("quarterly trend (YoY = 4 quarters) matches an independent calculation", () => {
    rq.data.series[0].points.forEach((p, i) => { assert.equal(p.label, eq[i].label); assert.equal(p.medianRent, eq[i].medianRent, p.label); assert.equal(p.yoyMedianPct, eq[i].yoyMedianPct, `yoy ${p.label}`); });
    assert.ok(rq.data.series[0].points[7].yoyMedianPct != null);
  });
  const ry = await run({ scope: LEA, bedrooms: 2, propertyType: "apartment", sourceId: "listings", unit: "year", periods: 2 });
  const ey = expected(isMain(), "year", 2);
  check("yearly trend (YoY = 1 year) matches; only 2 periods is flagged as insufficient", () => {
    ry.data.series[0].points.forEach((p, i) => { assert.equal(p.medianRent, ey[i].medianRent); assert.equal(p.yoyMedianPct, ey[i].yoyMedianPct); });
    assert.equal(ry.data.status, "insufficient"); assert.ok(ry.warnings.some((w) => w.includes("unreliable")));
  });
  const incomplete = await run({ scope: LEA, bedrooms: 2, propertyType: "apartment", sourceId: "listings", includeIncompletePeriod: true });
  const lastLabel = label(startOfPeriod(now, "month"), "month");
  check("the current, incomplete month is excluded by default and flagged when included", () => {
    assert.ok(!s0.points.some((p) => p.label === lastLabel)); const last = incomplete.data.series[0].points.at(-1);
    assert.equal(last.label, lastLabel); assert.equal(last.complete, false); assert.ok(incomplete.data.period.incompletePeriodIncluded);
  });

  // ---- 4: trend around a specific property (radius)
  const near = await run({ latitude: C.lat, longitude: C.lng, scope: { type: "radius", radiusM: 1000 }, bedrooms: 2, propertyType: "apartment", sourceId: "listings" });
  const wide = await run({ latitude: C.lat, longitude: C.lng, scope: { type: "radius", radiusM: 4000 }, bedrooms: 2, propertyType: "apartment", sourceId: "listings" });
  const total = (x) => x.data.series[0].records;
  const inRadius = (rad) => hist.filter((d) => isMain()(d) || (d.measure === "advertised" && d.src.sourceId === "listings" && d.bedrooms === 2 && d.propertyType === "apartment"))
    .filter((d) => d.observedAt >= near.data.period.comparisonFrom && d.observedAt < near.data.period.to && haversineM(d.geo.coordinates, [C.lng, C.lat]) <= rad).length;
  check("radius scope: record counts equal an independent great-circle count; 4 km also reaches the cheaper far group", () => {
    assert.equal(total(near), inRadius(1000)); assert.equal(total(wide), inRadius(4000)); assert.ok(total(wide) > total(near));
    const m = (x) => x.data.series[0].points.filter((p) => p.sufficient).at(-1).medianRent; assert.ok(m(wide) < m(near));
  });
  const auto = await run({ latitude: C.lat, longitude: C.lng, scope: { type: "radius" }, bedrooms: 2, propertyType: "apartment", sourceId: "listings" });
  check("radius ladder stops at the smallest radius with enough data and records the search", () => {
    assert.equal(auto.data.scope.radiusM, 1000); assert.equal(auto.data.search.ladder.length, 1); assert.equal(auto.data.geographicScope.level, "point");
  });
  check("around-property trend carries the official quarterly index separately, labelled by its own unit", () => {
    assert.equal(auto.data.officialIndex.unit, "quarter"); assert.equal(auto.data.officialIndex.measure, "index_mean"); assert.equal(auto.data.unit, "month");
    assert.ok(auto.evidence.some((e) => e.tool === "rentTrend") && auto.evidence.some((e) => e.tool === "rentalTrend"));
  });

  // ---- 5: area scopes, never mixed
  const sa1 = await run({ scope: { type: "small_area", id: "sa:268001001" }, bedrooms: 2, propertyType: "apartment", sourceId: "listings" });
  const exp1 = expected((d) => isMain()(d) && d.areaId === "sa:268001001");
  check("small-area scope uses only that area's observations (different from the LEA scope)", () => {
    assert.ok(sa1.data.series[0].records < r.data.series[0].records); assert.equal(sa1.data.geographicScope.level, "small_area");
    sa1.data.series[0].points.forEach((p, i) => { assert.equal(p.n, exp1[i].n); assert.equal(p.medianRent, exp1[i].medianRent); });
  });
  for (const bad of [{ scope: { type: "county", id: "x" } }, { scope: { type: "lea" } }, {}, { scope: { type: "radius" } }])
    await assert.rejects(() => run({ bedrooms: 2, ...bad }), /scope|radius|latitude/);
  passed++; console.log("  ok   scope validation: county level, missing id, missing scope, radius without coordinates");

  // ---- 6/7: bedrooms and property type
  const all = await run({ scope: LEA });
  const keys = all.data.series.map((s) => `${s.key.sourceId}|${s.key.propertyType}|${s.key.bedrooms}`).sort();
  check("without filters every bedroom count / type / source is its own series; nothing is pooled", () => {
    assert.deepEqual(keys, ["listings_b|apartment|2", "listings|apartment|1", "listings|apartment|2", "listings|house|3"].sort());
    assert.ok(all.warnings.some((w) => w.includes("never pooled")));
  });
  const beds1 = await run({ scope: LEA, bedrooms: 1 });
  const expBeds1 = expected((d) => d.measure === "advertised" && d.src.sourceId === "listings" && d.bedrooms === 1 && ["sa:268001001", "sa:268001002"].includes(d.areaId));
  check("bedroom filter returns only that bedroom count, matching an independent calculation", () => {
    assert.equal(beds1.data.series.length, 1); assert.equal(beds1.data.series[0].key.bedrooms, 1);
    beds1.data.series[0].points.forEach((p, i) => assert.equal(p.medianRent, expBeds1[i].medianRent, p.label));
  });
  const houses = await run({ scope: LEA, propertyType: "house" });
  check("property-type filter returns only that type", () => { assert.equal(houses.data.series.length, 1); assert.equal(houses.data.series[0].key.propertyType, "house"); assert.equal(houses.data.series[0].key.bedrooms, 3); });

  // ---- mixing: sources, measures
  const bothSources = await run({ scope: LEA, bedrooms: 2, propertyType: "apartment" });
  const pooled = await run({ scope: LEA, bedrooms: 2, propertyType: "apartment", pool: true });
  check("sources are reported separately by default and differ systematically", () => {
    assert.equal(bothSources.data.series.length, 2); const m = (s) => s.points.filter((p) => p.sufficient).at(-1).medianRent;
    const [a, b] = ["listings", "listings_b"].map((id) => bothSources.data.series.find((s) => s.key.sourceId === id));
    assert.ok(m(b) > m(a) * 1.04); assert.deepEqual(bothSources.data.provenance.sourceIds.sort(), ["listings", "listings_b"]);
  });
  check("pooling needs an explicit request, gives one series with summed counts, and warns", () => {
    assert.equal(pooled.data.series.length, 1); assert.equal(pooled.data.series[0].key.sourceId, "ALL");
    assert.equal(pooled.data.series[0].records, bothSources.data.series[0].records + bothSources.data.series[1].records);
    assert.ok(pooled.warnings.some((w) => w.includes("pooled by request")));
  });
  const registered = await run({ scope: LEA, bedrooms: 2, propertyType: "apartment", measure: "registered" });
  check("registered rents are a separate measure: never in advertised results, and vice versa", () => {
    assert.ok(!bothSources.data.provenance.sourceIds.includes("rtb_registered")); assert.ok(!pooled.data.provenance.sourceIds.includes("rtb_registered"));
    assert.deepEqual(registered.data.provenance.sourceIds, ["rtb_registered"]); assert.equal(registered.data.measure, "registered");
    const m = (x) => x.data.series[0].points.filter((p) => p.sufficient).at(-1).medianRent; assert.ok(m(registered) < m(r));
  });
  await assert.rejects(() => run({ scope: LEA, measure: "all" }), /measure/);
  passed++; console.log("  ok   measure 'all' is rejected");

  // ---- provenance, evidence, no data
  check("provenance: sources, dataset versions, observation dates, retrieval date, record counts and sample record ids", () => {
    const p = r.data.provenance; assert.deepEqual(p.sourceIds, ["listings"]); assert.deepEqual(p.versions, ["hist-seed", "seed"]);
    assert.ok(p.observedFrom <= p.observedTo && p.observedFrom >= r.data.period.comparisonFrom && p.observedTo < r.data.period.to);
    assert.ok(p.retrievedAt instanceof Date); assert.equal(p.records, s0.records); assert.equal(p.systemOfRecord, "rental_observations");
    const pt = s0.points.find((x) => x.sufficient); assert.equal(pt.recordIdSample.length, 3); assert.equal(pt.obsIdSample.length, 3); assert.ok(pt.versions.length >= 1);
  });
  const ev = r.evidence.find((e) => e.claim.startsWith("Median advertised rent"));
  const oid = ev.refs[0].docId;
  const { ObjectId } = await import("mongodb");
  const refDoc = await db.collection("rental_observations").findOne({ _id: ObjectId.createFromHexString(oid) });
  check("evidence cites real source records, scope, measure and period", () => {
    assert.ok(refDoc && refDoc.measure === "advertised");
    assert.equal(ev.context.measure, "advertised"); assert.equal(ev.context.areaLevel, "lea"); assert.equal(ev.context.areaId, LEA.id); assert.equal(ev.context.model, "trend-v1");
    assert.deepEqual(ev.sourceIds, ["listings"]); assert.equal(ev.value, s0.points.filter((p) => p.sufficient).at(-1).medianRent);
    assert.ok(r.evidence.some((e) => e.claim.startsWith("Year-on-year")) && r.evidence.some((e) => e.claim.startsWith("Change in median")));
  });
  const none = await run({ scope: LEA, bedrooms: 4 });
  check("no data: status none, no series, evidence says 0, nothing invented", () => { assert.equal(none.data.status, "none"); assert.equal(none.data.series.length, 0); assert.equal(none.evidence[0].value, 0); });

  // ---- storage through callTool + verification
  const { analysisId: aid } = await startAnalysis(db, { address: "12 Example Rd, Ranelagh", latitude: C.lat, longitude: C.lng, bedrooms: 2, propertyType: "apartment", analysisDate: now.toISOString() });
  const viaTool = await callTool(db, aid, "rentalTrend", { analysisDate: now, scope: LEA, bedrooms: 2, propertyType: "apartment", sourceId: "listings" });
  const stored = await db.collection("analyses").findOne({ _id: aid });
  const sev = stored.evidence.find((e) => e.claim.startsWith("Median advertised rent"));
  const ver = await callTool(db, aid, "verifyClaims", { analysisId: aid, claims: [{ id: sev.id, asserted: sev.value }, { id: sev.id, asserted: sev.value + 100 }] });
  check("stored through callTool with query parameters; verifyClaims accepts the true median and rejects an altered one", () => {
    assert.equal(sev.queryParameters.bedrooms, 2); assert.equal(sev.geographicScope.level, "lea"); assert.ok(sev.observationPeriod.from);
    assert.equal(stored.results.rentalTrend.series.length, viaTool.data.series.length); assert.deepEqual(ver.data.results.map((x) => x.status), ["verified", "mismatch"]);
  });

  // ---- index use on the time-series collection
  const plan = JSON.stringify(await db.collection("rental_observation_series").aggregate(buildTrendPipeline({ measure: "advertised", pool: false, unit: "month", analysisDate: now,
    reportFrom: addPeriods(startOfPeriod(now, "month"), "month", -24), from: addPeriods(startOfPeriod(now, "month"), "month", -36), to: startOfPeriod(now, "month"), scope: { type: "radius", center: { type: "Point", coordinates: [C.lng, C.lat] }, radiusM: 1000 } })).explain("queryPlanner"));
  check("explain: radius trend on the time-series collection is index-driven (no collection scan) with a bucket-level geo filter", () => {
    assert.ok(plan.includes("IXSCAN") && !plan.includes("COLLSCAN") && plan.includes("$_internalBucketGeoWithin"), plan.slice(0, 300)); });

  // ---- the runnable mongosh recipes give exactly what the tool's pipelines give
  const { recipes, toScript } = await import("../scripts/printTrendPipelines.js");
  let ok = true;
  for (const rc of recipes(now)) {
    const body = toScript(rc).split("\n").filter((l) => !l.startsWith("//")).join("\n");
    const viaText = await new Function("db", "ISODate", `return ${body}`)(new Proxy(db, { get: (t, k) => t.collection(k) }), (s) => new Date(s)).toArray();
    const direct = await db.collection("rental_observation_series").aggregate(buildTrendPipeline(rc.params).concat(rc.post)).toArray();
    try { assert.deepEqual(JSON.parse(JSON.stringify(viaText)), JSON.parse(JSON.stringify(direct)), rc.name); assert.ok(direct.length > 0, `${rc.name} returned nothing`); } catch (e) { ok = false; console.log("       " + e.message.slice(0, 200)); }
  }
  check("the 7 generated mongosh recipes run and match the tool's pipelines", () => assert.ok(ok));

  console.log(`\n${passed} checks passed${process.exitCode ? " (with failures above)" : ""}`);
} finally {
  await client.close();
  await mongod.stop();
}

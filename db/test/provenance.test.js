// Evidence, provenance and the synthetic-data guard. `npm run db:test:provenance`
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, ObjectId } from "mongodb";
import { createIndexes } from "../scripts/createIndexes.js";
import { applyValidators } from "../schemas/validators.js";
import { seed } from "../scripts/seed.js";
import { startAnalysis, callTool, runTool, getAnalysis, explainEvidence, reproduceQueryRun, reportReadiness } from "../tools/index.js";
import { createServer } from "../server.js";

delete process.env.DATA_POLICY;   // the default policy is what is under test
const mongod = await MongoMemoryServer.create({ binary: { version: process.env.MONGOMS_VERSION ?? "7.0.14" } });
const client = await MongoClient.connect(mongod.getUri());
const db = client.db("rentcheck_engine");
let passed = 0;
const check = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; } };

try {
  await applyValidators(db); await createIndexes(db);
  const C = await seed(db);
  const here = { lng: C.lng, lat: C.lat };
  const input = { address: "12 Example Rd, Ranelagh", latitude: C.lat, longitude: C.lng, bedrooms: 2, propertyType: "apartment", monthlyRent: 2350, floorArea: 68 };
  const comp = { latitude: C.lat, longitude: C.lng, bedrooms: 2, propertyType: "apartment", monthlyRent: 2350, floorArea: 68 };

  // ---------------------------------------------------------------- the synthetic-data guard
  const blocked = await runTool(db, "nearbyTransport", { ...here, radiusM: 500 });   // default policy: real_only
  check("default policy blocks results built from synthetic data: no figures, a clear reason, the sources named", () => {
    assert.equal(blocked.data, null); assert.deepEqual(blocked.evidence, []); assert.equal(blocked.blocked.dataClass, "synthetic");
    assert.ok(blocked.warnings[0].startsWith("BLOCKED")); assert.ok(blocked.blocked.sources.some((s) => s.sourceId === "nta_gtfs" && s.dataClass === "synthetic"));
    assert.equal(blocked.provenance.publishable, false);
  });
  const run0 = await db.collection("query_runs").findOne({ _id: new ObjectId(blocked.queryId) });
  check("a blocked run is still recorded for audit", () => { assert.equal(run0.status, "blocked"); assert.equal(run0.dataPolicy, "real_only"); assert.ok(run0.queries.length >= 1); });

  const open = await runTool(db, "nearbyTransport", { ...here, radiusM: 500 }, { dataPolicy: "allow_synthetic" });
  check("with allow_synthetic the figures return, but every claim carries the label and nothing is publishable", () => {
    assert.ok(open.data.total.stops > 0);
    for (const e of open.evidence) { assert.ok(e.claim.startsWith("[SYNTHETIC SAMPLE DATA] "), e.claim); assert.equal(e.dataClass, "synthetic"); assert.equal(e.publishable, false); assert.ok(e.claimRaw); }
    assert.ok(open.warnings[0].startsWith("SYNTHETIC SAMPLE DATA")); assert.equal(open.provenance.publishable, false);
  });
  const srcDocs = await db.collection("sources").find().toArray();
  assert.ok(srcDocs.every((s) => s.dataClass === "synthetic" && s.organisation.startsWith("SYNTHETIC SAMPLE") && s.title.includes("SYNTHETIC SAMPLE")));
  let unmarked = 0;
  for (const coll of ["areas", "rental_indexes", "rental_observations", "transport_stops", "planning_applications", "property_sales", "area_stats"]) unmarked += await db.collection(coll).countDocuments({ "src.dataClass": { $ne: "synthetic" } });
  assert.equal(unmarked, 0); passed++; console.log("  ok   every seeded source and record says it is synthetic (0 unmarked)");

  // unmarked or unregistered data is NOT real
  await db.collection("transport_stops").insertMany([
    { _id: "t:unmarked", stopId: "U", name: "Unmarked stop", geo: { type: "Point", coordinates: [C.lng + 0.0005, C.lat] }, modes: ["bus"], routes: [], areaId: "sa:268001001", src: { sourceId: "nta_gtfs", recordId: "U", version: "x", retrievedAt: new Date() } },
    { _id: "t:ghost", stopId: "G", name: "Ghost stop", geo: { type: "Point", coordinates: [C.lng - 0.0005, C.lat] }, modes: ["bus"], routes: [], areaId: "sa:268001001", src: { sourceId: "ghost_feed", recordId: "G", version: "x", retrievedAt: new Date(), dataClass: "real" } },
  ]);
  const mixed = await runTool(db, "nearbyTransport", { ...here, radiusM: 500 }, { dataPolicy: "allow_synthetic" });
  check("a record with no dataClass, or one citing an unregistered source, makes the result UNVERIFIED (default-deny), even if it claims to be real", () => {
    const e = mixed.evidence[0]; assert.equal(e.dataClass, "unknown"); assert.ok(e.claim.startsWith("[UNVERIFIED DATA")); assert.ok(mixed.provenance.unknownSourceIds.includes("ghost_feed"));
  });
  const mixedBlocked = await runTool(db, "nearbyTransport", { ...here, radiusM: 500 });
  check("and under the default policy it is blocked", () => { assert.equal(mixedBlocked.data, null); assert.equal(mixedBlocked.blocked.dataClass, "unknown"); });
  await db.collection("transport_stops").deleteMany({ _id: { $in: ["t:unmarked", "t:ghost"] } });

  // the database itself rejects records that do not declare provenance or class
  const rej = async (coll, doc) => { try { await db.collection(coll).insertOne(doc); return false; } catch (e) { return e.code === 121; } };
  const goodSrc = { sourceId: "listings", recordId: "v1", version: "1", retrievedAt: new Date(), ingestedAt: new Date(), transform: "t@1", dataClass: "synthetic" };
  const obs = (src) => ({ measure: "advertised", rent: { amount: 2000, period: "month" }, bedrooms: 2, propertyType: "apartment", geo: { type: "Point", coordinates: [C.lng, C.lat] }, areaId: "sa:268001001", observedAt: new Date(), src });
  const { dataClass: _d, ...noClass } = goodSrc, { transform: _t, ...noTransform } = goodSrc, { ingestedAt: _i, ...noIngested } = goodSrc;
  assert.ok(await rej("rental_observations", obs(noClass)) && await rej("rental_observations", obs(noTransform)) && await rej("rental_observations", obs(noIngested)));
  assert.ok(await rej("rental_observations", obs({ ...goodSrc, dataClass: "genuine" })));
  passed++; console.log("  ok   validators reject records missing dataClass / transform / ingestedAt, or with an invalid class");
  const base = { title: "T", organisation: "O", version: "1", retrievedAt: new Date() };
  assert.ok(await rej("sources", { _id: "x1", ...base, dataClass: "real" }) && await rej("sources", { _id: "x2", ...base }) && !(await rej("sources", { _id: "x3", ...base, dataClass: "real", url: "https://e.org", licence: "CC BY 4.0" })));
  passed++; console.log("  ok   sources: a real source without URL + licence is rejected, a missing dataClass is rejected, a complete real source is accepted");

  // ---------------------------------------------------------------- an analysis: results, evidence, roll-up
  const { analysisId: aid } = await startAnalysis(db, input, {}, { dataPolicy: "allow_synthetic" });
  const rc = await callTool(db, aid, "rentalComparables", comp);
  await callTool(db, aid, "nearbyTransport", { ...here, radiusM: 500 });
  const a = await getAnalysis(db, aid);
  const resDoc = await db.collection("analysis_results").findOne({ analysisId: aid, tool: "rentalComparables" });
  assert.ok(resDoc.data.comparableCount > 0 && String(resDoc.queryId) === rc.queryId && resDoc.status === "ok");
  const raw = await db.collection("analyses").findOne({ _id: aid });
  assert.ok(raw.resultRefs.rentalComparables.queryId === rc.queryId && !("results" in raw) && JSON.stringify(raw.resultRefs).length < 2000);
  assert.equal(a.results.rentalComparables.comparableCount, resDoc.data.comparableCount);
  passed++; console.log("  ok   analysis_results holds the data; analyses holds a small index (<2 KB); getAnalysis joins them");
  const ready = await reportReadiness(db, aid);
  check("an analysis built on synthetic data is not publishable, and says why", () => { assert.equal(ready.publishable, false); assert.equal(a.dataClass, "synthetic"); assert.ok(ready.reasons.some((r) => r.includes("synthetic"))); });
  const countEv = a.evidence.find((e) => e.claimRaw?.startsWith("Comparable listings used"));
  const med = a.evidence.find((e) => e.claimRaw?.startsWith("Median comparable"));
  const v = await callTool(db, aid, "verifyClaims", { analysisId: aid, claims: [{ id: med.id, asserted: med.value }] });
  check("verifyClaims refuses to verify a correct number that came from synthetic data", () => { assert.equal(v.data.results[0].status, "not_real_data"); assert.equal(v.data.allVerified, false); });

  const { analysisId: blockedAid } = await startAnalysis(db, input);   // default policy
  await callTool(db, blockedAid, "rentalComparables", comp);
  const ba = await getAnalysis(db, blockedAid), br = await reportReadiness(db, blockedAid);
  check("under the default policy the analysis records the block: no data stored, tool listed as blocked, nothing publishable", () => {
    assert.equal(ba.dataPolicy, "real_only"); assert.equal(ba.results.rentalComparables, null); assert.deepEqual(ba.blockedTools, ["rentalComparables"]);
    assert.equal(ba.resultRefs.rentalComparables.status, "blocked"); assert.equal(br.publishable, false); assert.ok(br.reasons[0].includes("blocked"));
  });

  // ---------------------------------------------------------------- "Why did MongoDB say N comparables?"
  const why = await explainEvidence(db, { analysisId: aid, evidenceId: countEv.id, recordLimit: 500 });
  check("why-trace: the number of source records returned equals the number in the claim", () => {
    assert.equal(why.ok, true); assert.equal(why.records.total, countEv.value); assert.equal(why.records.items.length, countEv.value); assert.equal(why.integrity.allShownRecordsFound, true);
  });
  check("why-trace: every record carries source, original id, observation date, geographic level and id, ingestion date, transform version", () => {
    for (const r of why.records.items) {
      assert.equal(r.collection, "rental_observations"); assert.ok(r.sourceId && r.sourceRecordId && r.sourceVersion);
      assert.ok(r.observationDate instanceof Date); assert.equal(r.geographicLevel, "point"); assert.ok(r.geographicId);
      assert.ok(r.ingestedAt instanceof Date && r.retrievedAt instanceof Date); assert.equal(r.transform, "seed.js@1"); assert.equal(r.dataClass, "synthetic");
      assert.ok(r.record.rent.amount > 0);
    }
  });
  check("why-trace: the recorded query is the real one (geo search, radius, filters) and the steps are readable", () => {
    const q = why.queryRun.queries.find((x) => x.collection === "rental_observations" && x.op === "aggregate");
    const g = q.spec.pipeline[0].$geoNear; assert.ok(g.maxDistance >= 1000); assert.equal(g.query.measure, "advertised"); assert.equal(g.query.bedrooms, 2);
    assert.equal(why.queryRun.tool, "rentalComparables"); assert.equal(why.queryRun.model, "comp-v1"); assert.equal(why.queryRun.params.bedrooms, 2); assert.ok(why.queryRun.engine.version);
    assert.ok(why.answer.some((s) => /within \d+ m of/.test(s))); assert.ok(why.answer.at(-1).includes(`= ${countEv.value}`));
  });
  check("why-trace: the registered sources are included, and the answer states the data class", () => {
    assert.ok(why.sources.some((s) => s.sourceId === "listings" && s.dataClass === "synthetic" && s.organisation.startsWith("SYNTHETIC")));
    assert.equal(why.evidence.dataClass, "synthetic"); assert.deepEqual(why.integrity.recordDataClasses, { synthetic: countEv.value });
  });
  const rep = await reproduceQueryRun(db, rc.queryId);
  check("reproduce: the same tool and parameters on unchanged data give identical figures", () => { assert.equal(rep.reproduced, true); assert.ok(rep.compared >= 8); assert.deepEqual(rep.differences, []); });
  await db.collection("rental_observations").deleteOne({ _id: new ObjectId(why.records.items[0].docId) });
  const rep2 = await reproduceQueryRun(db, rc.queryId);
  check("reproduce: if a cited record has since been removed the difference is detected and reported", () => { assert.equal(rep2.reproduced, false); assert.ok(rep2.differences.length >= 1); });
  const gone = await explainEvidence(db, { analysisId: aid, evidenceId: countEv.id, recordLimit: 500 });
  check("why-trace: a cited record that no longer exists is listed as missing instead of being silently skipped", () => { assert.equal(gone.records.missing.length, 1); assert.equal(gone.integrity.allShownRecordsFound, false); });

  const run = await db.collection("query_runs").findOne({ _id: new ObjectId(rc.queryId) });
  check("query_run stores tool, parameters + hash, policy, class, collections read, source versions, record count, evidence ids, result digest, duration, engine version", () => {
    assert.equal(run.tool, "rentalComparables"); assert.equal(run.paramsHash.length, 64); assert.equal(run.dataPolicy, "allow_synthetic"); assert.equal(run.dataClass, "synthetic");
    assert.ok(run.collections.includes("rental_observations") && run.collections.includes("areas")); assert.equal(run.sourceVersions.listings, "seed");
    assert.equal(run.recordCount, run.recordRefs.length); assert.ok(run.evidenceIds.length >= 8); assert.equal(run.resultDigest.length, 64); assert.ok(run.durationMs >= 0 && run.analysisId.equals(aid));
  });

  // ---------------------------------------------------------------- over HTTP
  const server = createServer(db); await new Promise((r) => server.listen(0, r));
  const base2 = `http://127.0.0.1:${server.address().port}`;
  const get = async (p, o) => { const r = await fetch(base2 + p, o); return { status: r.status, json: await r.json() }; };
  const other = await runTool(db, "nearbyTransport", { ...here }, { dataPolicy: "allow_synthetic" });
  const e1 = await get(`/analyses/${aid}/evidence/${med.id}/explain?recordLimit=3`);
  const rd = await get(`/analyses/${aid}/readiness`);
  const qr = await get(`/query-runs/${other.queryId}`);
  const rp = await get(`/query-runs/${other.queryId}/reproduce`, { method: "POST" });
  const direct = await get("/tools/nearbyTransport", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ params: { ...here } }) });
  check("HTTP: explain, readiness, query run and reproduce are exposed; a direct tool call is blocked by the default policy", () => {
    assert.equal(e1.status, 200); assert.equal(e1.json.records.shown + e1.json.records.missing.length, 3);   // one cited record was deleted above, so it is reported missing assert.equal(rd.json.publishable, false); assert.equal(qr.json.tool, "nearbyTransport");
    assert.equal(rp.json.reproduced, true); assert.equal(direct.json.data, null); assert.ok(direct.json.blocked);
  });
  server.close();

  // ---------------------------------------------------------------- real data passes the same gate (needs the downloaded dataset)
  if (existsSync(new URL("../../data/raw/riq02.json", import.meta.url)) && existsSync(new URL("../../data/derived/riq02_locations.json", import.meta.url))) {
    const { build, loadIntoDb } = await import("../scripts/importRiq02.js");
    const real = client.db("real_engine");
    await loadIntoDb(real, await build({ since: 2023 }));
    const t = { lng: -6.2546, lat: 53.3438, propertyType: "apartment", bedrooms: 2, askingRent: 2600 };
    const r = await runTool(real, "rentContext", t);   // default real_only policy
    check("REAL data passes the default policy: not blocked, class real, publishable, no label on the claims, real sources named", () => {
      assert.ok(r.data); assert.equal(r.provenance.dataClass, "real"); assert.equal(r.provenance.publishable, true);
      assert.ok(r.evidence.length >= 6 && r.evidence.every((e) => e.dataClass === "real" && e.publishable && !e.claim.startsWith("[")));
      assert.ok(r.provenance.sources.some((s) => s.sourceId === "cso_riq02" && s.organisation.includes("Residential Tenancies Board") && s.url.startsWith("https://") && s.licence));
    });
    const { analysisId: rid } = await startAnalysis(real, { address: "Trinity College Dublin", latitude: t.lat, longitude: t.lng, bedrooms: 2, propertyType: "apartment", monthlyRent: 2600 });
    await callTool(real, rid, "rentContext", t);
    const rev = (await getAnalysis(real, rid)).evidence.find((e) => e.claim.startsWith("Latest RTB average registered rent"));
    const vv = await callTool(real, rid, "verifyClaims", { analysisId: rid, claims: [{ id: rev.id, asserted: rev.value }, { id: rev.id, asserted: rev.value + 100 }] });
    const rr = await reportReadiness(real, rid);
    const x = await explainEvidence(real, { analysisId: rid, evidenceId: rev.id });
    check("real analysis: publishable, claims verify, and the trace reaches the CSO record with its ingestion date and transform version", () => {
      assert.equal(rr.publishable, true); assert.deepEqual(vv.data.results.map((x) => x.status), ["verified", "mismatch"]);   // tampering is still caught on real data
      const rec = x.records.items[0]; assert.equal(rec.sourceId, "cso_riq02"); assert.match(rec.sourceRecordId, /^\d+\|/); assert.equal(rec.transform, "importRiq02.js@1.0"); assert.equal(rec.dataClass, "real");
      assert.equal(rec.geographicLevel, "rtb_zone"); assert.ok(rec.ingestedAt instanceof Date && rec.observationDate instanceof Date);
    });
    // the same machinery protects a database that holds both
    await real.collection("areas").insertOne({ _id: "rtbzone:fake", level: "rtb_zone", name: "Fake Place", centroid: { type: "Point", coordinates: [-6.2546, 53.3438] }, src: { sourceId: "cso_riq02", recordId: "fake", version: "x", retrievedAt: new Date() } });
    await real.collection("rental_indexes").insertOne({ areaId: "rtbzone:fake", areaLevel: "rtb_zone", propertyType: "apartment", bedrooms: 2, measure: "registered_average", avgRent: 9999, periodStart: new Date(Date.UTC(2025, 9, 1)), periodLabel: "2025Q4", src: { sourceId: "cso_riq02", recordId: "fake|2025Q4", version: "x", retrievedAt: new Date(), ingestedAt: new Date(), transform: "test@1", dataClass: "test" } });
    const poisoned = await runTool(real, "benchmarkRent", { rtbZoneId: "rtbzone:fake", propertyType: "apartment", bedrooms: 2, askingRent: 2600 });
    check("a single test-class record under a real source name cannot pass as real: record class overrides the registry (blocked)", () => { assert.equal(poisoned.data, null); assert.equal(poisoned.blocked.dataClass, "test"); });
  } else console.log("  skip real-data checks (download data/raw/riq02.json and geocode first)");

  console.log(`\n${passed} checks passed${process.exitCode ? " (with failures above)" : ""}`);
} finally {
  await client.close(); await mongod.stop();
}

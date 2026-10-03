// HTTP gateway tests against a real mongod. `npm run db:test:server`
import assert from "node:assert/strict";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { createIndexes } from "../scripts/createIndexes.js";
import { applyValidators } from "../schemas/validators.js";
import { seed } from "../scripts/seed.js";
import { createServer } from "../server.js";

const mongod = await MongoMemoryServer.create({ binary: { version: process.env.MONGOMS_VERSION ?? "7.0.14" } });
const client = await MongoClient.connect(mongod.getUri());
const db = client.db("rentcheck_engine");
let passed = 0;
const check = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; } };

await applyValidators(db); await createIndexes(db);
const C = await seed(db);
const server = createServer(db);
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (method, path, body) => { const r = await fetch(base + path, { method, headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) }); return { status: r.status, json: await r.json() }; };

try {
  const h = await call("GET", "/health");
  check("health reports the database and the tool list", () => { assert.equal(h.status, 200); assert.equal(h.json.database, "rentcheck_engine"); assert.ok(h.json.tools.includes("rentalComparables") && h.json.tools.includes("rentContext")); });

  const t = await call("POST", "/tools/nearbyTransport", { params: { lng: C.lng, lat: C.lat, radiusM: 500 } });
  check("a tool runs over HTTP and returns the standard envelope with evidence", () => { assert.equal(t.status, 200); assert.equal(t.json.ok, true); assert.equal(t.json.data.total.stops, 5); assert.ok(t.json.evidence.length >= 3 && t.json.evidence[0].id === "ev1"); });

  const a = await call("POST", "/analyses", { input: { address: "12 Example Rd, Ranelagh", latitude: C.lat, longitude: C.lng, bedrooms: 2, propertyType: "apartment", monthlyRent: 2350 } });
  check("an analysis can be started over HTTP", () => { assert.equal(a.status, 201); assert.match(a.json.analysisId, /^[0-9a-f]{24}$/); });
  const c = await call("POST", "/tools/rentalComparables", { analysisId: a.json.analysisId, params: { latitude: C.lat, longitude: C.lng, bedrooms: 2, propertyType: "apartment", monthlyRent: 2350, floorArea: 68 } });
  const stored = await call("GET", `/analyses/${a.json.analysisId}`);
  check("with an analysisId the result and its evidence are stored on the analysis", () => { assert.equal(c.json.data.status, "sufficient"); assert.equal(stored.json.results.rentalComparables.medianRent, c.json.data.medianRent); assert.ok(stored.json.evidence.every((e) => e.queryParameters && e.generatedAt)); });
  const med = stored.json.evidence.find((e) => e.claim.startsWith("Median comparable"));
  const v = await call("POST", "/tools/verifyClaims", { analysisId: a.json.analysisId, params: { analysisId: a.json.analysisId, claims: [{ id: med.id, asserted: med.value }, { id: med.id, asserted: med.value + 50 }] } });
  check("verifyClaims over HTTP accepts the stored number and rejects an altered one", () => assert.deepEqual(v.json.data.results.map((r) => r.status), ["verified", "mismatch"]));

  const bad = await call("POST", "/tools/nearbyTransport", { params: { lng: 53.3, lat: -6.2 } });
  check("bad input (swapped lat/lng) is a 422 with the reason, not a 500", () => { assert.equal(bad.status, 422); assert.match(bad.json.error, /outside Ireland/); });
  const unknown = await call("POST", "/tools/doesNotExist", {});
  check("unknown tool is a 404 that lists the available tools", () => { assert.equal(unknown.status, 404); assert.ok(unknown.json.tools.length > 10); });
  const nf = await call("GET", "/analyses/000000000000000000000000");
  check("missing analysis is a 404", () => assert.equal(nf.status, 404));
  console.log(`\n${passed} checks passed${process.exitCode ? " (with failures above)" : ""}`);
} finally {
  server.close(); await client.close(); await mongod.stop();
}

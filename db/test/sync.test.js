// Sync tests: Person 4-shaped documents (rentcheck_person4_backend/scripts/seed_demo.py and app/ingestion/*) in one
// database, synced into this schema in another, then read back through the db tools.   `npm run db:test:sync`
// These tests use SYNTHETIC seed data, so they must opt in; the default policy (real_only) would block every result.
process.env.DATA_POLICY = "allow_synthetic";
import assert from "node:assert/strict";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { syncFromBackend, parseDate, propertyType, planningStatus } from "../scripts/syncFromBackend.js";
import { startAnalysis, callTool } from "../tools/index.js";

const mongod = await MongoMemoryServer.create({ binary: { version: process.env.MONGOMS_VERSION ?? "7.0.14" } });
const client = await MongoClient.connect(mongod.getUri());
const p4 = client.db("rentcheck"), db = client.db("rentcheck_engine");
let passed = 0;
const check = (name, fn) => { try { fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; } };

const NOW = new Date();
const C = { lng: -6.30, lat: 53.34 };
const square = (lng, lat, dLng, dLat) => ({ type: "Polygon", coordinates: [[[lng - dLng, lat - dLat], [lng + dLng, lat - dLat], [lng + dLng, lat + dLat], [lng - dLng, lat + dLat], [lng - dLng, lat - dLat]]] });
const at = (dLng, dLat) => ({ type: "Point", coordinates: [C.lng + dLng, C.lat + dLat] });
const source = (dataset, extra = {}) => ({ dataset, organisation: "Test org", source_url: `https://example.org/${dataset}`, retrieved_at: NOW, ...extra });
const qBack = (k) => { const q = Math.floor(NOW.getUTCMonth() / 3) - k; const d = new Date(Date.UTC(NOW.getUTCFullYear(), q * 3, 1)); return { year: d.getUTCFullYear(), quarter: Math.floor(d.getUTCMonth() / 3) + 1 }; };

try {
  const bsrc = source("official_boundaries");
  await p4.collection("small_areas").insertMany([
    { _record_key: "b:SA1", code: "SA1", name: "Small area 1", geometry: square(C.lng, C.lat, 0.012, 0.008), source: bsrc },
    { _record_key: "b:SA2", code: "SA2", name: "Small area 2", geometry: square(C.lng + 0.03, C.lat, 0.012, 0.008), source: bsrc },
    { _record_key: "b:bad", code: "BAD", name: "No geometry", source: bsrc },
  ]);
  await p4.collection("electoral_divisions").insertOne({ _record_key: "b:ED1", code: "ED1", name: "ED 1", geometry: square(C.lng, C.lat, 0.02, 0.015), source: bsrc });
  await p4.collection("local_electoral_areas").insertOne({ _record_key: "b:LEA1", code: "LEA1", name: "LEA 1", geometry: square(C.lng + 0.015, C.lat, 0.06, 0.03), source: bsrc });
  await p4.collection("local_authorities").insertOne({ _record_key: "b:DCC", code: "DCC", name: "Dublin City Council", geometry: square(-6.27, 53.35, 0.12, 0.07), source: bsrc });
  await p4.collection("counties").insertOne({ _record_key: "b:D", code: "D", name: "Dublin", geometry: square(-6.27, 53.35, 0.35, 0.25), source: bsrc });
  await p4.collection("rtb_areas").insertOne({ _record_key: "b:RTB1", code: "RTB1", name: "Rental area 1", geometry: square(C.lng, C.lat, 0.03, 0.02), source: bsrc });

  const rsrc = source("rtb_esri_rent_index");
  const rent = [];
  for (let k = 11; k >= 0; k--) {
    const p = qBack(k + 1);   // published with a one-quarter lag
    rent.push({ _record_key: `rent:2bed:${k}`, geography: { code: "RTB1", name: "Rental area 1", type: "rtb_rental_area" }, period: p,
      property: { type: "apartment", bedrooms: 2 }, rent: { monthly_eur: 1900 + 20 * (11 - k), measure: "average" }, validation: { status: "ok", issues: [] }, source: rsrc });
  }
  const p0 = qBack(1);
  rent.push(
    { _record_key: "rent:flagged", geography: { code: "RTB1" }, period: p0, property: { type: "apartment", bedrooms: 1 }, rent: { monthly_eur: null }, validation: { status: "flagged", issues: ["missing_or_invalid_rent"] }, source: rsrc },
    // Person 4's importer folds detached/semi/terraced into "house", so two rows can land on one cell
    { _record_key: "rent:house:a", geography: { code: "RTB1" }, period: p0, property: { type: "house", bedrooms: 3 }, rent: { monthly_eur: 2400 }, validation: { status: "ok" }, source: rsrc },
    { _record_key: "rent:house:b", geography: { code: "RTB1" }, period: p0, property: { type: "house", bedrooms: 3 }, rent: { monthly_eur: 2600 }, validation: { status: "ok" }, source: rsrc },
    { _record_key: "rent:all", geography: { code: "RTB1" }, period: p0, property: { type: null, bedrooms: null }, rent: { monthly_eur: 2000 }, validation: { status: "ok" }, source: rsrc },
    { _record_key: "rent:noarea", geography: { code: null }, period: p0, property: { type: "apartment", bedrooms: 2 }, rent: { monthly_eur: 2000 }, validation: { status: "ok" }, source: rsrc },
  );
  await p4.collection("rent_index").insertMany(rent);
  // Real RIQ02 data is loaded by importRiq02.js with the right measure and ids; the sync must leave it alone (never relabel it as the standardised index)
  await p4.collection("rent_index").insertOne({ _record_key: "riq:1", geography: { code: "110200", name: "Carlow Town" }, period: qBack(1), property: { type: "apartment", bedrooms: 2 }, rent: { monthly_eur: 1500 }, validation: { status: "ok" }, source: source("cso_riq02") });
  await p4.collection("rtb_areas").insertOne({ _record_key: "r:1", code: "110200", name: "Carlow Town", geometry: square(-6.93, 52.84, 0.05, 0.03), source: source("riq02_rtb_areas") });

  const gsrc = source("nta_gtfs");
  await p4.collection("transport_stops").insertMany([
    { _record_key: "nta_gtfs:L1", stop_id: "L1", name: "Luas stop", location: at(-0.0025, -0.0012), transport_modes: ["tram"], route_ids: ["RED"],
      route_details: [{ short_name: "Red", long_name: "Red Line", mode: "tram", agency_id: "LUAS" }], source: gsrc },
    { _record_key: "nta_gtfs:B1", stop_id: "B1", name: "Bus stop", location: at(0.001, 0.001), transport_modes: ["bus"], route_ids: ["40", "140"], source: gsrc },
    { _record_key: "nta_gtfs:X", stop_id: "X", name: "Swapped coordinates", location: { type: "Point", coordinates: [C.lat, C.lng] }, transport_modes: ["bus"], route_ids: [], source: gsrc },
  ]);

  const psrc = source("national_planning_applications");
  const recent = new Date(NOW.getTime() - 200 * 864e5);
  await p4.collection("planning_applications").insertMany([
    { _record_key: "planning:A1", application_ref: "A1", location: at(-0.004, 0.003), application_date: recent.toISOString().slice(0, 10), decision: "Grant permission", status: "Decision made",
      proposal: "Construction of 48 apartments", num_residential_units: 48, local_authority: "Dublin City Council", source: psrc },
    { _record_key: "planning:A2", application_ref: "A2", location: at(0.002, -0.002), application_date: recent.getTime(), decision: null, status: "Further information requested",
      proposal: "Student accommodation, 300 bed spaces", num_residential_units: null, source: psrc },
    { _record_key: "planning:A3", application_ref: "A3", location: at(0.003, 0.001),
      application_date: `${String(recent.getUTCDate()).padStart(2, "0")}/${String(recent.getUTCMonth() + 1).padStart(2, "0")}/${recent.getUTCFullYear()}`,
      decision: "REFUSE PERMISSION", status: "Decided", proposal: "Rear extension", source: psrc },
    { _record_key: "planning:A4", application_ref: "A4", location: at(0.001, 0.001), application_date: "not a date", decision: null, status: null, source: psrc },
  ]);

  await p4.collection("census_saps").insertMany([
    { _record_key: "census:SA1", small_area_code: "SA1", values: { population_total: 520, Households_Total: 210, private_rented_pct: 42.0, car_available_pct: 49.0 }, source: source("census_2022_saps", { dataset_date: 2022 }) },
    { _record_key: "census:SA9", small_area_code: "SA9", values: { population_total: 100 }, source: source("census_2022_saps") },
    { _record_key: "census:SA2", small_area_code: "SA2", values: { T5_1_TOTAL: 99 }, source: source("census_2022_saps") },
  ]);
  await p4.collection("vacancy").insertOne({ _record_key: "cso_fp010:SA1", geography: { code: "SA1" }, values: { vacancy_rate_pct: 6.8 }, data_year: 2022, source: source("cso_fp010", { dataset_date: 2022 }) });

  const report = await syncFromBackend(p4, db);
  const again = await syncFromBackend(p4, db);

  check("helpers: dates, property types, planning status", () => {
    assert.equal(parseDate("14/03/2025").toISOString().slice(0, 10), "2025-03-14");
    assert.equal(parseDate(1741910400000).toISOString().slice(0, 10), "2025-03-14");
    assert.equal(parseDate("2025-03-14").toISOString().slice(0, 10), "2025-03-14");
    assert.equal(parseDate("garbage"), null);
    assert.deepEqual([null, "All property types", "Semi-detached", "Terrace", "apartment", "bungalow"].map(propertyType), ["all", "all", "semi_detached", "terraced", "apartment", "unknown"]);
    assert.deepEqual([["Grant", "Decision made"], ["Refused", null], [null, "New application"], [null, "Decided"], ["Withdrawn", null]].map(([d, s]) => planningStatus(d, s)),
      ["granted", "refused", "pending", "unknown", "withdrawn"]);
  });
  const sa1 = await db.collection("areas").findOne({ _id: "sa:SA1" });
  check("areas: every level synced, bad boundary skipped, small-area parents resolved by polygon", () => {
    assert.equal(report.areas.written, 7);
    assert.equal(report.areas.skipped["RIQ02 regions are loaded by db/scripts/importRiq02.js"], 1);
    assert.equal(report.rental_indexes.skipped["RIQ02 is loaded by db/scripts/importRiq02.js"], 1);
    assert.equal(report.areas.skipped["small_areas: no code or polygon"], 1);
    assert.deepEqual(sa1.parents, { electoral_division: "ed:ED1", lea: "lea:LEA1", local_authority: "la:DCC", county: "county:D", rtb_zone: "rtbzone:RTB1" });
    assert.ok(sa1.areaKm2 > 1 && sa1.areaKm2 < 5, `areaKm2 ${sa1.areaKm2}`);
  });
  check("census: canonical keys (case-insensitive) embedded on the small area; unknown areas and fields skipped", () => {
    assert.deepEqual(sa1.census, { year: 2022, population: 520, households: 210, renterPct: 42, carAvailablePct: 49 });
    assert.equal(report.census.skipped["small area boundary not loaded"], 1);
    assert.equal(report.census.skipped["no recognised census fields"], 1);
  });
  const cells = await db.collection("rental_indexes").find().toArray();
  check("rent: cells pass the validator; flagged, area-less and duplicate rows skipped and counted", () => {
    assert.equal(cells.length, 14);   // 12 quarters + house + all-types
    assert.equal(report.rental_indexes.skipped["flagged or missing rent"], 1);
    assert.equal(report.rental_indexes.skipped["no area code or year"], 1);
    assert.equal(report.rental_indexes.skipped["duplicate cell after property-type normalisation"], 1);
    assert.equal(cells.find((c) => c.propertyType === "house").avgRent, 2400);
    const all = cells.find((c) => c.propertyType === "all");
    assert.ok(!("bedrooms" in all), "all-sizes cell omits bedrooms");
  });
  const counts = Object.fromEntries(await Promise.all(["areas", "rental_indexes", "transport_stops", "planning_applications", "area_stats", "sources"]
    .map(async (c) => [c, await db.collection(c).countDocuments()])));
  check("idempotent: a second sync writes the same documents and creates no duplicates", () => {
    assert.deepEqual(counts, { areas: 7, rental_indexes: 14, transport_stops: 2, planning_applications: 3, area_stats: 1, sources: 6 });
    for (const k of Object.keys(report)) assert.equal(again[k].written, report[k].written, k);
  });

  // ---- the db tools, on synced data
  const input = { address: "25 Example Street, Dublin 8", latitude: C.lat, longitude: C.lng, monthlyRent: 2200, bedrooms: 2, propertyType: "apartment", analysisDate: NOW.toISOString() };
  const { analysisId: aid, property } = await startAnalysis(db, input);
  const here = { lng: C.lng, lat: C.lat };
  const zone = property.parents?.rtb_zone;
  const bench = await callTool(db, aid, "benchmarkRent", { rtbZoneId: zone, propertyType: "apartment", bedrooms: 2, askingRent: 2200 });
  const trend = await callTool(db, aid, "rentTrend", { rtbZoneId: zone, propertyType: "apartment", bedrooms: 2, sinceYears: 3 });
  const tr = await callTool(db, aid, "nearbyTransport", { ...here, radiusM: 500 });
  const pl = await callTool(db, aid, "nearbyPlanning", { ...here, radiusM: 1000 });
  const loc = await callTool(db, aid, "locateProperty", here);
  const vac = await callTool(db, aid, "vacancyForLocation", here);
  const prof = await callTool(db, aid, "neighbourhoodProfile", { areaId: property.areaId });
  check("tools: property resolves to the synced small area and RTB zone", () => { assert.equal(property.areaId, "sa:SA1"); assert.equal(zone, "rtbzone:RTB1"); });
  check("tools: benchmarkRent uses the latest synced cell", () => {
    assert.equal(bench.data.mean, 2120);
    assert.equal(bench.data.periodLabel, `${p0.year}Q${p0.quarter}`);
    assert.equal(bench.data.band, "in_line");
    assert.deepEqual(bench.evidence[0].sourceIds, ["rtb_rent_index"]);
  });
  check("tools: rentTrend sees the synced quarterly series", () => { assert.ok(trend.data.n >= 10, `n=${trend.data.n}`); assert.equal(trend.data.direction, "rising"); });
  check("tools: nearbyTransport maps GTFS tram to luas and drops the swapped-coordinate stop", () => {
    assert.equal(tr.data.total.stops, 2);
    assert.deepEqual(tr.data.byMode.map((m) => m._id).sort(), ["bus", "luas"]);
    assert.equal(report.transport_stops.skipped["no stop_id or location outside Ireland"], 1);
  });
  check("tools: nearbyPlanning counts dated applications and stated units only", () => {
    assert.equal(pl.data.total, 3);
    assert.equal(pl.data.pipelineUnits, 48);
    assert.deepEqual(Object.fromEntries(pl.data.byStatus.map((s) => [s._id, s.n])), { granted: 1, pending: 1, refused: 1 });
    assert.equal(report.planning_applications.skipped["no usable application date"], 1);
  });
  check("tools: locateProperty, vacancy and neighbourhood profile read synced census and vacancy", () => {
    assert.equal(loc.data.census.renterPct, 42);
    assert.equal(vac.data.vacancyRatePct, 6.8);
    assert.equal(vac.data.areaLevel, "small_area");
    assert.equal(prof.data.census.population, 520);
  });
  const srcs = await db.collection("sources").find().toArray();
  check("sources: one per sourceId the tools cite, with Person 4's organisation and URL", () => {
    assert.deepEqual(srcs.map((s) => s._id).sort(), ["cso_saps_2022", "cso_vacancy", "nta_gtfs", "official_boundaries", "planning_national", "rtb_rent_index"]);
    assert.equal(srcs.find((s) => s._id === "rtb_rent_index").url, "https://example.org/rtb_esri_rent_index");
  });
  console.log(`${passed} checks passed`);
} finally {
  await client.close();
  await mongod.stop();
}

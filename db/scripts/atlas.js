// MongoDB Atlas helper.
//   npm run atlas:check     connect, then report which datasets are actually present in the engine and backend databases
//   npm run atlas:setup     create validators + indexes in the engine database and load the real CSO/RTB rent data (RIQ02)
//
// Reads MONGODB_URI from the environment or the git-ignored repo-root .env. Works against Atlas (mongodb+srv://) or a local mongod.
import "../lib/env.js";
import { MongoClient } from "mongodb";
import { build, loadIntoDb } from "./importRiq02.js";

const redact = (uri) => uri.replace(/\/\/([^:@/]+):([^@]+)@/, "//$1:****@");
const ENGINE = process.env.MONGODB_DB ?? "rentcheck_engine", BACKEND = process.env.BACKEND_MONGODB_DB ?? "rentcheck";

export async function connect(uri = process.env.MONGODB_URI) {
  if (!uri) throw new Error("MONGODB_URI is not set. Put your Atlas connection string in the repo-root .env file (see .env.example).");
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  try { await client.connect(); await client.db("admin").command({ ping: 1 }); }
  catch (e) {
    const hint = /ENOTFOUND|querySrv|ECONNREFUSED/.test(e.message) ? "Check the cluster host name in the connection string."
      : /auth/i.test(e.message) ? "Wrong database-user name or password (this is the database user, not your Atlas login)."
      : /ReplicaSetNoPrimary|ServerSelection|timed out/i.test(e.message) ? "Your IP is probably not on the Atlas Network Access list (add your current IP, or 0.0.0.0/0 for a hackathon)."
      : "";
    throw new Error(`Could not connect to ${redact(uri)}: ${e.message}${hint ? `\n  -> ${hint}` : ""}`);
  }
  return client;
}

const count = async (db, name) => ((await db.listCollections({ name }).hasNext()) ? db.collection(name).estimatedDocumentCount() : null);
const line = (ok, label, detail = "") => console.log(`  ${ok === true ? "OK  " : ok === false ? "MISS" : "n/a "} ${label.padEnd(34)} ${detail}`);

export async function check(client) {
  const eng = client.db(ENGINE), be = client.db(BACKEND);
  const version = (await client.db("admin").command({ buildInfo: 1 })).version;
  console.log(`connected (MongoDB server ${version})`);

  console.log(`\nENGINE database "${ENGINE}" (Person 1: computes comparables, trends, geography, evidence)`);
  const real = await eng.collection("rental_indexes").aggregate([
    { $group: { _id: { s: "$src.sourceId", m: "$measure", l: "$areaLevel" }, n: { $sum: 1 }, latest: { $max: "$periodLabel" } } }, { $sort: { n: -1 } },
  ]).toArray().catch(() => []);
  if (!real.length) line(false, "rental_indexes (official rent)", "empty -> run `npm run atlas:setup`");
  for (const r of real) line(true, `rental_indexes ${r._id.s}`, `${r.n.toLocaleString()} rows, ${r._id.m}, ${r._id.l}, latest ${r.latest}`);
  for (const [name, why] of [["areas", "places, counties, census areas"], ["sources", "dataset registry"], ["transport_stops", "NTA / TFI GTFS"],
    ["planning_applications", "National Planning"], ["property_sales", "Property Price Register"],
    ["rental_observations", "listings (needs a licence that allows storage)"], ["area_stats", "vacancy / RTB statistics"], ["analyses", "stored analyses"]]) {
    const n = await count(eng, name);
    line(n == null ? false : n > 0, name, n == null ? `missing (${why})` : `${n.toLocaleString()} docs  (${why})`);
  }

  console.log(`\nBACKEND database "${BACKEND}" (Person 4: API + agents)`);
  for (const [name, why] of [["rent_index", "RTB / CSO rents"], ["rtb_areas", "rent-area regions"], ["transport_stops", "GTFS"],
    ["planning_applications", "planning"], ["property_sales", "PPR"], ["census_saps", "census"], ["vacancy", "vacancy"],
    ["small_areas", "boundaries"], ["properties", "analysed properties"], ["analyses", "analyses"]]) {
    const n = await count(be, name);
    line(n == null ? false : n > 0, name, n == null ? `missing (${why})` : `${n.toLocaleString()} docs  (${why})`);
  }

  // end-to-end proof on whatever real data is there: Trinity College Dublin, 2-bed apartment asking 2,600
  if (real.length) {
    const { TOOLS } = await import("../tools/index.js");
    const { Ledger } = await import("../lib/envelope.js");
    const r = await TOOLS.rentContext(eng, { lng: -6.2546, lat: 53.3438, propertyType: "apartment", bedrooms: 2, askingRent: 2600 }, new Ledger());
    console.log("\nLIVE QUERY on this database: rentContext for Trinity College Dublin, 2-bed apartment, asking EUR 2,600");
    if (!r.data) console.log("  no result:", r.warnings[0]);
    else {
      const b = r.data.benchmark;
      console.log(`  area ${r.data.area.zoneName} (${r.data.area.distM} m), latest ${b?.periodLabel} average EUR ${b?.mean}; asking is ${Math.abs(b?.diffPct)}% ${b?.diffPct >= 0 ? "above" : "below"}; trend ${r.data.trend?.direction}; ${r.evidence.length} evidence items`);
    }
  }
}

export async function setup(client) {
  const db = client.db(ENGINE);
  console.log(`setting up "${ENGINE}": validators, indexes, and the real CSO/RTB rent data (RIQ02)...`);
  const out = await build();
  console.log(`  built ${out.stats.rentCells.toLocaleString()} rent cells for ${out.stats.geocoded} places (CSO version ${out.stats.version})`);
  const loaded = await loadIntoDb(db, out);
  console.log(`  loaded ${loaded.areas} areas and ${loaded.rental_indexes.toLocaleString()} rental_indexes`);
}

if (process.argv[1]?.endsWith("atlas.js")) {
  const cmd = process.argv[2] ?? "check";
  let client;
  try {
    client = await connect();
    if (cmd === "setup") { await setup(client); console.log(""); }
    await check(client);
  } catch (e) { console.error(`\n${e.message}`); process.exitCode = 1; }
  finally { await client?.close(); }
}

// Loads the frontend's SAMPLE datasets (listings, transport stops, planning applications, sales, area statistics) into the
// engine database, so the database is not empty for datasets we have no real files for yet. Every record and the source
// are marked dataClass "synthetic" and named as sample data; the engine will never present them as real.
//
//   npm run db:demo            (uses tsx to read the frontend's TypeScript data module; downloads it on first use)
import "../lib/env.js";
import { MongoClient } from "mongodb";
import { applyValidators } from "../schemas/validators.js";
import { createIndexes } from "./createIndexes.js";
import * as demo from "../../frontend/server/fixtures/data.ts";

const SOURCE_ID = "mend_demo", NOW = new Date(), slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const src = (recordId) => ({ sourceId: SOURCE_ID, recordId: String(recordId), version: "demo-1", retrievedAt: NOW, ingestedAt: NOW, transform: "loadDemoData.js@1", dataClass: "synthetic" });
const pt = (l) => ({ type: "Point", coordinates: [+l.lng.toFixed(5), +l.lat.toFixed(5)] });
const TYPE = { apartment: "apartment", house: "house", duplex: "house", shared_room: "unknown" };

export function build() {
  const listings = demo.LISTINGS.map((l) => ({
    measure: "advertised", rent: { amount: l.rent, period: "month" }, bedrooms: Math.min(l.bedrooms, 5), propertyType: TYPE[l.property_type] ?? "unknown",
    ...(l.floor_area_m2 ? { floorAreaM2: l.floor_area_m2 } : {}), geo: pt(l.location), areaId: `demo:${slug(l.area)}`,
    observedAt: new Date(NOW.getTime() - (1 + (l.id.length % 40)) * 864e5), address: l.address, src: src(l.id),
  }));
  const center = demo.DUBLIN_8_CENTER;
  const transport = demo.transportNear(center, 20000).map((s) => ({
    _id: `demo:${s.id}`, stopId: s.id, name: s.name, geo: pt(s.location), modes: [s.mode],
    routes: s.routes.map((r) => ({ routeId: r, shortName: r, mode: s.mode, agency: "SAMPLE" })), areaId: "demo:dublin_8", src: src(s.id),
  }));
  const planning = demo.planningNear(center).map((p) => ({
    reference: p.reference, authority: "SAMPLE planning authority", geo: pt(p.location), proposal: p.summary, applicationDate: new Date(p.received_date),
    status: p.status, ...(p.decision_date ? { decision: { outcome: p.status === "granted" ? "Grant Permission" : "Refuse Permission", date: new Date(p.decision_date) } } : {}),
    development: { type: "residential", ...(/(\d+)[- ]unit|(\d+) apartments/.exec(p.summary) ? { residentialUnits: +(/(\d+)[- ]unit|(\d+) apartments/.exec(p.summary).slice(1).find(Boolean)) } : {}) },
    areaId: "demo:dublin_8", src: src(p.reference),
  }));
  // sales: one per Dublin 8 sample listing, priced from its rent (price context only, never a rent)
  const sales = demo.LISTINGS.filter((l) => l.area.startsWith("Dublin")).slice(0, 40).map((l, i) => ({
    address: l.address, salePrice: Math.round((l.rent * 12 * 17) / 5000) * 5000, saleDate: new Date(NOW.getTime() - (30 + i * 9) * 864e5),
    fullMarketPrice: true, geo: pt({ lng: l.location.lng + 0.0004, lat: l.location.lat - 0.0003 }), areaId: "demo:dublin_8", src: src(`sale-${l.id}`),
  }));
  const areas = ["Dublin 8", ...demo.COUNTY_TOWNS.map((t) => t.area)];
  const stats = areas.map((area) => {
    const v = demo.areaStats(area).find((s) => s.key === "vacancy_rate");
    return { areaId: `demo:${slug(area)}`, areaLevel: "rtb_zone", stat: "vacancy", periodStart: new Date(Date.UTC(2022, 3, 1)), periodEnd: new Date(Date.UTC(2022, 3, 1)), periodLabel: "2022",
      values: { vacancyRatePct: Math.round(v.value * 1000) / 10 }, src: src(`vacancy-${slug(area)}`) };
  });
  const source = {
    _id: SOURCE_ID, dataClass: "synthetic", title: "mend.ai demonstration data (SYNTHETIC SAMPLE)", organisation: "SYNTHETIC SAMPLE (mend.ai demo; not a real publisher)",
    url: "https://example.org/synthetic/mend_demo", licence: "n/a (synthetic)", version: "demo-1", retrievedAt: NOW,
    collections: ["rental_observations", "transport_stops", "planning_applications", "property_sales", "area_stats"],
    notes: "Invented values shaped like the real datasets, standing in for data not yet loaded (listings, GTFS, planning, PPR, census). Never presented as real.",
  };
  return { source, listings, transport, planning, sales, stats };
}

export async function load(db) {
  await applyValidators(db); await createIndexes(db);
  const d = build();
  await db.collection("sources").replaceOne({ _id: d.source._id }, d.source, { upsert: true });
  for (const [coll, docs] of [["rental_observations", d.listings], ["transport_stops", d.transport], ["planning_applications", d.planning], ["property_sales", d.sales], ["area_stats", d.stats]]) {
    await db.collection(coll).deleteMany({ "src.sourceId": SOURCE_ID });
    if (docs.length) await db.collection(coll).insertMany(docs);
    console.log(`  ${coll.padEnd(22)} ${docs.length} synthetic documents`);
  }
}

if (process.argv[1]?.endsWith("loadDemoData.js")) {
  const client = await MongoClient.connect(process.env.MONGODB_URI ?? "mongodb://localhost:27017");
  try { console.log(`loading SAMPLE data into ${process.env.MONGODB_DB ?? "rentcheck_engine"}...`); await load(client.db(process.env.MONGODB_DB ?? "rentcheck_engine")); }
  finally { await client.close(); }
}

// Snapshots REAL rent figures from the database into the frontend's mock layer, so the deployed app shows real CSO/RTB numbers
// (2-bed average rent per area, 16-quarter trend, bedroom ratios) instead of invented ones. Run after `npm run atlas:setup`.
//
//   npm run snapshot:frontend        -> frontend/server/fixtures/real-rents.json   (committed; the app reads this file, no DB needed)
import "../lib/env.js";
import { readFileSync, writeFileSync } from "node:fs";
import { MongoClient } from "mongodb";
import { resolveRtbZone } from "../lib/zones.js";

const dataTs = readFileSync(new URL("../../frontend/server/fixtures/data.ts", import.meta.url), "utf8");
const towns = [...dataTs.matchAll(/\{ county: '([^']+)', area: '([^']+)', lng: (-?[\d.]+), lat: ([\d.]+), median: (\d+) \}/g)]
  .map((m) => ({ county: m[1], area: m[2], lng: +m[3], lat: +m[4], sample: +m[5] }));
const places = [{ county: "Dublin", area: "Dublin 8", lng: -6.283, lat: 53.338, sample: 1980 }, ...towns];

const client = await MongoClient.connect(process.env.MONGODB_URI ?? "mongodb://localhost:27017");
const db = client.db(process.env.MONGODB_DB ?? "rentcheck_engine");
const q = (areaId, propertyType, bedrooms) => db.collection("rental_indexes").find({ areaId, measure: "registered_average", propertyType, ...(bedrooms ? { bedrooms } : {}) }).sort({ periodStart: 1 }).toArray();
const labelOf = (d) => `${d.periodStart.getUTCFullYear()}-Q${Math.floor(d.periodStart.getUTCMonth() / 3) + 1}`;

/** the last 16 quarters ending at the latest published one, gaps filled by straight-line interpolation (and counted) */
function lastQuarters(rows, n = 16) {
  if (!rows.length) return null;
  const byQ = new Map(rows.map((r) => [r.periodStart.getTime(), r.avgRent]));
  const end = rows.at(-1).periodStart;
  const out = []; let interpolated = 0;
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 3 * i, 1));
    out.push({ d, v: byQ.get(d.getTime()) ?? null });
  }
  const known = out.map((x, i) => (x.v != null ? i : -1)).filter((i) => i >= 0);
  if (known.length < 8) return null;
  for (let i = 0; i < out.length; i++) if (out[i].v == null) {
    const lo = known.filter((k) => k < i).at(-1), hi = known.find((k) => k > i);
    if (lo == null) { out[i].v = out[known[0]].v; } else if (hi == null) { out[i].v = out[lo].v; } else out[i].v = out[lo].v + ((out[hi].v - out[lo].v) * (i - lo)) / (hi - lo);
    interpolated++;
  }
  return { series: out.map(({ d, v }) => ({ period: `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`, value: Math.round(v * 100) / 100 })), interpolated };
}

const areas = {};
for (const p of places) {
  const z = await resolveRtbZone(db, { type: "Point", coordinates: [p.lng, p.lat] }, { propertyType: "all", bedrooms: 2, maxDistanceM: 25000 });
  if (!z.zoneId) { console.log(`  no real figure near ${p.area}; keeps the sample value`); continue; }
  const s = lastQuarters(await q(z.zoneId, "all", 2));
  if (!s) { console.log(`  ${p.area}: ${z.zoneName} has too little history; keeps the sample value`); continue; }
  areas[p.area] = { place: z.zoneName, placeLevel: z.level, distanceM: z.distM, base2bed: s.series.at(-1).value, latest: s.series.at(-1).period, series: s.series, interpolatedQuarters: s.interpolated };
  console.log(`  ${p.area.padEnd(20)} <- ${z.zoneName} (${z.distM} m)  EUR ${s.series.at(-1).value}  (${s.series.at(-1).period}, ${s.interpolated} interpolated)`);
}

// bedroom ratios relative to 2-bed, from the whole of Dublin (all property types), latest quarter with all four present
const dub = "county:riq-120500", ratios = {};
const beds = {}; for (const b of [1, 2, 3, 4]) beds[b] = (await q(dub, "all", b)).at(-1)?.avgRent;
if (beds[2]) for (const b of [1, 3, 4]) if (beds[b]) ratios[b] = Math.round((beds[b] / beds[2]) * 1000) / 1000;
const src = await db.collection("sources").findOne({ _id: "cso_riq02" });
await client.close();

const out = {
  generated_at: new Date().toISOString(), note: "REAL figures from CSO PxStat RIQ02 (RTB Average Monthly Rent Report), snapshotted from the database. Bedroom/type scaling beyond these ratios is still a sample model.",
  source: src && { id: "cso_riq02", title: src.title, organisation: src.organisation, url: src.url, licence: src.licence, version: src.version },
  latestPeriod: Object.values(areas).map((a) => a.latest).sort().at(-1) ?? null, bedroomRatios: ratios, areas,
};
writeFileSync(new URL("../../frontend/server/fixtures/real-rents.json", import.meta.url), JSON.stringify(out, null, 1));
console.log(`\nwrote frontend/server/fixtures/real-rents.json: ${Object.keys(areas).length}/${places.length} areas with real figures, bedroom ratios`, ratios);

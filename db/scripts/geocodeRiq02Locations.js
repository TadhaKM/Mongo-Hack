// One-off, cached geocoding of the RIQ02 place names (CSO publishes no coordinates for them).
//   node db/scripts/geocodeRiq02Locations.js        (needs data/raw/riq02.json; resumable; ~1 request per second)
//
// Source: OpenStreetMap Nominatim. Results are (c) OpenStreetMap contributors, ODbL. Usage policy: max 1 req/s,
// identifying User-Agent, and results are cached in data/derived/riq02_locations.json so this never runs twice.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseRiq02 } from "./riq02Parse.js";

const OUT = new URL("../../data/derived/riq02_locations.json", import.meta.url);
const IRELAND = { latMin: 51.3, latMax: 55.5, lonMin: -10.8, lonMax: -5.9 };
const DUBLIN = { latMin: 53.2, latMax: 53.65, lonMin: -6.55, lonMax: -6.0 };
const inBox = (b, lat, lon) => lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (s) => s.replace(/\s+,/g, ",").replace(/\s+/g, " ").trim();   // "Kilmainham , Dublin 8" -> "Kilmainham, Dublin 8"

const { locations, hasRecentData } = parseRiq02(JSON.parse(readFileSync(new URL("../../data/raw/riq02.json", import.meta.url), "utf8")));
mkdirSync(new URL("../../data/derived/", import.meta.url), { recursive: true });
const cache = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};

const todo = locations.filter((l) => hasRecentData.has(l.code) && !cache[l.code]);
console.log(`${locations.length} locations, ${Object.keys(cache).length} cached, ${todo.length} to geocode`);

for (const [i, loc] of todo.entries()) {
  const label = clean(loc.label);
  const isDublin = /dublin/i.test(label);
  const q = /,/.test(label) || /^dublin$/i.test(label) ? `${label}, Ireland` : `${label}, Ireland`;
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=3&countrycodes=ie&q=${encodeURIComponent(q)}`;
  let result = null;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "mend-ai-hackathon/0.1 (student project; contact via GitHub TadhaKM/Mongo-Hack)" } });
    const hits = res.ok ? await res.json() : [];
    // first hit inside the right box (Dublin names must be in County Dublin)
    const hit = hits.find((h) => inBox(IRELAND, +h.lat, +h.lon) && (!isDublin || inBox(DUBLIN, +h.lat, +h.lon)));
    if (hit) result = { lat: +(+hit.lat).toFixed(5), lng: +(+hit.lon).toFixed(5), osmType: hit.type, osmClass: hit.category ?? hit.class, displayName: hit.display_name, importance: hit.importance };
  } catch (e) { console.log("  error", label, e.message); }
  cache[loc.code] = { code: loc.code, label, ...(result ?? { unresolved: true }) };
  if ((i + 1) % 20 === 0 || i === todo.length - 1) { writeFileSync(OUT, JSON.stringify(cache, null, 1)); console.log(`  ${i + 1}/${todo.length} (${label}${result ? "" : " UNRESOLVED"})`); }
  await sleep(1100);
}
writeFileSync(OUT, JSON.stringify(cache, null, 1));
const un = Object.values(cache).filter((c) => c.unresolved);
console.log(`done. ${Object.keys(cache).length} cached, ${un.length} unresolved: ${un.map((u) => u.label).join("; ")}`);

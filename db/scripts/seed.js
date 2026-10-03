// Synthetic sample data in the shapes defined in docs/mongodb-data-model.md.
// Coordinates are around Ranelagh, Dublin. Values are invented for development and tests only.
// Dates are relative to "now" so time-window queries always find data.

const C = { lng: -6.2551, lat: 53.3264 };

const box = (w, s, e, n) => ({ type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] });
const centre = (w, s, e, n) => ({ type: "Point", coordinates: [(w + e) / 2, (s + n) / 2] });
const pt = (dLng, dLat) => ({ type: "Point", coordinates: [C.lng + dLng, C.lat + dLat] });
const km2 = (w, s, e, n) => Math.round(((e - w) * 66.5) * ((n - s) * 111.2) * 100) / 100;

const NOW = new Date();
const qStart = (back) => {
  const q = Math.floor(NOW.getUTCMonth() / 3) - back;
  return new Date(Date.UTC(NOW.getUTCFullYear(), q * 3, 1));
};
const qLabel = (d) => `${d.getUTCFullYear()}Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
const daysAgo = (n) => new Date(NOW.getTime() - n * 864e5);
const src = (sourceId, recordId, version = "seed", extra = {}) => ({ sourceId, recordId, version, retrievedAt: NOW, ...extra });

export function buildSeed() {
  const sources = [
    ["rtb_rent_index", "RTB Rent Index", "Residential Tenancies Board / ESRI", "rtb_zone", "cell_key"],
    ["cso_saps_2022", "Census 2022 Small Area Population Statistics", "Central Statistics Office", "small_area", "GUID"],
    ["nta_gtfs", "GTFS Transport Feed", "National Transport Authority", "point", "stop_id"],
    ["planning_national", "National Planning Applications", "Department of Housing", "point", "reference"],
    ["ppr", "Residential Property Price Register", "Property Services Regulatory Authority", "point", "row_id"],
    ["cso_vacancy", "Vacancy Statistics", "Central Statistics Office", "lea", "area_period"],
    ["rtb_terminations", "RTB Notices of Termination", "Residential Tenancies Board", "lea", "area_period_ground"],
    ["listings", "Rental Listings (sample)", "Sample provider", "point", "listing_id"],
  ].map(([_id, title, organisation, geographyLevel, recordIdField]) => ({
    _id, title, organisation, url: `https://example.org/${_id}`, licence: "CC-BY-4.0", version: "seed",
    retrievedAt: NOW, recordIdField, geographyLevel,
    coverage: { from: new Date(Date.UTC(2007, 0, 1)), to: _id === "cso_vacancy" ? new Date(Date.UTC(2022, 3, 1)) : qStart(1) },
  }));

  // ---- areas
  const Z = {
    "rtbzone:dublin-6": { name: "Dublin 6", b: [-6.27, 53.32, -6.24, 53.335], base: 1890 },
    "rtbzone:dublin-4": { name: "Dublin 4", b: [-6.24, 53.32, -6.20, 53.335], base: 2050 },
    "rtbzone:dublin-8": { name: "Dublin 8", b: [-6.30, 53.32, -6.27, 53.335], base: 1650 },
    "rtbzone:dublin-2": { name: "Dublin 2", b: [-6.27, 53.335, -6.24, 53.35], base: 1900 },
    "rtbzone:dublin-14": { name: "Dublin 14", b: [-6.27, 53.30, -6.24, 53.32], base: 1750 },
  };
  const areaSrc = (id, s = "cso_saps_2022") => src(s, id);
  const areas = [];
  for (const [id, z] of Object.entries(Z)) {
    areas.push({ _id: id, level: "rtb_zone", code: id.split(":")[1], name: z.name, geometry: box(...z.b), centroid: centre(...z.b),
      areaKm2: km2(...z.b), src: areaSrc(id, "rtb_rent_index") });
  }
  const LEA = "lea:dublin-city-south-east", COUNTY = "county:dublin-city", ED = "ed:268001";
  const leaB = [-6.30, 53.30, -6.20, 53.35];
  areas.push({ _id: LEA, level: "lea", code: "dcse", name: "Dublin City South East", geometry: box(...leaB), centroid: centre(...leaB), areaKm2: km2(...leaB), src: areaSrc(LEA) });
  for (const [i, b] of [[2, [-6.30, 53.36, -6.20, 53.40]], [3, [-6.40, 53.30, -6.31, 53.36]], [4, [-6.19, 53.30, -6.10, 53.36]]]) {
    areas.push({ _id: `lea:dublin-${i}`, level: "lea", code: `d${i}`, name: `Dublin LEA ${i}`, geometry: box(...b), centroid: centre(...b), areaKm2: km2(...b), src: areaSrc(`lea:dublin-${i}`) });
  }
  const cB = [-6.45, 53.25, -6.05, 53.45];
  areas.push({ _id: COUNTY, level: "county", code: "dc", name: "Dublin City", geometry: box(...cB), centroid: centre(...cB), areaKm2: km2(...cB), src: areaSrc(COUNTY) });
  const eB = [-6.262, 53.322, -6.246, 53.331];
  areas.push({ _id: ED, level: "electoral_division", code: "268001", name: "Ranelagh ED", geometry: box(...eB), centroid: centre(...eB), areaKm2: km2(...eB), src: areaSrc(ED) });

  const parents = { electoral_division: ED, lea: LEA, county: COUNTY, rtb_zone: "rtbzone:dublin-6" };
  const sa1 = [C.lng - 0.003, C.lat - 0.002, C.lng + 0.003, C.lat + 0.002];
  const sa2 = [C.lng + 0.003, C.lat - 0.002, C.lng + 0.009, C.lat + 0.002];
  areas.push(
    { _id: "sa:268001001", level: "small_area", code: "268001001", name: "Ranelagh A", geometry: box(...sa1), centroid: centre(...sa1), areaKm2: km2(...sa1), parents,
      census: { year: 2022, population: 412, households: 171, avgHouseholdSize: 2.4, dwellings: 188, renterHouseholds: 99, renterPct: 57.9, vacantDwellings: 9,
        ageBands: { "0_14": 48, "15_24": 55, "25_34": 129, "35_64": 140, "65_plus": 40 } }, src: areaSrc("268001001") },
    { _id: "sa:268001002", level: "small_area", code: "268001002", name: "Ranelagh B", geometry: box(...sa2), centroid: centre(...sa2), areaKm2: km2(...sa2), parents,
      census: { year: 2022, population: 530, households: 210, avgHouseholdSize: 2.5, dwellings: 230, renterHouseholds: 80, renterPct: 38.1, vacantDwellings: 14,
        ageBands: { "0_14": 90, "15_24": 60, "25_34": 100, "35_64": 210, "65_plus": 70 } }, src: areaSrc("268001002") },
  );

  // ---- rent index cells: 13 quarters, ~1.3%/quarter growth
  const rental_indexes = [], rental_observations = [];
  for (const [zid, z] of Object.entries(Z)) {
    for (let i = 0; i < 13; i++) {
      const d = qStart(13 - i); // oldest first, ending at last completed quarter
      const label = qLabel(d);
      rental_indexes.push({ areaId: zid, areaLevel: "rtb_zone", propertyType: "apartment", bedrooms: 2, measure: "index_mean",
        avgRent: Math.round(z.base * 1.013 ** i), stdError: 40, sampleSize: 300 + i,
        periodStart: d, periodLabel: label, src: src("rtb_rent_index", `${zid}|apartment|2|${label}`) });
    }
  }
  // ---- listings
  const L = [[0.0004, 0.0003, 2250, 66, "4 Sample Ave"], [-0.0015, 0.001, 2300, 65, "12 Example Rd"], [0.002, -0.0005, 2400, 70, "7 Cowper Gdns"],
    [0.006, 0.002, 2100, 58, "22 Beechwood Ave"], [-0.004, -0.003, 2000, 55, "9 Mount Pleasant"], [0.001, 0.009, 2500, 72, "3 Leeson Pk"],
    [0.012, 0.004, 2650, 75, "88 Ballsbridge Ct"], [-0.009, 0.005, 1950, 52, "15 Rathmines Rd"], [0.003, 0.003, 2350, 68, "6 Dunville Ave"],
    [-0.002, -0.006, 2200, 60, "31 Charleston Rd"], [0.02, 0.01, 2900, 80, "1 Far Away Sq"], [0.0007, -0.0004, 2275, 64, "2 Sample Ave"]];
  L.forEach(([dx, dy, amt, m2, address], i) => rental_observations.push({
    measure: "advertised", areaId: "sa:268001001", propertyType: "apartment", bedrooms: 2,
    rent: { amount: amt, period: "month" }, floorAreaM2: m2, address, geo: pt(dx, dy),
    observedAt: daysAgo(5 + i * 6), src: src("listings", `L-${100 + i}`, "seed", { geoMethod: "address_match", geoConfidence: 0.9 }) }));
  rental_observations.push({ measure: "advertised", areaId: "sa:268001001", propertyType: "apartment", bedrooms: 1,
    rent: { amount: 1700, period: "month" }, address: "1-bed decoy", geo: pt(0.0005, 0.0005), observedAt: daysAgo(3),
    src: src("listings", "L-900", "seed", { geoMethod: "address_match", geoConfidence: 0.9 }) });

  // ---- transport
  const stops = [
    ["8220DB000002", "Ranelagh, Luas", 0.0027, 0.0002, ["luas"], [{ routeId: "GREEN", shortName: "Green", mode: "luas", agency: "Luas" }], 16],
    ["B1", "Ranelagh Rd, Bus 1", -0.002, 0.0012, ["bus"], [{ routeId: "11", shortName: "11", mode: "bus", agency: "Dublin Bus" }], 8],
    ["B2", "Ranelagh Rd, Bus 2", -0.0022, 0.0014, ["bus"], [{ routeId: "11", shortName: "11", mode: "bus", agency: "Dublin Bus" }, { routeId: "15", shortName: "15", mode: "bus", agency: "Dublin Bus" }], 10],
    ["B3", "Beechwood Ave", 0.0045, 0.0025, ["bus"], [{ routeId: "46A", shortName: "46A", mode: "bus", agency: "Dublin Bus" }], 6],
    ["B4", "Cowper Rd", -0.0035, -0.0015, ["bus"], [{ routeId: "15", shortName: "15", mode: "bus", agency: "Dublin Bus" }], 5],
    ["B5", "Far stop", 0.012, 0.0, ["bus"], [{ routeId: "7", shortName: "7", mode: "bus", agency: "Dublin Bus" }], 4],
    ["D1", "Distant DART", 0.03, 0.01, ["dart"], [{ routeId: "DART", shortName: "DART", mode: "dart", agency: "Irish Rail" }], 6],
  ].map(([stopId, name, dx, dy, modes, routes, tph]) => ({
    _id: `nta:${stopId}`, stopId, name, geo: pt(dx, dy), modes, routes, service: { weekdayPeakTripsPerHour: tph },
    areaId: "sa:268001001", src: src("nta_gtfs", stopId, "gtfs-seed") }));

  // ---- planning
  const P = [["3456/24", 0.0016, 0.0016, "granted", 42, 320, "Construction of 42 apartments over basement"], ["1010/23", -0.003, 0.002, "granted", 12, 700, "12 apartments"],
    ["2020/25", 0.004, -0.002, "pending", 80, 60, "Build-to-rent scheme of 80 units"], ["3030/22", 0.005, 0.004, "refused", 20, 900, "20 units refused"],
    ["4040/24", -0.006, -0.001, "granted", 0, 400, "Shopfront alterations"], ["5050/25", 0.001, -0.004, "pending", 6, 120, "6 townhouses"],
    ["6060/21", 0.002, 0.006, "granted", 30, 1500, "Old application outside window"], ["7070/24", 0.03, 0.03, "granted", 99, 200, "Far away"]];
  const planning = P.map(([reference, dx, dy, status, units, ago, proposal]) => ({
    reference, authority: "Dublin City Council", geo: pt(dx, dy), proposal, applicationDate: daysAgo(ago), status,
    ...(status !== "pending" && { decision: { outcome: status === "granted" ? "Grant Permission" : "Refuse Permission", date: daysAgo(ago - 90) } }),
    development: { type: units ? "residential" : "commercial", ...(units && { residentialUnits: units }) },
    areaId: "sa:268001001", src: src("planning_national", `DCC|${reference}`) }));

  // ---- sales
  const S = [[0.0003, 0.0002, 545000, 30], [-0.001, 0.0006, 510000, 90], [0.002, -0.001, 600000, 150], [0.004, 0.003, 480000, 200], [-0.003, -0.002, 455000, 260],
    [0.0008, 0.005, 650000, 300], [-0.005, 0.001, 420000, 400], [0.006, -0.003, 530000, 500], [0.001, 0.001, 575000, 60], [0.0012, -0.0008, 515000, 800]];
  const sales = S.map(([dx, dy, price, ago], i) => ({
    address: `${i + 1} Sale St`, geo: pt(dx, dy), salePrice: price, saleDate: daysAgo(ago), fullMarketPrice: true, propertyType: "terraced",
    areaId: "sa:268001001", src: src("ppr", `ppr-${i}`, "seed", { geoMethod: "address_match", geoConfidence: 0.88 }) }));
  sales.push({ address: "Low-confidence geocode", geo: pt(0.0004, 0.0004), salePrice: 1, saleDate: daysAgo(10), fullMarketPrice: true,
    areaId: "sa:268001001", src: src("ppr", "ppr-low", "seed", { geoMethod: "centroid", geoConfidence: 0.2 }) });
  sales.push({ address: "Not full market", geo: pt(0.0005, 0.0004), salePrice: 100000, saleDate: daysAgo(10), fullMarketPrice: false,
    areaId: "sa:268001001", src: src("ppr", "ppr-nfm", "seed", { geoMethod: "address_match", geoConfidence: 0.9 }) });

  // ---- area stats
  const area_stats = [];
  area_stats.push({ areaId: LEA, areaLevel: "lea", stat: "vacancy", periodStart: new Date(Date.UTC(2022, 3, 1)), periodEnd: new Date(Date.UTC(2022, 3, 1)), periodLabel: "2022",
    values: { vacantDwellings: 900, totalDwellings: 29000, vacancyRatePct: 3.1 }, src: src("cso_vacancy", `${LEA}|2022`) });
  area_stats.push({ areaId: COUNTY, areaLevel: "county", stat: "vacancy", periodStart: new Date(Date.UTC(2022, 3, 1)), periodEnd: new Date(Date.UTC(2022, 3, 1)), periodLabel: "2022",
    values: { vacantDwellings: 5000, totalDwellings: 250000, vacancyRatePct: 2.0 }, src: src("cso_vacancy", `${COUNTY}|2022`) });
  const rates = { [LEA]: 6.4, "lea:dublin-2": 3.1, "lea:dublin-3": 8.2, "lea:dublin-4": 5.0 };
  for (const [lea, rate] of Object.entries(rates)) {
    for (let i = 0; i < 5; i++) {
      const d = qStart(i + 1), label = qLabel(d);
      for (const [dim, share] of [["sale_of_property", 0.6], ["landlord_use", 0.4]]) {
        area_stats.push({ areaId: lea, areaLevel: "lea", stat: "rtb_terminations", dimension: dim, periodStart: d, periodEnd: d, periodLabel: label,
          values: { notices: Math.round(rate * 10 * share), noticesPer1000Tenancies: Math.round(rate * share * 100) / 100 }, src: src("rtb_terminations", `${lea}|${label}|${dim}`) });
      }
    }
  }
  return { sources, areas, rental_indexes, rental_observations, transport_stops: stops, planning_applications: planning, property_sales: sales, area_stats, C };
}

export async function seed(db) {
  const data = buildSeed();
  for (const [coll, docs] of Object.entries(data)) {
    if (coll === "C") continue;
    await db.collection(coll).deleteMany({});
    await db.collection(coll).insertMany(docs);
  }
  return data.C;
}

if (process.argv[1]?.endsWith("seed.js")) {
  const { MongoClient } = await import("mongodb");
  const { createIndexes } = await import("./createIndexes.js");
  const { applyValidators } = await import("../schemas/validators.js");
  const client = await MongoClient.connect(process.env.MONGODB_URI ?? "mongodb://localhost:27017");
  const db = client.db(process.env.MONGODB_DB ?? "rentcheck_engine");
  await applyValidators(db);
  await createIndexes(db);
  await seed(db);
  console.log("seeded", db.databaseName);
  await client.close();
}

// ---- historical rent observations for trend tests ---------------------------------------------------------
// Deterministic (seeded PRNG) so tests can recompute every statistic independently.
// Series (all monthly, ~31 months back from `now`):
//   listings   apartment 2-bed  : 4/month in Ranelagh A + 4/month in Ranelagh B, +0.8%/month; gap 18 months back; 2 docs 17 months back
//   listings   apartment 1-bed, house 3-bed
//   listings_b apartment 2-bed  : a second source, systematically ~8% higher
//   rtb_registered apartment 2-bed (measure "registered"): ~12% lower - must never leak into advertised results
//   far group  apartment 2-bed ~3.3 km away, 20% cheaper, areaId unassigned - only visible to wide radii
export function buildHistory(now = new Date()) {
  let s = 123456789;
  const rnd = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const docs = [];
  const mk = (i, { source, measure = "advertised", type, beds, base, n, box, areaId, mult = 1 }, k) => {
    const m = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() - i, 1));
    const maxDay = i === 0 ? Math.max(1, now.getUTCDate() - 1) : 28;
    const observedAt = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), 1 + Math.floor(rnd() * maxDay), 12));
    const growth = 1.008 ** (31 - i);
    const amount = Math.round((base * growth * mult * (1 + (rnd() - 0.5) * 0.06)) / 5) * 5;
    const [w, so, e, no] = box;
    const geo = { type: "Point", coordinates: [w + rnd() * (e - w), so + rnd() * (no - so)] };
    docs.push({
      measure, rent: { amount, period: "month" }, bedrooms: beds, propertyType: type, floorAreaM2: 50 + Math.floor(rnd() * 30), geo, areaId,
      observedAt, address: `${source} ${type} ${beds}-bed ${i}-${k}`,
      src: { sourceId: source, recordId: `${source}-${type}-${beds}-${areaId}-${i}-${k}`, version: "hist-seed", retrievedAt: now, geoMethod: "address_match", geoConfidence: 0.9 },
    });
  };
  const sa1 = [C.lng - 0.003, C.lat - 0.002, C.lng + 0.003, C.lat + 0.002];
  const sa2 = [C.lng + 0.003, C.lat - 0.002, C.lng + 0.009, C.lat + 0.002];
  const far = [C.lng + 0.05, C.lat - 0.002, C.lng + 0.054, C.lat + 0.002];
  for (let i = 0; i <= 31; i++) {
    const main = i === 18 ? 0 : i === 17 ? 1 : 4;   // gap at 18; a thin month (2 docs total) at 17
    for (let k = 0; k < main; k++) {
      mk(i, { source: "listings", type: "apartment", beds: 2, base: 2000, box: sa1, areaId: "sa:268001001" }, k);
      mk(i, { source: "listings", type: "apartment", beds: 2, base: 2000, box: sa2, areaId: "sa:268001002" }, k);
    }
    for (let k = 0; k < 6; k++) {
      mk(i, { source: "listings", type: "apartment", beds: 1, base: 1600, box: sa1, areaId: "sa:268001001" }, k);
      mk(i, { source: "listings", type: "house", beds: 3, base: 2600, box: sa2, areaId: "sa:268001002" }, k);
      mk(i, { source: "listings_b", type: "apartment", beds: 2, base: 2000, mult: 1.08, box: sa1, areaId: "sa:268001001" }, k);
      mk(i, { source: "rtb_registered", measure: "registered", type: "apartment", beds: 2, base: 2000, mult: 0.88, box: sa1, areaId: "sa:268001001" }, k);
    }
    for (let k = 0; k < 5; k++) mk(i, { source: "listings", type: "apartment", beds: 2, base: 2000, mult: 0.8, box: far, areaId: "sa:268001999" }, k);
  }
  return docs;
}

export async function seedHistory(db, now = new Date()) {
  const docs = buildHistory(now);
  await db.collection("rental_observations").insertMany(docs);
  return docs;
}

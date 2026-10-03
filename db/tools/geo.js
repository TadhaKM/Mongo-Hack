// Geospatial engine: everything that starts from a coordinate.
import { point, metresToRadians } from "../lib/geo.js";
import { envelope, noData, confidenceFromN } from "../lib/envelope.js";

const LEVEL_ORDER = ["small_area", "electoral_division", "lea", "county"];
const ref = (collection, docId) => ({ collection, docId: String(docId) });
const yearsAgo = (y) => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - y); return d; };
const monthsAgo = (m) => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() - m); return d; };

/** E. Which census polygon contains the property? ($geoIntersects, point-in-polygon) */
export async function locateProperty(db, { lng, lat }, ledger) {
  const scope = ledger.scope();
  const pt = point(lng, lat);
  const area = await db.collection("areas").findOne(
    { level: "small_area", geometry: { $geoIntersects: { $geometry: pt } } },
    { projection: { name: 1, parents: 1, census: 1, src: 1 } },
  );
  if (!area) return noData(scope, "Coordinates are not inside any loaded small area.", { geoMatch: "none" });

  scope.add({
    tool: "locateProperty",
    claim: `Property lies in census small area ${area.name}`,
    value: area._id,
    context: { areaLevel: "small_area", method: "$geoIntersects" },
    refs: [ref("areas", area._id)],
    sourceIds: [area.src.sourceId],
  });
  if (area.census?.renterPct != null) {
    scope.add({
      tool: "locateProperty",
      claim: `Share of households renting in ${area.name} (Census ${area.census.year})`,
      value: area.census.renterPct, unit: "pct",
      context: { areaLevel: "small_area", year: area.census.year },
      refs: [ref("areas", area._id)], sourceIds: [area.src.sourceId],
    });
  }
  return envelope({
    scope,
    data: { areaId: area._id, name: area.name, parents: area.parents, census: area.census },
    coverage: { geoMatch: "small_area", dataAsOf: String(area.census?.year ?? ""), confidence: "high" },
  });
}

/** Vacancy-area identification: finest geography that actually has vacancy data (small area -> county). */
export async function vacancyForLocation(db, { lng, lat }, ledger) {
  const scope = ledger.scope();
  const pt = point(lng, lat);
  const area = await db.collection("areas").findOne(
    { level: "small_area", geometry: { $geoIntersects: { $geometry: pt } } },
    { projection: { parents: 1 } },
  );
  if (!area) return noData(scope, "Coordinates are not inside any loaded small area.");
  const ids = [area._id, ...Object.values(area.parents ?? {})];
  const [row] = await db.collection("area_stats").aggregate([
    { $match: { stat: "vacancy", areaId: { $in: ids } } },
    { $set: { levelRank: { $indexOfArray: [LEVEL_ORDER, "$areaLevel"] } } },
    { $sort: { levelRank: 1, periodStart: -1 } }, // finest level first, then newest
    { $limit: 1 },
  ]).toArray();
  if (!row) return noData(scope, "No vacancy statistics for this location at any geographic level.");
  scope.add({
    tool: "vacancyForLocation",
    claim: `Vacancy rate for ${row.areaId} (${row.areaLevel}), ${row.periodLabel}`,
    value: row.values.vacancyRatePct, unit: "pct",
    context: { areaLevel: row.areaLevel, period: row.periodLabel, areaId: row.areaId },
    refs: [ref("area_stats", row._id)], sourceIds: [row.src.sourceId],
  });
  const warnings = row.areaLevel === "small_area" ? [] : [`Vacancy is published at ${row.areaLevel} level, not for the property's own small area.`];
  return envelope({
    scope, warnings,
    data: { areaId: row.areaId, areaLevel: row.areaLevel, period: row.periodLabel, ...row.values },
    coverage: { geoMatch: row.areaLevel, dataAsOf: row.periodLabel, confidence: row.areaLevel === "small_area" ? "high" : "medium" },
  });
}

/** A (500 m default). $geoNear filters by radius, returns distance and sorts nearest-first. */
export async function nearbyTransport(db, { lng, lat, radiusM = 500 }, ledger) {
  const scope = ledger.scope();
  const pt = point(lng, lat);
  const [r] = await db.collection("transport_stops").aggregate([
    { $geoNear: { near: pt, key: "geo", distanceField: "distM", maxDistance: radiusM, spherical: true } },
    { $facet: {
      total: [{ $group: { _id: null, stops: { $sum: 1 }, nearestM: { $min: "$distM" },
        peakTph: { $sum: { $ifNull: ["$service.weekdayPeakTripsPerHour", 0] } } } }],
      byMode: [{ $unwind: "$modes" },
        { $group: { _id: "$modes", stops: { $sum: 1 }, nearestM: { $min: "$distM" },
          peakTph: { $sum: { $ifNull: ["$service.weekdayPeakTripsPerHour", 0] } } } },
        { $sort: { nearestM: 1 } }],
      routes: [{ $unwind: "$routes" }, { $group: { _id: "$routes.shortName", mode: { $first: "$routes.mode" } } }, { $sort: { _id: 1 } }],
      nearest: [{ $sort: { distM: 1 } }, { $limit: 3 }, { $project: { name: 1, modes: 1, distM: { $round: ["$distM", 0] } } }],
    } },
    { $set: { total: { $first: "$total" } } },
    { $set: { "total.score": { $round: [{ $add: [
      { $multiply: [50, { $max: [0, { $subtract: [1, { $divide: ["$total.nearestM", radiusM] }] }] }] },
      { $min: [50, { $multiply: ["$total.peakTph", 2.5] }] },
    ] }, 0] } } },
  ]).toArray();
  if (!r.total) {
    return noData(scope, `No transport stops within ${radiusM} m.`, { geoMatch: "radius", confidence: "high" });
  }
  const refs = r.nearest.map((s) => ref("transport_stops", s._id));
  const ctx = { radiusM, distance: "straight-line (great-circle), not walking", method: "$geoNear" };
  scope.add({ tool: "nearbyTransport", claim: `Transport stops within ${radiusM} m`, value: r.total.stops, unit: "count", context: ctx, refs, sourceIds: ["nta_gtfs"] });
  scope.add({ tool: "nearbyTransport", claim: "Distance to nearest transport stop", value: Math.round(r.total.nearestM), unit: "m", context: ctx, refs, sourceIds: ["nta_gtfs"] });
  scope.add({ tool: "nearbyTransport", claim: "Transport score (0-100: 50 proximity + 50 peak frequency)", value: r.total.score, unit: "score",
    context: { ...ctx, formula: "50*(1-nearestM/radius) + min(50, 2.5*peakTripsPerHour)" }, refs, sourceIds: ["nta_gtfs"] });
  return envelope({
    scope,
    data: { total: r.total, byMode: r.byMode, routes: r.routes, nearest: r.nearest },
    coverage: { geoMatch: "radius", confidence: "high" },
    warnings: ["Distances are straight-line, not walking routes."],
  });
}

/** D. Nearest stop per mode, up to maxM. */
export async function nearestStops(db, { lng, lat, maxM = 5000 }, ledger) {
  const scope = ledger.scope();
  const pt = point(lng, lat);
  const rows = await db.collection("transport_stops").aggregate([
    { $geoNear: { near: pt, key: "geo", distanceField: "distM", maxDistance: maxM, spherical: true } },
    { $unwind: "$modes" },
    { $group: { _id: "$modes", stopId: { $first: "$_id" }, name: { $first: "$name" }, distM: { $first: "$distM" } } }, // input is nearest-first
    { $project: { mode: "$_id", _id: 0, stopId: 1, name: 1, distM: { $round: ["$distM", 0] } } },
    { $sort: { distM: 1 } },
  ]).toArray();
  if (!rows.length) return noData(scope, `No transport stops within ${maxM} m.`);
  for (const r of rows) {
    scope.add({ tool: "nearestStops", claim: `Nearest ${r.mode} stop: ${r.name}`, value: r.distM, unit: "m",
      context: { mode: r.mode, distance: "straight-line" }, refs: [ref("transport_stops", r.stopId)], sourceIds: ["nta_gtfs"] });
  }
  return envelope({ scope, data: { nearestByMode: rows }, coverage: { geoMatch: "radius", confidence: "high" }, warnings: ["Distances are straight-line."] });
}

/** B. Planning applications within radius (default 1 km) */
export async function nearbyPlanning(db, { lng, lat, radiusM = 1000, sinceYears = 4 }, ledger) {
  const scope = ledger.scope();
  const pt = point(lng, lat);
  const since = yearsAgo(sinceYears);
  const radiusKm = radiusM / 1000;
  const [r] = await db.collection("planning_applications").aggregate([
    { $geoNear: { near: pt, key: "geo", distanceField: "distM", maxDistance: radiusM, spherical: true,
      query: { applicationDate: { $gte: since } } } },
    { $facet: {
      total: [{ $count: "n" }],
      byStatus: [{ $group: { _id: "$status", n: { $sum: 1 }, units: { $sum: { $ifNull: ["$development.residentialUnits", 0] } } } }, { $sort: { n: -1 } }],
      byYear: [{ $group: { _id: { $year: "$applicationDate" }, n: { $sum: 1 }, units: { $sum: { $ifNull: ["$development.residentialUnits", 0] } } } }, { $sort: { _id: 1 } }],
      largest: [{ $match: { "development.residentialUnits": { $gt: 0 } } }, { $sort: { "development.residentialUnits": -1 } }, { $limit: 3 },
        { $project: { reference: 1, proposal: 1, status: 1, "development.residentialUnits": 1, distM: { $round: ["$distM", 0] } } }],
      pipelineUnits: [{ $match: { status: { $in: ["granted", "pending"] } } },
        { $group: { _id: null, units: { $sum: { $ifNull: ["$development.residentialUnits", 0] } } } }],
    } },
    { $set: { total: { $ifNull: [{ $first: "$total.n" }, 0] }, pipelineUnits: { $ifNull: [{ $first: "$pipelineUnits.units" }, 0] } } },
    { $set: { densityPerKm2: { $round: [{ $divide: ["$total", Math.PI * radiusKm * radiusKm] }, 1] } } },
  ]).toArray();
  const ctx = { radiusM, since: since.toISOString().slice(0, 10), method: "$geoNear" };
  const refs = r.largest.map((p) => ref("planning_applications", p._id));
  scope.add({ tool: "nearbyPlanning", claim: `Planning applications within ${radiusM} m since ${ctx.since}`, value: r.total, unit: "count", context: ctx, refs, sourceIds: ["planning_national"] });
  scope.add({ tool: "nearbyPlanning", claim: "Residential units in granted or pending applications nearby", value: r.pipelineUnits, unit: "units", context: ctx, refs, sourceIds: ["planning_national"] });
  scope.add({ tool: "nearbyPlanning", claim: "Planning application density", value: r.densityPerKm2, unit: "applications/km2", context: ctx, refs, sourceIds: ["planning_national"] });
  return envelope({
    scope,
    data: { total: r.total, densityPerKm2: r.densityPerKm2, pipelineUnits: r.pipelineUnits, byStatus: r.byStatus, byYear: r.byYear, largest: r.largest },
    coverage: { geoMatch: "radius", confidence: confidenceFromN(r.total, { low: 3, high: 15 }) },
    warnings: ["Residential units are only counted where stated in the source data."],
  });
}

/** Recent sales within radius. Sales are NOT rents. */
export async function recentSales(db, { lng, lat, radiusM = 1000, sinceYears = 3, minGeoConfidence = 0.5 }, ledger) {
  const scope = ledger.scope();
  const pt = point(lng, lat);
  const since = yearsAgo(sinceYears);
  const query = { saleDate: { $gte: since }, fullMarketPrice: true, "src.geoConfidence": { $gte: minGeoConfidence } };
  const [r] = await db.collection("property_sales").aggregate([
    { $geoNear: { near: pt, key: "geo", distanceField: "distM", maxDistance: radiusM, spherical: true, query } },
    { $facet: {
      overall: [{ $group: { _id: null, n: { $sum: 1 },
        median: { $median: { input: "$salePrice", method: "approximate" } },
        quartiles: { $percentile: { input: "$salePrice", p: [0.25, 0.75], method: "approximate" } } } }],
      byYear: [{ $group: { _id: { $year: "$saleDate" }, n: { $sum: 1 }, median: { $median: { input: "$salePrice", method: "approximate" } } } }, { $sort: { _id: 1 } }],
      recent: [{ $sort: { saleDate: -1 } }, { $limit: 5 }, { $project: { address: 1, salePrice: 1, saleDate: 1, distM: { $round: ["$distM", 0] } } }],
    } },
  ]).toArray();
  const o = r.overall[0];
  if (!o) return noData(scope, `No qualifying sales within ${radiusM} m.`);
  const ctx = { radiusM, since: since.toISOString().slice(0, 10), filter: `full market price, geoConfidence >= ${minGeoConfidence}` };
  const refs = r.recent.map((s) => ref("property_sales", s._id));
  scope.add({ tool: "recentSales", claim: `Median sale price within ${radiusM} m (n=${o.n})`, value: o.median, unit: "EUR", context: ctx, refs, sourceIds: ["ppr"] });
  return envelope({
    scope, data: { overall: o, byYear: r.byYear, recent: r.recent },
    coverage: { geoMatch: "radius", confidence: confidenceFromN(o.n), n: o.n },
    warnings: ["Sale prices are not rents. Use for price context only."],
  });
}

/** F. All rental data that belongs to the property's relevant geography, kept apart by measurement type. */
export async function rentsInSameArea(db, { lng, lat, propertyType, bedrooms, sinceDate }, ledger) {
  const scope = ledger.scope();
  const pt = point(lng, lat);
  const sa = await db.collection("areas").findOne(
    { level: "small_area", geometry: { $geoIntersects: { $geometry: pt } } },
    { projection: { parents: 1, name: 1 } });
  if (!sa) return noData(scope, "Coordinates are not inside any loaded small area.");
  const areaIds = [sa._id, ...Object.values(sa.parents ?? {})];
  const common = { propertyType, ...(bedrooms != null && { bedrooms }) };

  // Official index cells: published per geography, so matched by areaId up the hierarchy.
  const indexCells = await db.collection("rental_indexes").aggregate([
    { $match: { ...common, areaId: { $in: areaIds }, ...(sinceDate && { periodStart: { $gte: new Date(sinceDate) } }) } },
    { $group: { _id: { areaId: "$areaId", level: "$areaLevel" }, n: { $sum: 1 }, latest: { $max: "$periodStart" }, avgRent: { $avg: "$avgRent" } } },
    { $project: { _id: 0, areaId: "$_id.areaId", level: "$_id.level", n: 1, latest: 1, avgRent: { $round: ["$avgRent", 0] } } },
    { $sort: { level: 1 } },
  ]).toArray();

  // Point observations: advertised rents inside the LEA polygon itself ($geoWithin + $geometry),
  // independent of how areaId was labelled at load time.
  let advertisedInLea = 0;
  if (sa.parents?.lea) {
    const lea = await db.collection("areas").findOne({ _id: sa.parents.lea }, { projection: { geometry: 1 } });
    if (lea) {
      advertisedInLea = await db.collection("rental_observations").countDocuments({
        ...common, measure: "advertised", geo: { $geoWithin: { $geometry: lea.geometry } },
        ...(sinceDate && { observedAt: { $gte: new Date(sinceDate) } }),
      });
    }
  }
  scope.add({
    tool: "rentsInSameArea", claim: "Official rent-index cells found across the property's geographic hierarchy",
    value: indexCells.length, unit: "count",
    context: { areaIds, areaLevel: "multi", method: "rental_indexes areaId $in parents" }, refs: [ref("areas", sa._id)], sourceIds: ["rtb_rent_index"],
  });
  scope.add({
    tool: "rentsInSameArea", claim: "Advertised rental observations inside the property's LEA polygon", value: advertisedInLea, unit: "count",
    context: { areaLevel: "lea", areaId: sa.parents?.lea, method: "rental_observations $geoWithin polygon", measure: "advertised" },
    refs: [ref("areas", sa.parents?.lea ?? sa._id)], sourceIds: ["listings"],
  });
  return envelope({
    scope, data: { areaIds, indexCells, advertised: { inLeaPolygon: advertisedInLea } },
    coverage: { geoMatch: "hierarchy", confidence: indexCells.length ? "medium" : "none" },
    warnings: ["Index cells (area averages) and advertised rents (individual listings) are different measures and are reported separately."],
  });
}

/** C + G + H. Rental listings within radius (default 2 km), distance to each, sorted nearest-first. */
export async function comparableListings(db, { lng, lat, propertyType, bedrooms, radiusM = 2000, limit = 25, sinceMonths = 6, askingRent }, ledger) {
  const scope = ledger.scope();
  const pt = point(lng, lat);
  const since = monthsAgo(sinceMonths);
  const rows = await db.collection("rental_observations").aggregate([
    { $geoNear: { near: pt, key: "geo", distanceField: "distM", maxDistance: radiusM, spherical: true,
      query: { measure: "advertised", propertyType, bedrooms, observedAt: { $gte: since } } } },
    { $sort: { distM: 1, observedAt: -1 } },          // H: explicit tie-break; $geoNear is already nearest-first
    { $limit: limit },
    { $project: {
      address: 1, floorAreaM2: 1, observedAt: 1, rent: "$rent.amount",
      distM: { $round: ["$distM", 0] },                // G: distance to every comparable
      deltaVsAskingPct: askingRent
        ? { $round: [{ $multiply: [{ $divide: [{ $subtract: ["$rent.amount", askingRent] }, askingRent] }, 100] }, 1] }
        : "$$REMOVE",
    } },
  ]).toArray();
  if (!rows.length) return noData(scope, `No comparable listings within ${radiusM} m.`, { geoMatch: "radius" });
  scope.add({ tool: "comparableListings", claim: `Comparable listings within ${radiusM} m (${bedrooms}-bed ${propertyType})`, value: rows.length, unit: "count",
    context: { radiusM, sinceMonths, areaLevel: "point", method: "$geoNear" }, refs: rows.map((r) => ref("rental_observations", r._id)), sourceIds: ["listings"] });
  scope.add({ tool: "comparableListings", claim: "Distance to nearest comparable listing", value: rows[0].distM, unit: "m",
    context: { straightLine: true }, refs: [ref("rental_observations", rows[0]._id)], sourceIds: ["listings"] });
  return envelope({
    scope, data: { comparables: rows },
    coverage: { geoMatch: "radius", confidence: confidenceFromN(rows.length), n: rows.length },
    warnings: ["Distances are straight-line."],
  });
}

/** Unsorted radius count with $geoWithin + $centerSphere (works in countDocuments, unlike $near). */
export function countWithin(db, collection, { lng, lat, radiusM }, extra = {}) {
  const pt = point(lng, lat);
  return db.collection(collection).countDocuments({
    ...extra,
    geo: { $geoWithin: { $centerSphere: [pt.coordinates, metresToRadians(radiusM)] } },
  });
}

// Rent intelligence: benchmark, zone comparables, trend, listing distribution.
import { point } from "../lib/geo.js";
import { envelope, noData, confidenceFromN } from "../lib/envelope.js";
import { pickIndexMeasure, resolveRtbZone, INDEX_MEASURES, INDEX_MEASURE_LABEL } from "../lib/zones.js";

const ref = (collection, docId) => ({ collection, docId: String(docId) });
const pctOf = (a, b) => ({ $round: [{ $multiply: [{ $divide: [{ $subtract: [a, b] }, b] }, 100] }, 1] });

/** Op 2. Asking rent vs the latest RTB index cell for the property's rent zone. */
export async function benchmarkRent(db, { rtbZoneId, propertyType, bedrooms, askingRent, measure }, ledger) {
  const scope = ledger.scope();
  measure = measure ?? await pickIndexMeasure(db, { areaId: rtbZoneId, propertyType, bedrooms });
  if (!measure) return noData(scope, `No RTB rent data for ${rtbZoneId}, ${bedrooms ?? "all"}-bed ${propertyType}.`);
  const [r] = await db.collection("rental_indexes").aggregate([
    { $match: { areaId: rtbZoneId, measure, propertyType, bedrooms } },
    { $sort: { periodStart: -1 } }, { $limit: 1 },
    { $project: { periodLabel: 1, mean: "$avgRent", n: "$sampleSize", se: "$stdError", src: 1 } },
    { $set: {
      asking: askingRent,
      diffEur: { $round: [{ $subtract: [askingRent, "$mean"] }, 2] },
      diffPct: pctOf(askingRent, "$mean"),
      areaMeanCI95: { $cond: [{ $gt: ["$se", 0] }, [
        { $round: [{ $subtract: ["$mean", { $multiply: [1.96, "$se"] }] }, 1] },
        { $round: [{ $add: ["$mean", { $multiply: [1.96, "$se"] }] }, 1] }], null] },
    } },
    { $set: { band: { $switch: { branches: [
      { case: { $gt: ["$diffPct", 15] }, then: "well_above_average" },
      { case: { $gt: ["$diffPct", 5] }, then: "above_average" },
      { case: { $gte: ["$diffPct", -5] }, then: "in_line" }], default: "below_average" } } } },
  ]).toArray();
  if (!r) return noData(scope, `No RTB index cell for ${rtbZoneId}, ${bedrooms}-bed ${propertyType}.`);
  const ctx = { areaLevel: rtbZoneId.startsWith("county:") ? "county" : "rtb_zone", areaId: rtbZoneId, period: r.periodLabel, sampleSize: r.n, bedrooms, propertyType, measure };
  const refs = [ref("rental_indexes", r._id)];
  const what = measure === "index_mean" ? "RTB mean rent" : "RTB average registered rent";
  scope.add({ tool: "benchmarkRent", claim: `Latest ${what}, ${bedrooms ?? "all"}-bed ${propertyType}, ${rtbZoneId}`, value: r.mean, unit: "EUR/month", context: ctx, refs, sourceIds: [r.src.sourceId] });
  scope.add({ tool: "benchmarkRent", claim: `Asking rent vs ${measure === "index_mean" ? "RTB area mean" : "RTB area average"}`, value: r.diffPct, unit: "pct", context: ctx, refs, sourceIds: [r.src.sourceId] });
  scope.add({ tool: "benchmarkRent", claim: "Asking rent band vs RTB area figure (>15 well above, >5 above, >=-5 in line)", value: r.band, context: ctx, refs, sourceIds: [r.src.sourceId] });
  return envelope({
    scope, data: { ...r, measure, measureLabel: INDEX_MEASURE_LABEL[measure] },
    coverage: { geoMatch: "rtb_zone", dataAsOf: r.periodLabel, n: r.n, confidence: r.n == null ? "medium" : confidenceFromN(r.n) },
    warnings: [
      "The RTB figure is an area average, not a valuation of this specific property. The interval (if shown) is for the area mean.",
      ...(measure === "registered_average" ? ["This is the average rent of newly registered tenancies in the area (not the standardised RTB/ESRI index), with no sample size published."] : []),
    ],
  });
}

/** Op 3. Compare against surrounding RTB zones ($geoNear on zone centroids + $lookup). */
export async function zoneComparables(db, { lng, lat, propertyType, bedrooms, askingRent, maxDistanceM = 6000, measure, level = "rtb_zone" }, ledger) {
  const scope = ledger.scope();
  const pt = point(lng, lat);
  const asking = askingRent ?? null;
  const available = await db.collection("rental_indexes").distinct("measure", { propertyType, bedrooms });
  measure = measure ?? INDEX_MEASURES.find((m) => available.includes(m));
  if (!measure) return noData(scope, `No RTB rent data for ${bedrooms ?? "all"}-bed ${propertyType}.`);
  const [r] = await db.collection("areas").aggregate([
    { $geoNear: { near: pt, key: "centroid", distanceField: "distM", maxDistance: maxDistanceM, spherical: true, query: { level } } },
    { $lookup: { from: "rental_indexes", let: { id: "$_id" }, as: "cell", pipeline: [
      { $match: { $expr: { $eq: ["$areaId", "$$id"] }, measure, propertyType, bedrooms } },
      { $sort: { periodStart: -1 } }, { $limit: 1 }] } },
    { $unwind: "$cell" },
    { $group: { _id: null,
      zones: { $push: { areaId: "$_id", name: "$name", distKm: { $round: [{ $divide: ["$distM", 1000] }, 1] }, rent: "$cell.avgRent", period: "$cell.periodLabel", cellId: "$cell._id" } },
      mean: { $avg: "$cell.avgRent" }, sd: { $stdDevPop: "$cell.avgRent" },
      median: { $median: { input: "$cell.avgRent", method: "approximate" } },
      quartiles: { $percentile: { input: "$cell.avgRent", p: [0.25, 0.75], method: "approximate" } },
      min: { $min: "$cell.avgRent" }, max: { $max: "$cell.avgRent" }, n: { $sum: 1 } } },
    { $set: {
      zScore: { $cond: [{ $and: [{ $ne: [asking, null] }, { $gt: ["$sd", 0] }] }, { $round: [{ $divide: [{ $subtract: [asking, "$mean"] }, "$sd"] }, 2] }, null] },
      zonesCheaper: { $cond: [{ $ne: [asking, null] }, { $size: { $filter: { input: "$zones", cond: { $lt: ["$$this.rent", asking] } } } }, null] },
      mean: { $round: ["$mean", 1] }, sd: { $round: ["$sd", 1] },
    } },
    { $project: { _id: 0 } },
  ]).toArray();
  if (!r) return noData(scope, `No RTB zones with data within ${maxDistanceM} m.`);
  const ctx = { areaLevel: level, maxDistanceM, bedrooms, propertyType, zones: r.n, measure };
  const refs = r.zones.map((z) => ref("rental_indexes", z.cellId));
  scope.add({ tool: "zoneComparables", claim: `Median ${INDEX_MEASURE_LABEL[measure]} across ${r.n} surrounding ${level === "county" ? "counties" : "places"}`, value: r.median, unit: "EUR/month", context: ctx, refs, sourceIds: [measure === "index_mean" ? "rtb_rent_index" : "cso_riq02"] });
  if (r.zScore != null) scope.add({ tool: "zoneComparables", claim: "Asking rent z-score vs surrounding zones", value: r.zScore, unit: "sd", context: ctx, refs, sourceIds: [measure === "index_mean" ? "rtb_rent_index" : "cso_riq02"] });
  if (r.zonesCheaper != null) scope.add({ tool: "zoneComparables", claim: `Surrounding zones with a lower average rent than the asking rent (of ${r.n})`, value: r.zonesCheaper, unit: "count", context: ctx, refs, sourceIds: [measure === "index_mean" ? "rtb_rent_index" : "cso_riq02"] });
  return envelope({
    scope, data: r,
    coverage: { geoMatch: "rtb_zone", n: r.n, confidence: confidenceFromN(r.n, { low: 4, high: 8 }) },
    warnings: ["Zones are compared by centroid distance. z-score is across zone averages, not individual properties."],
  });
}

/** Op 4. Official-index trend (quarterly) with window functions. Gap-safe: missing quarters are densified before any look-back. */
export async function rentTrend(db, { rtbZoneId, propertyType, bedrooms, sinceYears = 3, measure }, ledger) {
  const scope = ledger.scope();
  measure = measure ?? await pickIndexMeasure(db, { areaId: rtbZoneId, propertyType, bedrooms });
  if (!measure) return noData(scope, `No rent history for ${rtbZoneId}, ${bedrooms ?? "all"}-bed ${propertyType}.`);
  const since = new Date(); since.setUTCFullYear(since.getUTCFullYear() - sinceYears);
  const label = { $concat: [{ $toString: { $year: "$periodStart" } }, "Q", { $toString: { $add: [{ $floor: { $divide: [{ $subtract: [{ $month: "$periodStart" }, 1] }, 3] } }, 1] } }] };
  const [r] = await db.collection("rental_indexes").aggregate([
    { $match: { areaId: rtbZoneId, measure, propertyType, bedrooms, periodStart: { $gte: since } } },
    { $project: { periodStart: 1, periodLabel: 1, avgRent: 1 } },
    // RTB/CSO series have gaps (suppressed cells). Make every quarter present so "4 documents back" means "4 quarters back".
    { $densify: { field: "periodStart", range: { step: 1, unit: "quarter", bounds: "full" } } },
    { $set: { avgRent: { $ifNull: ["$avgRent", null] }, periodLabel: { $ifNull: ["$periodLabel", label] } } },
    { $setWindowFields: { sortBy: { periodStart: 1 }, output: {
      prevQ: { $shift: { output: "$avgRent", by: -1 } },
      prevY: { $shift: { output: "$avgRent", by: -4 } },
      ma4: { $avg: "$avgRent", window: { documents: [-3, 0] } },
    } } },
    { $set: {
      qoqPct: { $cond: [{ $and: [{ $ne: ["$avgRent", null] }, { $gt: ["$prevQ", 0] }] }, pctOf("$avgRent", "$prevQ"), null] },
      yoyPct: { $cond: [{ $and: [{ $ne: ["$avgRent", null] }, { $gt: ["$prevY", 0] }] }, pctOf("$avgRent", "$prevY"), null] },
    } },
    { $sort: { periodStart: 1 } },
    { $group: { _id: null,
      series: { $push: { period: "$periodLabel", rent: "$avgRent", ma4: { $cond: [{ $ne: ["$avgRent", null] }, { $round: ["$ma4", 0] }, null] }, yoyPct: "$yoyPct" } },
      qoq: { $push: "$qoqPct" }, ids: { $push: { $cond: [{ $ne: ["$avgRent", null] }, "$_id", null] } } } },
    { $set: {
      real: { $filter: { input: "$series", cond: { $ne: ["$$this.rent", null] } } },
      ids: { $filter: { input: "$ids", cond: { $ne: ["$$this", null] } } },
    } },
    { $set: {
      n: { $size: "$real" }, gaps: { $subtract: [{ $size: "$series" }, { $size: "$real" }] },
      first: { $first: "$real.rent" }, latest: { $last: "$real.rent" }, latestYoY: { $last: "$real.yoyPct" },
      avgQoQ: { $round: [{ $avg: "$qoq" }, 2] }, peak: { $max: "$real.rent" },
    } },
    { $set: {
      totalChangePct: pctOf("$latest", "$first"),
      direction: { $switch: { branches: [
        { case: { $eq: ["$avgQoQ", null] }, then: "unknown" },
        { case: { $gt: ["$avgQoQ", 0.5] }, then: "rising" },
        { case: { $lt: ["$avgQoQ", -0.5] }, then: "falling" }], default: "flat" } },
    } },
    { $project: { _id: 0, qoq: 0, real: 0 } },
  ]).toArray();
  if (!r || !r.n) return noData(scope, `No rent history for ${rtbZoneId}.`);
  const realPts = r.series.filter((p) => p.rent != null);
  const ctx = { areaLevel: rtbZoneId.startsWith("county:") ? "county" : "rtb_zone", areaId: rtbZoneId, measure, from: realPts[0].period, to: realPts.at(-1).period, quarters: r.n };
  const refs = [ref("rental_indexes", r.ids[0]), ref("rental_indexes", r.ids.at(-1))];
  const what = INDEX_MEASURE_LABEL[measure];
  scope.add({ tool: "rentTrend", claim: `Change in ${what} over ${r.n} quarters (${ctx.from} to ${ctx.to})`, value: r.totalChangePct, unit: "pct", context: ctx, refs, sourceIds: [measure === "index_mean" ? "rtb_rent_index" : "cso_riq02"] });
  if (r.latestYoY != null) scope.add({ tool: "rentTrend", claim: "Latest year-on-year rent change", value: r.latestYoY, unit: "pct", context: ctx, refs, sourceIds: [measure === "index_mean" ? "rtb_rent_index" : "cso_riq02"] });
  scope.add({ tool: "rentTrend", claim: "Direction of rent trend (avg quarterly change >0.5 rising, <-0.5 falling)", value: r.direction, context: ctx, refs, sourceIds: [measure === "index_mean" ? "rtb_rent_index" : "cso_riq02"] });
  const { ids, ...data } = r;
  return envelope({
    scope, data: { ...data, measure, measureLabel: what },
    coverage: { geoMatch: "rtb_zone", n: r.n, dataAsOf: ctx.to, confidence: r.n >= 8 ? "high" : r.n >= 4 ? "medium" : "low" },
    warnings: r.gaps ? [`${r.gaps} quarter(s) have no published figure; they are shown as gaps and year-on-year changes skip them.`] : [],
  });
}

/** Op 8. Listing distribution near the property (needs a listings source). */
export async function listingMarket(db, { lng, lat, propertyType, bedrooms, askingRent, radiusM = 1500, sinceMonths = 6,
  boundaries = [0, 1800, 2100, 2400, 2700, 3000] }, ledger) {
  const scope = ledger.scope();
  const pt = point(lng, lat);
  const since = new Date(); since.setUTCMonth(since.getUTCMonth() - sinceMonths);
  const asking = askingRent ?? Infinity;
  const [r] = await db.collection("rental_observations").aggregate([
    { $geoNear: { near: pt, key: "geo", distanceField: "distM", maxDistance: radiusM, spherical: true,
      query: { measure: "advertised", propertyType, bedrooms, observedAt: { $gte: since } } } },
    { $facet: {
      stats: [{ $group: { _id: null, n: { $sum: 1 }, mean: { $avg: "$rent.amount" },
        median: { $median: { input: "$rent.amount", method: "approximate" } },
        quartiles: { $percentile: { input: "$rent.amount", p: [0.25, 0.75], method: "approximate" } },
        medianPerM2: { $median: { input: { $cond: [{ $gt: ["$floorAreaM2", 0] }, { $divide: ["$rent.amount", "$floorAreaM2"] }, null] }, method: "approximate" } } } }],
      distribution: [{ $bucket: { groupBy: "$rent.amount", boundaries, default: `${boundaries.at(-1)}+`, output: { n: { $sum: 1 } } } }],
      askingRank: [{ $group: { _id: null, n: { $sum: 1 }, atOrBelow: { $sum: { $cond: [{ $lte: ["$rent.amount", asking] }, 1, 0] } } } }],
      nearest: [{ $sort: { distM: 1 } }, { $limit: 5 }, { $project: { address: 1, "rent.amount": 1, floorAreaM2: 1, distM: { $round: ["$distM", 0] } } }],
    } },
  ]).toArray();
  const s = r.stats[0];
  if (!s) return noData(scope, `No listings within ${radiusM} m.`, { geoMatch: "radius" });
  const rk = r.askingRank[0];
  const ctx = { radiusM, sinceMonths, bedrooms, propertyType, n: s.n, areaLevel: "point" };
  const refs = r.nearest.map((x) => ref("rental_observations", x._id));
  scope.add({ tool: "listingMarket", claim: `Median asking rent of ${s.n} nearby listings`, value: s.median, unit: "EUR/month", context: ctx, refs, sourceIds: ["listings"] });
  if (askingRent) scope.add({ tool: "listingMarket", claim: "Asking rent percentile among nearby listings", value: Math.round((rk.atOrBelow / rk.n) * 100), unit: "percentile", context: ctx, refs, sourceIds: ["listings"] });
  return envelope({
    scope, data: { stats: s, distribution: r.distribution, askingRank: askingRent ? rk : null, nearest: r.nearest },
    coverage: { geoMatch: "radius", n: s.n, confidence: confidenceFromN(s.n) },
    warnings: s.n < 8 ? ["Fewer than 8 listings: treat the median and percentile as indicative only."] : [],
  });
}

/** Point -> the RTB rent place used for official rent figures, with an honest account of how it was matched. */
export async function locateRentArea(db, { lng, lat, propertyType, bedrooms, maxDistanceM }, ledger) {
  const scope = ledger.scope();
  const pt = point(lng, lat);
  const z = await resolveRtbZone(db, pt, { propertyType, bedrooms, ...(maxDistanceM && { maxDistanceM }) });
  if (!z.zoneId) return noData(scope, `No RTB rent place with recent data for ${bedrooms ?? "all"}-bed ${propertyType ?? "all types"} within reach${z.nearestM ? ` (nearest place is ${z.nearestM} m away but has no figure)` : ""}.`, { geoMatch: "none" });
  const exact = z.method === "small_area_parent", county = z.level === "county";
  scope.add({ tool: "locateRentArea", claim: `RTB rent area used for this property: ${z.zoneName ?? z.zoneId}${exact ? "" : county ? ` (COUNTY-wide average; no nearer place has a figure; centroid ${z.distM} m away)` : ` (nearest place with data, ${z.distM} m away)`}`, value: z.zoneId,
    context: { areaLevel: z.level, areaId: z.zoneId, method: z.method, ...(z.distM != null && { distanceM: z.distM }), bedrooms, propertyType }, refs: [ref("areas", z.zoneId)], sourceIds: ["cso_riq02"] });
  const warnings = exact ? [] : county ? [`No town or neighbourhood near this property has a published figure for this bedroom/type, so the ${z.zoneName} COUNTY-wide average is used. It is much coarser than a local figure and not comparable with neighbourhood figures.`] : [`The rent area was matched to the nearest published place that has a figure (${z.zoneName}, ${z.distM} m away${z.skippedNearer?.length ? `; ${z.skippedNearer.length} nearer place(s) have no figure for this bedroom/type` : ""}). Place locations are geocoded centroids, so this is approximate.`];
  return envelope({ scope, data: z, coverage: { geoMatch: exact ? "rtb_zone" : county ? "county" : "nearest_place", confidence: exact ? "high" : county ? "low" : z.distM <= 5000 ? "medium" : "low" }, warnings });
}

/**
 * One call for the official-rent picture at a point: which place, how the asking rent compares, which way rents are moving,
 * and how the surrounding places compare. Everything computed in MongoDB from rental_indexes.
 */
export async function rentContext(db, { lng, lat, propertyType, bedrooms, askingRent, sinceYears = 5 }, ledger) {
  const scope = ledger.scope();
  const loc = await locateRentArea(db, { lng, lat, propertyType, bedrooms }, ledger);
  scope.items.push(...loc.evidence);
  if (!loc.data) return noData(scope, loc.warnings[0], { geoMatch: "none" });
  const zoneId = loc.data.zoneId;
  const bench = askingRent ? await benchmarkRent(db, { rtbZoneId: zoneId, propertyType, bedrooms, askingRent }, ledger) : null;
  const trend = await rentTrend(db, { rtbZoneId: zoneId, propertyType, bedrooms, sinceYears }, ledger);
  const level = loc.data.level === "county" ? "county" : "rtb_zone";
  const around = await zoneComparables(db, { lng, lat, propertyType, bedrooms, askingRent, level, maxDistanceM: level === "county" ? 120000 : 15000 }, ledger);
  for (const r of [bench, trend, around]) if (r) scope.items.push(...r.evidence);
  return envelope({
    scope,
    data: { area: loc.data, benchmark: bench?.data ?? null, trend: trend.data, surrounding: around.data },
    coverage: { geoMatch: loc.coverage.geoMatch, dataAsOf: trend.coverage.dataAsOf, confidence: loc.coverage.confidence },
    warnings: [...loc.warnings, ...(bench?.warnings ?? []), ...trend.warnings, ...around.warnings],
  });
}

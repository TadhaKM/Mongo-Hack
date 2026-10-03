// Rent intelligence: benchmark, zone comparables, trend, listing distribution.
import { point } from "../lib/geo.js";
import { envelope, noData, confidenceFromN } from "../lib/envelope.js";

const ref = (collection, docId) => ({ collection, docId: String(docId) });
const pctOf = (a, b) => ({ $round: [{ $multiply: [{ $divide: [{ $subtract: [a, b] }, b] }, 100] }, 1] });

/** Op 2. Asking rent vs the latest RTB index cell for the property's rent zone. */
export async function benchmarkRent(db, { rtbZoneId, propertyType, bedrooms, askingRent }, ledger) {
  const scope = ledger.scope();
  const [r] = await db.collection("rental_indexes").aggregate([
    { $match: { areaId: rtbZoneId, measure: "index_mean", propertyType, bedrooms } },
    { $sort: { periodStart: -1 } }, { $limit: 1 },
    { $project: { periodLabel: 1, mean: "$avgRent", n: "$sampleSize", se: "$stdError", src: 1 } },
    { $set: {
      asking: askingRent,
      diffEur: { $subtract: [askingRent, "$mean"] },
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
  const ctx = { areaLevel: "rtb_zone", areaId: rtbZoneId, period: r.periodLabel, sampleSize: r.n, bedrooms, propertyType };
  const refs = [ref("rental_indexes", r._id)];
  scope.add({ tool: "benchmarkRent", claim: `Latest RTB mean rent, ${bedrooms}-bed ${propertyType}, ${rtbZoneId}`, value: r.mean, unit: "EUR/month", context: ctx, refs, sourceIds: [r.src.sourceId] });
  scope.add({ tool: "benchmarkRent", claim: "Asking rent vs RTB area mean", value: r.diffPct, unit: "pct", context: ctx, refs, sourceIds: [r.src.sourceId] });
  scope.add({ tool: "benchmarkRent", claim: "Asking rent band vs RTB area mean (>15 well above, >5 above, >=-5 in line)", value: r.band, context: ctx, refs, sourceIds: [r.src.sourceId] });
  return envelope({
    scope, data: r,
    coverage: { geoMatch: "rtb_zone", dataAsOf: r.periodLabel, n: r.n, confidence: confidenceFromN(r.n) },
    warnings: ["The RTB figure is an area average, not a valuation of this specific property. The interval is for the area mean."],
  });
}

/** Op 3. Compare against surrounding RTB zones ($geoNear on zone centroids + $lookup). */
export async function zoneComparables(db, { lng, lat, propertyType, bedrooms, askingRent, maxDistanceM = 6000 }, ledger) {
  const scope = ledger.scope();
  const pt = point(lng, lat);
  const asking = askingRent ?? null;
  const [r] = await db.collection("areas").aggregate([
    { $geoNear: { near: pt, key: "centroid", distanceField: "distM", maxDistance: maxDistanceM, spherical: true, query: { level: "rtb_zone" } } },
    { $lookup: { from: "rental_indexes", let: { id: "$_id" }, as: "cell", pipeline: [
      { $match: { $expr: { $eq: ["$areaId", "$$id"] }, measure: "index_mean", propertyType, bedrooms } },
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
  const ctx = { areaLevel: "rtb_zone", maxDistanceM, bedrooms, propertyType, zones: r.n };
  const refs = r.zones.map((z) => ref("rental_indexes", z.cellId));
  scope.add({ tool: "zoneComparables", claim: `Median RTB mean rent across ${r.n} surrounding zones`, value: r.median, unit: "EUR/month", context: ctx, refs, sourceIds: ["rtb_rent_index"] });
  if (r.zScore != null) scope.add({ tool: "zoneComparables", claim: "Asking rent z-score vs surrounding zones", value: r.zScore, unit: "sd", context: ctx, refs, sourceIds: ["rtb_rent_index"] });
  if (r.zonesCheaper != null) scope.add({ tool: "zoneComparables", claim: `Surrounding zones with a lower mean rent than the asking rent (of ${r.n})`, value: r.zonesCheaper, unit: "count", context: ctx, refs, sourceIds: ["rtb_rent_index"] });
  return envelope({
    scope, data: r,
    coverage: { geoMatch: "rtb_zone", n: r.n, confidence: confidenceFromN(r.n, { low: 4, high: 8 }) },
    warnings: ["Zones are compared by centroid distance. z-score is across zone averages, not individual properties."],
  });
}

/** Op 4. Rental trend with window functions. */
export async function rentTrend(db, { rtbZoneId, propertyType, bedrooms, sinceYears = 3 }, ledger) {
  const scope = ledger.scope();
  const since = new Date(); since.setUTCFullYear(since.getUTCFullYear() - sinceYears);
  const [r] = await db.collection("rental_indexes").aggregate([
    { $match: { areaId: rtbZoneId, measure: "index_mean", propertyType, bedrooms, periodStart: { $gte: since } } },
    { $setWindowFields: { sortBy: { periodStart: 1 }, output: {
      prevQ: { $shift: { output: "$avgRent", by: -1 } },
      prevY: { $shift: { output: "$avgRent", by: -4 } },
      ma4: { $avg: "$avgRent", window: { documents: [-3, 0] } },
    } } },
    { $set: {
      qoqPct: { $cond: [{ $gt: ["$prevQ", 0] }, pctOf("$avgRent", "$prevQ"), null] },
      yoyPct: { $cond: [{ $gt: ["$prevY", 0] }, pctOf("$avgRent", "$prevY"), null] },
    } },
    { $sort: { periodStart: 1 } },
    { $group: { _id: null,
      series: { $push: { period: "$periodLabel", rent: "$avgRent", ma4: { $round: ["$ma4", 0] }, yoyPct: "$yoyPct" } },
      first: { $first: "$avgRent" }, latest: { $last: "$avgRent" }, latestYoY: { $last: "$yoyPct" },
      avgQoQ: { $avg: "$qoqPct" }, peak: { $max: "$avgRent" }, n: { $sum: 1 }, ids: { $push: "$_id" } } },
    { $set: {
      totalChangePct: pctOf("$latest", "$first"),
      avgQoQ: { $round: ["$avgQoQ", 2] },
      direction: { $switch: { branches: [
        { case: { $eq: ["$avgQoQ", null] }, then: "unknown" },
        { case: { $gt: ["$avgQoQ", 0.5] }, then: "rising" },
        { case: { $lt: ["$avgQoQ", -0.5] }, then: "falling" }], default: "flat" } },
    } },
    { $project: { _id: 0 } },
  ]).toArray();
  if (!r) return noData(scope, `No rent history for ${rtbZoneId}.`);
  const ctx = { areaLevel: "rtb_zone", areaId: rtbZoneId, from: r.series[0].period, to: r.series.at(-1).period, quarters: r.n };
  const refs = [ref("rental_indexes", r.ids[0]), ref("rental_indexes", r.ids.at(-1))];
  scope.add({ tool: "rentTrend", claim: `Rent change over ${r.n} quarters (${ctx.from} to ${ctx.to})`, value: r.totalChangePct, unit: "pct", context: ctx, refs, sourceIds: ["rtb_rent_index"] });
  if (r.latestYoY != null) scope.add({ tool: "rentTrend", claim: "Latest year-on-year rent change", value: r.latestYoY, unit: "pct", context: ctx, refs, sourceIds: ["rtb_rent_index"] });
  scope.add({ tool: "rentTrend", claim: "Direction of rent trend (avg quarterly change >0.5 rising, <-0.5 falling)", value: r.direction, context: ctx, refs, sourceIds: ["rtb_rent_index"] });
  const { ids, ...data } = r;
  return envelope({ scope, data, coverage: { geoMatch: "rtb_zone", n: r.n, dataAsOf: ctx.to, confidence: r.n >= 8 ? "high" : r.n >= 4 ? "medium" : "low" } });
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

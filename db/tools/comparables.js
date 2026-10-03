// Comparable-rental engine. One aggregation per search step does: geo search -> hard filters ->
// distance -> deterministic score -> rank -> top N -> exact statistics -> target comparison.
// The AI receives the finished numbers and never computes any of them.
import { point } from "../lib/geo.js";
import { envelope, noData } from "../lib/envelope.js";
import { COMP_V1 } from "../config/comparableScoring.js";
import { rentTrend, benchmarkRent } from "./rent.js";
import { resolveRtbZone } from "../lib/zones.js";

const ref = (collection, docId) => ({ collection, docId: String(docId) });
const DAY = 864e5;

export function compatibleTypes(propertyType, cfg = COMP_V1) {
  if (!propertyType || propertyType === "all") return null; // no type filter
  const group = Object.values(cfg.typeGroups).find((g) => g.includes(propertyType));
  return group ?? [propertyType];
}

/** Exact percentile (linear interpolation, same as Excel PERCENTILE.INC) of an array expression. */
export function pctExpr(arr, p) {
  const at = (v) => ({ $arrayElemAt: ["$$s", v] });
  return {
    $let: {
      vars: { s: { $sortArray: { input: arr, sortBy: 1 } } },
      in: { $cond: [{ $eq: [{ $size: "$$s" }, 0] }, null, {
        $let: {
          vars: { pos: { $multiply: [{ $subtract: [{ $size: "$$s" }, 1] }, p] } },
          in: { $let: {
            vars: { lo: { $floor: "$$pos" }, hi: { $ceil: "$$pos" } },
            in: { $add: [at("$$lo"), { $multiply: [{ $subtract: [at("$$hi"), at("$$lo")] }, { $subtract: ["$$pos", "$$lo"] }] }] },
          } },
        },
      }] },
    },
  };
}

/**
 * Builds the aggregation for ONE search step. Exported so it can be run directly in mongosh/Compass.
 * @param {object} p {pt, bedrooms, types|null, targetType, monthlyRent|null, floorArea|null, analysisDate,
 *                    radiusM, windowDays, geo:{saId, edIds, leaIds}, excludeRecordId}
 */
export function buildComparablePipeline(p, cfg = COMP_V1) {
  const W = cfg.weights;
  const R = "$rents";
  const histStart = new Date(p.analysisDate.getTime() - cfg.historyMonths * 30.4375 * DAY);
  const rent = p.monthlyRent ?? null;
  const lit = (a) => ({ $literal: a });

  const query = {
    measure: p.measure ?? "advertised",                     // hard filter: one measurement type only
    "rent.amount": { $gt: 0 },
    bedrooms: p.bedrooms,                                  // hard filter: exact bedrooms
    ...(p.types && { propertyType: { $in: p.types } }),    // hard filter: compatible property type (when known)
    observedAt: { $gte: histStart, $lte: p.analysisDate }, // hard filter: no future observations
    ...(p.excludeRecordId && { "src.recordId": { $ne: p.excludeRecordId } }),
  };

  const factors = {
    distance: { $max: [0, { $subtract: [1, { $divide: ["$distM", cfg.distance.maxM] }] }] },
    recency: { $pow: [0.5, { $divide: ["$ageDays", cfg.recency.halfLifeDays] }] },
    floorArea: p.floorArea > 0
      ? { $cond: [{ $gt: ["$floorAreaM2", 0] },
        { $max: [0, { $subtract: [1, { $divide: [{ $divide: [{ $abs: { $subtract: ["$floorAreaM2", p.floorArea] } }, p.floorArea] }, cfg.floorArea.maxRelDiff] }] }] },
        cfg.floorArea.unknown] }
      : cfg.floorArea.unknown,
    type: p.targetType && p.targetType !== "all"
      ? { $cond: [{ $eq: ["$propertyType", p.targetType] }, cfg.type.sameType, cfg.type.compatibleType] }
      : cfg.type.unknown,
    area: { $switch: { branches: [
      { case: { $eq: ["$areaId", p.geo.saId] }, then: cfg.area.smallArea },
      { case: { $in: ["$areaId", lit(p.geo.edIds)] }, then: cfg.area.electoralDivision },
      { case: { $in: ["$areaId", lit(p.geo.leaIds)] }, then: cfg.area.lea }], default: cfg.area.outside } },
    quality: { $min: [1, { $max: [0, { $ifNull: ["$src.geoConfidence", cfg.quality.unknownGeoConfidence] }] }] },
  };

  const perM2 = { $filter: { input: { $map: { input: "$selected", in: { $cond: [{ $gt: ["$$this.floorAreaM2", 0] }, { $divide: ["$$this.rent", "$$this.floorAreaM2"] }, null] } } }, cond: { $ne: ["$$this", null] } } };
  const count = (tier) => ({ $size: { $filter: { input: "$selected", cond: { $eq: ["$$this.geoTier", tier] } } } });
  const rounded = (x, dp = 0) => ({ $round: [x, dp] });

  return [
    // 1. nearby observations (2dsphere), with the hard filters applied inside the index scan
    { $geoNear: { near: p.pt, key: "geo", distanceField: "distM", maxDistance: p.radiusM, spherical: true, query } },

    // 2. distance is already in distM (metres); age in whole days at the analysis date
    { $set: { ageDays: { $dateDiff: { startDate: "$observedAt", endDate: p.analysisDate, unit: "day" } } } },

    // 3. factor scores, each 0..1
    { $set: { f: factors,
      geoTier: { $switch: { branches: [
        { case: { $eq: ["$areaId", p.geo.saId] }, then: "small_area" },
        { case: { $in: ["$areaId", lit(p.geo.edIds)] }, then: "electoral_division" },
        { case: { $in: ["$areaId", lit(p.geo.leaIds)] }, then: "lea" }], default: "outside" } } } },

    // 4. composite score 0..100 (weights sum to 100)
    { $set: { score: rounded({ $add: Object.entries(W).map(([k, w]) => ({ $multiply: [w, `$f.${k}`] })) }, 1) } },

    // 5-8. rank, select strongest, and keep the full pool for history
    { $facet: {
      selected: [
        { $match: { ageDays: { $lte: p.windowDays }, score: { $gte: cfg.minScore } } },
        { $sort: { score: -1, distM: 1, observedAt: -1, _id: 1 } },   // total order => deterministic
        { $limit: cfg.maxComparables },
        { $project: {
          address: 1, rent: "$rent.amount", distM: rounded("$distM"), observedAt: 1, ageDays: 1, floorAreaM2: 1,
          bedrooms: 1, propertyType: 1, areaId: 1, geoTier: 1, score: 1, recordId: "$src.recordId", sourceId: "$src.sourceId",
          rentPerM2: { $cond: [{ $gt: ["$floorAreaM2", 0] }, rounded({ $divide: ["$rent.amount", "$floorAreaM2"] }, 2), "$$REMOVE"] },
          deltaVsTarget: rent != null ? { $subtract: ["$rent.amount", rent] } : "$$REMOVE",
          factors: Object.fromEntries(Object.keys(W).map((k) => [k, rounded(`$f.${k}`, 2)])),
        } },
      ],
      history: [
        { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$observedAt" } }, n: { $sum: 1 }, avgRent: { $avg: "$rent.amount" }, minRent: { $min: "$rent.amount" }, maxRent: { $max: "$rent.amount" } } },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, month: "$_id", n: 1, avgRent: rounded("$avgRent"), minRent: 1, maxRent: 1 } },
      ],
      pool: [{ $count: "n" }],
    } },
    { $project: { selected: 1, history: 1, candidatePool: { $ifNull: [{ $first: "$pool.n" }, 0] } } },

    // 9. statistics: exact, computed from the selected set
    { $set: { n: { $size: "$selected" }, rents: "$selected.rent" } },
    { $set: { stats: {
      mean: rounded({ $avg: R }), median: rounded(pctExpr(R, 0.5)), min: { $min: R }, max: { $max: R },
      p25: rounded(pctExpr(R, 0.25)), p75: rounded(pctExpr(R, 0.75)), stdDev: rounded({ $stdDevSamp: R }, 1),
      weightedMean: { $cond: [{ $gt: [{ $sum: "$selected.score" }, 0] },
        rounded({ $divide: [{ $sum: { $map: { input: "$selected", in: { $multiply: ["$$this.score", "$$this.rent"] } } } }, { $sum: "$selected.score" }] }), null] },
    } } },
    { $set: {
      "stats.range": { $subtract: ["$stats.max", "$stats.min"] },
      "stats.iqr": { $subtract: ["$stats.p75", "$stats.p25"] },
      dateRange: { from: { $min: "$selected.observedAt" }, to: { $max: "$selected.observedAt" } },
      mostRecent: { $first: { $sortArray: { input: "$selected", sortBy: { observedAt: -1, score: -1, _id: 1 } } } },
      coverage: {
        radiusM: p.radiusM, windowDays: p.windowDays,
        nearestM: { $min: "$selected.distM" }, medianDistanceM: rounded(pctExpr("$selected.distM", 0.5)), farthestM: { $max: "$selected.distM" },
        distinctSmallAreas: { $size: { $setUnion: ["$selected.areaId", []] } },
        byTier: { small_area: count("small_area"), electoral_division: count("electoral_division"), lea: count("lea"), outside: count("outside") },
      },
      perSquareMetre: { comparablesWithFloorArea: { $size: perM2 }, medianRentPerM2: rounded(pctExpr(perM2, 0.5), 2),
        targetRentPerM2: rent != null && p.floorArea > 0 ? rounded(rent / p.floorArea, 2) : null },
    } },
    { $set: {
      "stats.outlierCount": { $size: { $filter: { input: R, cond: { $or: [
        { $lt: ["$$this", { $subtract: ["$stats.p25", { $multiply: [1.5, "$stats.iqr"] }] }] },
        { $gt: ["$$this", { $add: ["$stats.p75", { $multiply: [1.5, "$stats.iqr"] }] }] }] } } } },
      target: rent == null ? null : { $cond: [{ $gt: ["$n", 0] }, {
        monthlyRent: rent,
        differenceFromMedian: { $subtract: [rent, "$stats.median"] },
        percentageDifference: rounded({ $multiply: [{ $divide: [{ $subtract: [rent, "$stats.median"] }, "$stats.median"] }, 100] }, 1),
        differenceFromMean: { $subtract: [rent, "$stats.mean"] },
        percentileRank: rounded({ $multiply: [{ $divide: [{ $size: { $filter: { input: R, cond: { $lte: ["$$this", rent] } } } }, "$n"] }, 100] }),
        position: { $switch: { branches: [
          { case: { $lt: [rent, "$stats.min"] }, then: "below_all_comparables" },
          { case: { $lte: [rent, "$stats.p25"] }, then: "lower_quartile" },
          { case: { $lte: [rent, "$stats.p75"] }, then: "interquartile_range" },
          { case: { $lte: [rent, "$stats.max"] }, then: "upper_quartile" }], default: "above_all_comparables" } },
      }, null] },
    } },
    { $project: { rents: 0 } },
  ];
}

async function resolveGeo(db, pt) {
  const sa = await db.collection("areas").findOne(
    { level: "small_area", geometry: { $geoIntersects: { $geometry: pt } } }, { projection: { parents: 1, name: 1 } });
  if (!sa) return { saId: null, edIds: [], leaIds: [], parents: null };
  const ids = async (field, v) => v
    ? (await db.collection("areas").find({ level: "small_area", [field]: v }, { projection: { _id: 1 } }).toArray()).map((d) => d._id)
    : [];
  return {
    saId: sa._id, name: sa.name, parents: sa.parents,
    edIds: await ids("parents.electoral_division", sa.parents?.electoral_division),
    leaIds: await ids("parents.lea", sa.parents?.lea),
  };
}

function validate(input) {
  const { latitude, longitude, bedrooms, propertyType, monthlyRent, floorArea, analysisDate, measure = "advertised" } = input;
  const pt = point(Number(longitude), Number(latitude));
  if (!Number.isInteger(bedrooms) || bedrooms < 0 || bedrooms > 5) throw new RangeError("bedrooms must be an integer 0-5");
  if (!["advertised", "registered"].includes(measure)) throw new RangeError("measure must be 'advertised' or 'registered'");
  if (monthlyRent != null && !(monthlyRent > 0)) throw new RangeError("monthlyRent must be > 0");
  if (floorArea != null && !(floorArea > 0)) throw new RangeError("floorArea must be > 0 (square metres)");
  const date = analysisDate ? new Date(analysisDate) : new Date();
  if (Number.isNaN(date.getTime())) throw new RangeError("analysisDate is not a valid date");
  return { pt, date, measure, bedrooms, propertyType: propertyType ?? null, monthlyRent: monthlyRent ?? null, floorArea: floorArea ?? null };
}

const WITHHELD = (n) => ({ stats: null, reason: `Only ${n} comparable(s): below the ${COMP_V1.status.insufficientBelow} needed to publish statistics.` });

/**
 * Tool: rentalComparables
 * Input: { latitude, longitude, bedrooms, propertyType, monthlyRent, floorArea, analysisDate }
 */
export async function rentalComparables(db, input, ledger, cfg = COMP_V1) {
  const scope = ledger.scope();
  const v = validate(input);
  const types = compatibleTypes(v.propertyType, cfg);
  const geo = await resolveGeo(db, v.pt);

  // Widen the search deterministically until there are enough comparables.
  const searchLog = [];
  let result = null;
  for (const step of cfg.ladder) {
    const pipeline = buildComparablePipeline({ pt: v.pt, bedrooms: v.bedrooms, types, targetType: v.propertyType, monthlyRent: v.monthlyRent,
      floorArea: v.floorArea, measure: v.measure, analysisDate: v.date, radiusM: step.radiusM, windowDays: step.windowDays, geo, excludeRecordId: input.excludeRecordId }, cfg);
    [result] = await db.collection("rental_observations").aggregate(pipeline).toArray();
    searchLog.push({ radiusM: step.radiusM, windowDays: step.windowDays, candidatePool: result.candidatePool, comparables: result.n });
    if (result.n >= cfg.minComparables) break;
  }
  searchLog.at(-1).accepted = true;

  const n = result.n;
  const status = n === 0 ? "none" : n < cfg.status.insufficientBelow ? "insufficient" : n < cfg.status.limitedBelow ? "limited" : "sufficient";
  const confidence = n >= cfg.confidence.highAt ? "high" : n >= cfg.confidence.mediumAt ? "medium" : n >= cfg.confidence.lowAt ? "low" : "none";
  const publish = n >= cfg.status.insufficientBelow;
  const s = result.stats, t = result.target;
  const last = searchLog.at(-1);
  const windowFrom = new Date(v.date.getTime() - last.windowDays * DAY);

  const warnings = [];
  if (status === "none") warnings.push("No comparable listings found even at the widest search. No market statistics are available from listings.");
  if (status === "insufficient") warnings.push(`Only ${n} comparable(s) found. Statistics are withheld; do not state a market median or range.`);
  if (status === "limited") warnings.push(`Only ${n} comparables. Treat statistics as indicative and say so.`);
  if (publish && last.radiusM > cfg.ladder[0].radiusM) warnings.push(`Search widened to ${last.radiusM} m / ${last.windowDays} days to reach enough comparables.`);
  if (publish && s.outlierCount > 0) warnings.push(`${s.outlierCount} comparable(s) are statistical outliers (outside 1.5 x IQR). They are included in the statistics.`);
  if (!geo.saId) warnings.push("Coordinates are not inside a loaded small area; geographic-area scoring is zero for all comparables.");
  if (v.floorArea == null) warnings.push("No floor area supplied: floor-area similarity is scored neutral (0.5).");
  if (v.propertyType == null) warnings.push("No property type supplied: property type was not filtered.");
  warnings.push(v.measure === "advertised"
    ? "Comparables are advertised (asking) rents, not agreed or registered rents. Distances are straight-line."
    : "Comparables are registered rents. They are never mixed with advertised rents. Distances are straight-line.");

  // Cross-check against the official RTB index when the zone is known.
  let rtbIndex = null;
  const zoneRes = geo.parents?.rtb_zone ? { zoneId: geo.parents.rtb_zone, method: "small_area_parent" } : await resolveRtbZone(db, v.pt, { propertyType: v.propertyType && v.propertyType !== "all" ? v.propertyType : undefined, bedrooms: v.bedrooms });
  const zone = zoneRes.zoneId, rtbType = v.propertyType && v.propertyType !== "all" ? v.propertyType : null;
  if (zone && rtbType) {
    const trend = await rentTrend(db, { rtbZoneId: zone, propertyType: rtbType, bedrooms: v.bedrooms, sinceYears: 3 }, ledger);
    const bench = v.monthlyRent ? await benchmarkRent(db, { rtbZoneId: zone, propertyType: rtbType, bedrooms: v.bedrooms, askingRent: v.monthlyRent }, ledger) : null;
    scope.items.push(...trend.evidence, ...(bench?.evidence ?? []));
    rtbIndex = { zone, zoneMethod: zoneRes.method, ...(zoneRes.distM != null && { zoneDistanceM: zoneRes.distM, zoneName: zoneRes.zoneName }), measure: (trend.data ?? bench?.data)?.measure ?? null, trend: trend.data && { from: trend.data.series[0].period, to: trend.data.series.at(-1).period, totalChangePct: trend.data.totalChangePct, latestYoY: trend.data.latestYoY, direction: trend.data.direction },
      benchmark: bench?.data && { period: bench.data.periodLabel, areaMean: bench.data.mean, diffPct: bench.data.diffPct, band: bench.data.band } };
  }

  if (zoneRes.method === "nearest_with_data") warnings.push(`The official rent cross-check uses ${zoneRes.zoneName}, the nearest published place with data (${zoneRes.distM} m away); this is approximate.`);
  const data = {
    status, confidence, scoringModel: cfg.version, measure: v.measure,
    comparableCount: n,
    medianRent: publish ? s.median : null,
    averageRent: publish ? s.mean : null,
    minRent: publish ? s.min : null,
    maxRent: publish ? s.max : null,
    rentRange: publish ? { min: s.min, max: s.max, spread: s.range, p25: s.p25, p75: s.p75, iqr: s.iqr } : null,
    weightedAverageRent: publish ? s.weightedMean : null,
    stdDev: publish ? s.stdDev : null,
    outlierCount: publish ? s.outlierCount : null,
    targetRent: v.monthlyRent,
    differenceFromMedian: publish && t ? t.differenceFromMedian : null,
    percentageDifference: publish && t ? t.percentageDifference : null,
    percentileRank: publish && t ? t.percentileRank : null,
    position: publish && t ? t.position : null,
    perSquareMetre: publish ? result.perSquareMetre : null,
    dateRange: n ? { from: result.dateRange.from, to: result.dateRange.to, searchWindow: { from: windowFrom, to: v.date, days: last.windowDays } } : { searchWindow: { from: windowFrom, to: v.date, days: last.windowDays } },
    mostRecent: result.mostRecent ?? null,
    coverage: n ? result.coverage : { radiusM: last.radiusM, windowDays: last.windowDays },
    history: { listingsByMonth: result.history, rtbIndex },
    search: { candidatePool: result.candidatePool, minScore: cfg.minScore, maxComparables: cfg.maxComparables, ladder: searchLog },
    comparables: result.selected,
    ...(!publish && { withheld: WITHHELD(n).reason }),
  };

  if (n === 0) {
    scope.add({ tool: "rentalComparables", claim: "Comparable listings found", value: 0, unit: "count",
      context: { areaLevel: "point", model: cfg.version, radiusM: last.radiusM, windowDays: last.windowDays }, refs: [], sourceIds: ["listings"] });
    return envelope({ scope, data, coverage: { geoMatch: "radius", n: 0, confidence: "none" }, warnings });
  }

  const sourceIds = [...new Set(result.selected.map((c) => c.sourceId))];
  const refs = result.selected.map((c) => ref("rental_observations", c._id));
  const ctx = { areaLevel: "point", model: cfg.version, n, radiusM: last.radiusM, windowDays: last.windowDays, minScore: cfg.minScore, measure: v.measure, bedrooms: v.bedrooms, propertyType: v.propertyType };
  const add = (claim, value, unit, extra = {}) => scope.add({ tool: "rentalComparables", claim, value, unit, context: { ...ctx, ...extra }, refs, sourceIds });
  add(`Comparable listings used (${v.bedrooms}-bed, within ${last.radiusM} m, last ${last.windowDays} days)`, n, "count");
  if (publish) {
    add("Median comparable asking rent", s.median, "EUR/month");
    add("Average comparable asking rent", s.mean, "EUR/month");
    add("Lowest comparable asking rent", s.min, "EUR/month");
    add("Highest comparable asking rent", s.max, "EUR/month");
    if (t) {
      add("Target rent minus median comparable rent", t.differenceFromMedian, "EUR/month");
      add("Target rent versus median comparable rent", t.percentageDifference, "pct");
      add("Share of comparables at or below the target rent", t.percentileRank, "percentile");
    }
  }
  add("Distance to nearest comparable", result.coverage.nearestM, "m", { straightLine: true });
  add("Date of most recent comparable", new Date(result.mostRecent.observedAt).toISOString().slice(0, 10), "date");

  return envelope({ scope, data, coverage: { geoMatch: "radius", n, dataAsOf: new Date(result.dateRange.to).toISOString().slice(0, 10), confidence }, warnings });
}

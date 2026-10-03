// Rental trends over time, computed in MongoDB from a time-series collection.
//
//   rental_observations        (regular, validated, unique)  = system of record and comparable engine
//   rental_observation_series  (time series, append-only)    = analytic copy for trend queries
//
// Series are never pooled across measure (advertised vs registered), bedrooms, property type, geography
// level or - unless asked - source. One call = one measure, one geographic scope, one period unit.
import { point } from "../lib/geo.js";
import { envelope, noData } from "../lib/envelope.js";
import { TREND_V1 } from "../config/trendConfig.js";
import { pctExpr } from "./comparables.js";
import { rentTrend as officialIndexTrend } from "./rent.js";

const ref = (collection, docId) => ({ collection, docId: String(docId) });
const MONTHS = { month: 1, quarter: 3, year: 12 };

// ---- period arithmetic (UTC) -------------------------------------------------------------------------------
export function startOfPeriod(date, unit) {
  const y = date.getUTCFullYear(), m = date.getUTCMonth();
  if (unit === "year") return new Date(Date.UTC(y, 0, 1));
  if (unit === "quarter") return new Date(Date.UTC(y, Math.floor(m / 3) * 3, 1));
  return new Date(Date.UTC(y, m, 1));
}
export function addPeriods(date, unit, n) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + n * MONTHS[unit], 1));
}

// ---- building and refreshing the time-series collection ---------------------------------------------------
/** Index definitions for the series collection. (Not in createIndexes.js: that would create a regular collection.) */
export const SERIES_INDEXES = [
  [{ "meta.measure": 1, "meta.leaId": 1, "meta.bedrooms": 1, "meta.propertyType": 1, observedAt: -1 }, { name: "lea_series" }],
  [{ "meta.measure": 1, areaId: 1, observedAt: -1 }, { name: "area_series" }],
  [{ geo: "2dsphere" }, { name: "geo" }],
];

/**
 * Rebuilds the series collection from rental_observations with a single $out.
 * Idempotent. The source collection is validated, so nothing unvalidated can enter the series.
 * Run after every load of historical or new observations.
 */
export async function rebuildObservationSeries(db, cfg = TREND_V1) {
  const { collection, timeseries } = cfg.series;
  try { await db.collection(collection).drop(); } catch (e) { if (e.codeName !== "NamespaceNotFound") throw e; }
  await db.collection("rental_observations").aggregate([
    { $lookup: { from: "areas", localField: "areaId", foreignField: "_id", as: "a", pipeline: [{ $project: { "parents.lea": 1 } }] } },
    { $project: {
      _id: 0,
      observedAt: 1,
      meta: {                                   // the series identity. Low-cardinality on purpose: ~10^4 series, not ~10^6
        measure: "$measure", sourceId: "$src.sourceId", propertyType: "$propertyType", bedrooms: "$bedrooms",
        leaId: { $ifNull: [{ $first: "$a.parents.lea" }, "unassigned"] },
      },
      rent: "$rent.amount", areaId: 1, geo: 1, floorAreaM2: 1,
      obsId: "$_id", recordId: "$src.recordId", version: "$src.version", retrievedAt: "$src.retrievedAt",
      geoConfidence: "$src.geoConfidence",
    } },
    { $out: { db: db.databaseName, coll: collection, timeseries } },
  ]).toArray();
  for (const [keys, opts] of SERIES_INDEXES) await db.collection(collection).createIndex(keys, opts);
  return db.collection(collection).estimatedDocumentCount();
}

// ---- the trend pipeline ------------------------------------------------------------------------------------
const labelExpr = (unit) => unit === "quarter"
  ? { $concat: [{ $toString: { $year: "$period" } }, "-Q", { $toString: { $add: [{ $floor: { $divide: [{ $subtract: [{ $month: "$period" }, 1] }, 3] } }, 1] } }] }
  : { $dateToString: { format: unit === "year" ? "%Y" : "%Y-%m", date: "$period" } };

const pctChange = (now, before) => ({ $round: [{ $multiply: [{ $divide: [{ $subtract: [now, before] }, before] }, 100] }, 1] });

/**
 * p = { measure, sourceId?, pool, bedrooms?, propertyType?, unit, from, reportFrom, to, analysisDate,
 *       scope: {type:"radius", center:Point, radiusM} | {type:"lea"|"small_area", id} }
 * `from` is the lookback start (reportFrom minus one year-on-year lag) so every reported period has its comparison period;
 * only periods >= reportFrom are returned. Output: one document per series (source x bedrooms x propertyType), dense and ordered.
 */
export function buildTrendPipeline(p, cfg = TREND_V1) {
  const { lag } = cfg.units[p.unit];
  const minN = cfg.minPerBucket;
  const filters = {
    "meta.measure": p.measure,                                    // never mixed: advertised vs registered
    ...(p.sourceId && { "meta.sourceId": p.sourceId }),
    ...(p.bedrooms != null && { "meta.bedrooms": p.bedrooms }),
    ...(p.propertyType && { "meta.propertyType": p.propertyType }),
    observedAt: { $gte: p.from, $lt: p.to },                      // whole periods only
  };
  // A time-series collection does not accept `query` inside $geoNear, so the filters follow as a $match.
  const first = p.scope.type === "radius"
    ? [{ $geoNear: { near: p.scope.center, key: "geo", distanceField: "distM", maxDistance: p.scope.radiusM, spherical: true } }, { $match: filters }]
    : [{ $match: { ...filters, ...(p.scope.type === "lea" ? { "meta.leaId": p.scope.id } : { areaId: p.scope.id }) } }];
  const key = { sourceId: "$sourceId", bedrooms: "$bedrooms", propertyType: "$propertyType" };
  const nullish = (f) => ({ [f]: { $ifNull: [`$${f}`, null] } });

  return [
    ...first,
    { $set: { period: { $dateTrunc: { date: "$observedAt", unit: p.unit, timezone: "UTC" } } } },

    // one row per series x period, with exact statistics and provenance
    { $group: {
      _id: { sourceId: p.pool ? "ALL" : "$meta.sourceId", bedrooms: "$meta.bedrooms", propertyType: "$meta.propertyType", period: "$period" },
      n: { $sum: 1 }, avg: { $avg: "$rent" }, rents: { $push: "$rent" }, min: { $min: "$rent" }, max: { $max: "$rent" },
      observedFrom: { $min: "$observedAt" }, observedTo: { $max: "$observedAt" },
      sources: { $addToSet: "$meta.sourceId" }, versions: { $addToSet: "$version" }, retrievedAt: { $max: "$retrievedAt" },
      recordIdSample: { $minN: { n: 3, input: "$recordId" } }, obsIdSample: { $minN: { n: 3, input: "$obsId" } },
    } },
    { $set: { sufficient: { $gte: ["$n", minN] } } },
    { $project: {
      _id: 0, sourceId: "$_id.sourceId", bedrooms: "$_id.bedrooms", propertyType: "$_id.propertyType", period: "$_id.period",
      n: 1, sufficient: 1, sources: 1, versions: 1, observedFrom: 1, observedTo: 1, retrievedAt: 1, recordIdSample: 1, obsIdSample: 1,
      // below the minimum sample the statistics are withheld, not estimated
      avgRent: { $cond: ["$sufficient", { $round: ["$avg", 0] }, null] },
      medianRent: { $cond: ["$sufficient", { $round: [pctExpr("$rents", 0.5), 0] }, null] },
      p25Rent: { $cond: ["$sufficient", { $round: [pctExpr("$rents", 0.25), 0] }, null] },
      p75Rent: { $cond: ["$sufficient", { $round: [pctExpr("$rents", 0.75), 0] }, null] },
      minRent: { $cond: ["$sufficient", "$min", null] }, maxRent: { $cond: ["$sufficient", "$max", null] },
    } },

    // make every period present in every series, so "12 documents back" really is "12 months back"
    { $densify: { field: "period", partitionByFields: ["sourceId", "bedrooms", "propertyType"], range: { step: 1, unit: p.unit, bounds: [p.from, p.to] } } },
    { $match: { sourceId: { $ne: null } } },   // with no data at all, $densify invents one all-null partition; drop it
    { $set: { n: { $ifNull: ["$n", 0] }, sufficient: { $ifNull: ["$sufficient", false] },
      ...Object.assign({}, ...["avgRent", "medianRent", "p25Rent", "p75Rent", "minRent", "maxRent"].map(nullish)) } },

    // year-on-year: compare with the same period `lag` units earlier, only if both are sufficient
    { $setWindowFields: { partitionBy: key, sortBy: { period: 1 }, output: {
      prevMedian: { $shift: { output: "$medianRent", by: -lag } },
      prevAvg: { $shift: { output: "$avgRent", by: -lag } },
    } } },
    { $set: {
      label: labelExpr(p.unit),
      complete: { $lt: ["$period", startOfPeriod(p.analysisDate, p.unit)] },
      yoyMedianPct: { $cond: [{ $and: [{ $ne: ["$medianRent", null] }, { $gt: ["$prevMedian", 0] }] }, pctChange("$medianRent", "$prevMedian"), null] },
      yoyAvgPct: { $cond: [{ $and: [{ $ne: ["$avgRent", null] }, { $gt: ["$prevAvg", 0] }] }, pctChange("$avgRent", "$prevAvg"), null] },
    } },

    // fold into one document per series
    { $sort: { sourceId: 1, bedrooms: 1, propertyType: 1, period: 1 } },
    { $group: {
      _id: key,
      points: { $push: {
        period: "$period", label: "$label", complete: "$complete", n: "$n", sufficient: "$sufficient",
        medianRent: "$medianRent", avgRent: "$avgRent", p25Rent: "$p25Rent", p75Rent: "$p75Rent", minRent: "$minRent", maxRent: "$maxRent",
        yoyMedianPct: "$yoyMedianPct", yoyAvgPct: "$yoyAvgPct",
        observedFrom: "$observedFrom", observedTo: "$observedTo", versions: "$versions", retrievedAt: "$retrievedAt",
        recordIdSample: "$recordIdSample", obsIdSample: "$obsIdSample" } },
      records: { $sum: "$n" },
      observedFrom: { $min: "$observedFrom" }, observedTo: { $max: "$observedTo" }, retrievedAt: { $max: "$retrievedAt" },
      srcLists: { $push: "$sources" }, verLists: { $push: "$versions" },
    } },
    // report only the requested window; the lookback periods were read for the comparison but are not returned as points
    { $set: { points: { $filter: { input: "$points", cond: { $gte: ["$$this.period", p.reportFrom] } } } } },
    { $set: { sufficientPeriods: { $size: { $filter: { input: "$points", cond: "$$this.sufficient" } } } } },
    { $set: {
      sourceIds: { $reduce: { input: "$srcLists", initialValue: [], in: { $setUnion: ["$$value", { $ifNull: ["$$this", []] }] } } },
      versions: { $reduce: { input: "$verLists", initialValue: [], in: { $setUnion: ["$$value", { $ifNull: ["$$this", []] }] } } },
      suff: { $filter: { input: "$points", cond: "$$this.sufficient" } },
    } },
    { $set: {
      firstMedian: { $first: "$suff.medianRent" }, latestMedian: { $last: "$suff.medianRent" },
      latestPeriod: { $last: "$suff.label" },
      latestYoY: { $last: { $filter: { input: "$suff", cond: { $ne: ["$$this.yoyMedianPct", null] } } } },
    } },
    { $set: {
      totalChangeMedianPct: { $cond: [{ $gt: ["$firstMedian", 0] }, pctChange("$latestMedian", "$firstMedian"), null] },
      latestYoYMedianPct: "$latestYoY.yoyMedianPct", latestYoYPeriod: "$latestYoY.label",
    } },
    { $set: { direction: { $switch: { branches: [
      { case: { $eq: ["$latestYoYMedianPct", null] }, then: "unknown" },
      { case: { $gt: ["$latestYoYMedianPct", cfg.directionPct] }, then: "rising" },
      { case: { $lt: ["$latestYoYMedianPct", -cfg.directionPct] }, then: "falling" }], default: "flat" } } } },
    { $project: { srcLists: 0, verLists: 0, suff: 0, latestYoY: 0, firstMedian: 0 } },
    { $sort: { "_id.sourceId": 1, "_id.bedrooms": 1, "_id.propertyType": 1 } },
  ];
}

// ---- the tool ------------------------------------------------------------------------------------------------
function validate(input, cfg) {
  const { unit = "month", measure = "advertised", bedrooms, propertyType, sourceId, pool = false, includeIncompletePeriod = false } = input;
  if (!cfg.units[unit]) throw new RangeError(`unit must be one of ${Object.keys(cfg.units).join(", ")}`);
  if (!["advertised", "registered"].includes(measure)) throw new RangeError("measure must be 'advertised' or 'registered'");
  if (bedrooms != null && !(Number.isInteger(bedrooms) && bedrooms >= 0 && bedrooms <= 5)) throw new RangeError("bedrooms must be an integer 0-5");
  const periods = input.periods ?? cfg.units[unit].defaultPeriods;
  if (!(Number.isInteger(periods) && periods >= 2 && periods <= cfg.units[unit].maxPeriods)) throw new RangeError(`periods must be an integer 2-${cfg.units[unit].maxPeriods} for unit '${unit}'`);
  const analysisDate = input.analysisDate ? new Date(input.analysisDate) : new Date();
  if (Number.isNaN(analysisDate.getTime())) throw new RangeError("analysisDate is not a valid date");

  const scope = input.scope ?? (input.latitude != null ? { type: "radius" } : null);
  if (!scope || !["radius", "lea", "small_area"].includes(scope.type)) throw new RangeError("scope.type must be 'radius', 'lea' or 'small_area' (exactly one geographic level per call)");
  if (scope.type === "radius") {
    if (input.latitude == null || input.longitude == null) throw new RangeError("a radius scope needs latitude and longitude");
    scope.center = point(Number(input.longitude), Number(input.latitude));
  } else if (!scope.id) throw new RangeError(`scope.id is required for '${scope.type}'`);

  const currentStart = startOfPeriod(analysisDate, unit);
  const to = includeIncompletePeriod ? addPeriods(currentStart, unit, 1) : currentStart;
  const reportFrom = addPeriods(to, unit, -periods);
  const from = addPeriods(reportFrom, unit, -cfg.units[unit].lag);   // lookback so the first reported period has a comparison
  return { unit, measure, bedrooms: bedrooms ?? null, propertyType: propertyType ?? null, sourceId: sourceId ?? null, pool, periods, analysisDate, scope, from, reportFrom, to, includeIncompletePeriod };
}

const seriesLabel = (s) => [s._id.propertyType, s._id.bedrooms != null ? `${s._id.bedrooms}-bed` : null, s._id.sourceId === "ALL" ? "all sources pooled" : s._id.sourceId].filter(Boolean).join(", ");

/**
 * Tool: rentalTrend
 * Input: { latitude?, longitude?, scope: {type:"radius", radiusM?} | {type:"lea"|"small_area", id},
 *          measure="advertised", bedrooms?, propertyType?, sourceId?, pool=false, unit="month"|"quarter"|"year",
 *          periods?, analysisDate?, includeIncompletePeriod=false }
 */
export async function rentalTrend(db, input, ledger, cfg = TREND_V1) {
  const scope = ledger.scope();
  const v = validate(input, cfg);
  const radii = v.scope.type === "radius" ? (v.scope.radiusM ? [v.scope.radiusM] : cfg.radiusLadderM) : [null];

  const ladder = [];
  let series = [], used = null;
  for (const radiusM of radii) {
    const sc = radiusM ? { ...v.scope, radiusM } : v.scope;
    series = await db.collection(cfg.series.collection).aggregate(buildTrendPipeline({ ...v, scope: sc }, cfg)).toArray();
    const best = Math.max(0, ...series.map((s) => s.sufficientPeriods));
    ladder.push({ ...(radiusM && { radiusM }), series: series.length, bestSufficientPeriods: best });
    used = sc;
    if (best >= cfg.minSufficientPeriods) break;
  }
  ladder.at(-1).accepted = true;

  const best = Math.max(0, ...series.map((s) => s.sufficientPeriods));
  const status = !series.length || best === 0 ? "none" : best < cfg.status.insufficientBelow ? "insufficient" : best < cfg.status.limitedBelow ? "limited" : "sufficient";
  const levelName = used.type === "radius" ? "point" : used.type;
  const geographicScope = used.type === "radius" ? { level: "point", radiusM: used.radiusM } : { level: used.type, areaId: used.id };

  const provenance = {
    collection: cfg.series.collection, systemOfRecord: "rental_observations", measure: v.measure,
    sourceIds: [...new Set(series.flatMap((s) => s.sourceIds))], versions: [...new Set(series.flatMap((s) => s.versions))],
    observedFrom: series.length ? new Date(Math.min(...series.map((s) => +s.observedFrom))) : null,
    observedTo: series.length ? new Date(Math.max(...series.map((s) => +s.observedTo))) : null,
    retrievedAt: series.length ? new Date(Math.max(...series.map((s) => +s.retrievedAt))) : null,
    records: series.reduce((a, s) => a + s.records, 0),
  };

  const warnings = [`All figures are ${v.measure} rents (${v.measure === "advertised" ? "asking prices, not agreed rents" : "registered rents"}). Advertised and registered rents are never combined.`];
  if (v.pool) warnings.push("Sources were pooled by request. Different sources can differ systematically; prefer per-source series.");
  else if (provenance.sourceIds.length > 1) warnings.push(`${provenance.sourceIds.length} sources reported separately (${provenance.sourceIds.join(", ")}). They are not averaged together.`);
  if (series.length > 1) warnings.push(`${series.length} series returned. Bedroom counts and property types are never pooled.`);
  if (used.type === "radius" && ladder.length > 1) warnings.push(`Search radius widened to ${used.radiusM} m to find enough observations.`);
  if (!v.includeIncompletePeriod) warnings.push(`The current ${v.unit} is excluded because it is incomplete.`);
  if (status === "insufficient" || status === "limited") warnings.push(`Only ${best} ${v.unit}(s) have at least ${cfg.minPerBucket} observations. Treat the trend as ${status === "limited" ? "indicative" : "unreliable"}.`);
  warnings.push(`A ${v.unit} with fewer than ${cfg.minPerBucket} observations shows its count but no statistics.`);

  // Cross-check against the official quarterly index. Reported separately, never merged.
  let officialIndex = null;
  if (used.type === "radius" && v.bedrooms != null && v.propertyType) {
    const sa = await db.collection("areas").findOne({ level: "small_area", geometry: { $geoIntersects: { $geometry: v.scope.center } } }, { projection: { parents: 1 } });
    const zone = sa?.parents?.rtb_zone;
    if (zone) {
      const idx = await officialIndexTrend(db, { rtbZoneId: zone, propertyType: v.propertyType, bedrooms: v.bedrooms, sinceYears: Math.max(1, Math.ceil(v.periods * (MONTHS[v.unit] / 12))) }, ledger);
      scope.items.push(...idx.evidence);
      if (idx.data) officialIndex = { unit: "quarter", measure: "index_mean", zone, from: idx.data.series[0].period, to: idx.data.series.at(-1).period, totalChangePct: idx.data.totalChangePct, latestYoY: idx.data.latestYoY, direction: idx.data.direction };
    }
  }

  const data = {
    status, model: cfg.version, measure: v.measure, unit: v.unit,
    scope: used.type === "radius" ? { type: "radius", radiusM: used.radiusM } : { type: used.type, id: used.id },
    geographicScope,
    period: { from: v.reportFrom, to: v.to, comparisonFrom: v.from, periods: v.periods, incompletePeriodIncluded: v.includeIncompletePeriod, comparison: `same ${v.unit} ${cfg.units[v.unit].lag} ${v.unit}(s) earlier` },
    minPerBucket: cfg.minPerBucket, pooledSources: v.pool,
    series: series.map((s) => ({ ...s, key: { sourceId: s._id.sourceId, bedrooms: s._id.bedrooms, propertyType: s._id.propertyType }, label: seriesLabel(s), _id: undefined })),
    provenance, search: { ladder }, officialIndex,
  };
  data.series.forEach((s) => delete s._id);

  if (!series.length || best === 0) {
    scope.add({ tool: "rentalTrend", claim: `Months with enough ${v.measure} rent observations`, value: 0, unit: "count",
      context: { measure: v.measure, ...geographicScope, areaLevel: levelName, model: cfg.version, unit: v.unit }, refs: [], sourceIds: provenance.sourceIds });
    return envelope({ scope, data, coverage: { geoMatch: used.type, n: 0, confidence: "none" }, warnings });
  }

  for (const s of data.series.slice(0, cfg.maxSeriesEvidence)) {
    const latest = [...s.points].reverse().find((p) => p.sufficient);
    const ctx = { model: cfg.version, measure: v.measure, unit: v.unit, areaLevel: levelName, ...(used.type === "radius" ? { radiusM: used.radiusM } : { areaId: used.id }),
      bedrooms: s.key.bedrooms, propertyType: s.key.propertyType, sourceId: s.key.sourceId, period: latest.label, from: s.observedFrom.toISOString().slice(0, 10), to: s.observedTo.toISOString().slice(0, 10), n: latest.n };
    const refs = latest.obsIdSample.map((id) => ref("rental_observations", id));
    const L = seriesLabel({ _id: s.key });
    scope.add({ tool: "rentalTrend", claim: `Median ${v.measure} rent, ${L}, ${latest.label}`, value: latest.medianRent, unit: "EUR/month", context: ctx, refs, sourceIds: s.sourceIds });
    scope.add({ tool: "rentalTrend", claim: `Average ${v.measure} rent, ${L}, ${latest.label}`, value: latest.avgRent, unit: "EUR/month", context: ctx, refs, sourceIds: s.sourceIds });
    if (s.latestYoYMedianPct != null) scope.add({ tool: "rentalTrend", claim: `Year-on-year change in median ${v.measure} rent, ${L}, ${s.latestYoYPeriod}`, value: s.latestYoYMedianPct, unit: "pct", context: { ...ctx, period: s.latestYoYPeriod }, refs, sourceIds: s.sourceIds });
    if (s.totalChangeMedianPct != null) scope.add({ tool: "rentalTrend", claim: `Change in median ${v.measure} rent over the period, ${L}`, value: s.totalChangeMedianPct, unit: "pct", context: ctx, refs, sourceIds: s.sourceIds });
  }
  if (series.length > cfg.maxSeriesEvidence) warnings.push(`Evidence is provided for the first ${cfg.maxSeriesEvidence} of ${series.length} series; all are in data.series.`);

  return envelope({
    scope, data, warnings,
    coverage: { geoMatch: used.type, n: provenance.records, dataAsOf: provenance.observedTo.toISOString().slice(0, 10),
      confidence: status === "sufficient" ? (best >= 12 ? "high" : "medium") : status === "limited" ? "low" : "none" },
  });
}

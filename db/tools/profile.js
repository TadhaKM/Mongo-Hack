// Cross-dataset intelligence: neighbourhood profile and tenancy-risk ranking.
import { envelope, noData } from "../lib/envelope.js";

const ref = (collection, docId) => ({ collection, docId: String(docId) });

/** Op 10. Five datasets joined on areaId in one round trip. */
export async function neighbourhoodProfile(db, { areaId, sinceYears = 2 }, ledger) {
  const scope = ledger.scope();
  const since = new Date(); since.setUTCFullYear(since.getUTCFullYear() - sinceYears);
  const planningSince = new Date(); planningSince.setUTCFullYear(planningSince.getUTCFullYear() - 4);
  const salesSince = new Date(); salesSince.setUTCFullYear(salesSince.getUTCFullYear() - 3);
  const [p] = await db.collection("areas").aggregate([
    { $match: { _id: areaId } },
    { $lookup: { from: "area_stats", let: { lea: "$parents.lea" }, as: "vacancy", pipeline: [
      { $match: { $expr: { $eq: ["$areaId", "$$lea"] }, stat: "vacancy" } }, { $sort: { periodStart: -1 } }, { $limit: 1 },
      { $project: { periodLabel: 1, areaId: 1, areaLevel: 1, "values.vacancyRatePct": 1 } }] } },
    { $lookup: { from: "area_stats", let: { lea: "$parents.lea" }, as: "terminations", pipeline: [
      { $match: { $expr: { $eq: ["$areaId", "$$lea"] }, stat: "rtb_terminations", periodStart: { $gte: since } } },
      { $group: { _id: "$dimension", notices: { $sum: "$values.notices" } } }, { $sort: { notices: -1 } }] } },
    { $lookup: { from: "planning_applications", localField: "_id", foreignField: "areaId", as: "planning", pipeline: [
      { $match: { applicationDate: { $gte: planningSince } } }, { $group: { _id: "$status", n: { $sum: 1 } } }] } },
    { $lookup: { from: "transport_stops", localField: "_id", foreignField: "areaId", as: "stops", pipeline: [{ $count: "n" }] } },
    { $lookup: { from: "property_sales", localField: "_id", foreignField: "areaId", as: "sales", pipeline: [
      { $match: { saleDate: { $gte: salesSince }, fullMarketPrice: true } },
      { $group: { _id: null, n: { $sum: 1 }, median: { $median: { input: "$salePrice", method: "approximate" } } } }] } },
    { $project: { name: 1, census: 1, src: 1, vacancy: { $first: "$vacancy" }, terminations: 1, planning: 1,
      stops: { $ifNull: [{ $first: "$stops.n" }, 0] }, sales: { $first: "$sales" } } },
  ]).toArray();
  if (!p) return noData(scope, `Unknown area ${areaId}.`);

  const sourceIds = (...ids) => ids;
  if (p.census) scope.add({ tool: "neighbourhoodProfile", claim: `Population of ${p.name} (Census ${p.census.year})`, value: p.census.population, unit: "people",
    context: { areaLevel: "small_area", year: p.census.year }, refs: [ref("areas", p._id)], sourceIds: sourceIds(p.src.sourceId) });
  if (p.vacancy) scope.add({ tool: "neighbourhoodProfile", claim: `Vacancy rate, ${p.vacancy.periodLabel}`, value: p.vacancy.values.vacancyRatePct, unit: "pct",
    context: { areaLevel: p.vacancy.areaLevel, areaId: p.vacancy.areaId, period: p.vacancy.periodLabel }, refs: [ref("area_stats", p.vacancy._id)], sourceIds: sourceIds("cso_vacancy") });
  if (p.terminations.length) {
    const total = p.terminations.reduce((a, b) => a + b.notices, 0);
    scope.add({ tool: "neighbourhoodProfile", claim: `RTB termination notices since ${since.toISOString().slice(0, 10)}`, value: total, unit: "count",
      context: { areaLevel: "lea", since: since.toISOString().slice(0, 10) }, refs: [ref("areas", p._id)], sourceIds: sourceIds("rtb_terminations") });
  }
  const { src, ...data } = p;
  return envelope({
    scope, data,
    coverage: { geoMatch: "small_area", confidence: p.census ? "medium" : "low" },
    warnings: ["Vacancy and RTB figures are at LEA level, census at small-area level. Do not present them as the same geography."],
  });
}

/** Op 11. Rank the LEA's termination rate against every LEA (window functions). */
export async function tenancyRisk(db, { leaId, sinceMonths = 15 }, ledger) {
  const scope = ledger.scope();
  const since = new Date(); since.setUTCMonth(since.getUTCMonth() - sinceMonths);
  const [r] = await db.collection("area_stats").aggregate([
    { $match: { stat: "rtb_terminations", areaLevel: "lea", periodStart: { $gte: since } } },
    { $group: { _id: { a: "$areaId", p: "$periodStart" }, notices: { $sum: "$values.notices" }, rate: { $sum: "$values.noticesPer1000Tenancies" } } },
    { $group: { _id: "$_id.a", notices: { $sum: "$notices" }, ratePer1000: { $avg: "$rate" } } },
    { $setWindowFields: { sortBy: { ratePer1000: -1 }, output: {
      rank: { $rank: {} },
      of: { $count: {}, window: { documents: ["unbounded", "unbounded"] } } } } },
    { $match: { _id: leaId } },
    { $set: { ratePer1000: { $round: ["$ratePer1000", 2] },
      percentile: { $round: [{ $multiply: [{ $divide: [{ $subtract: ["$of", "$rank"] }, { $max: [1, { $subtract: ["$of", 1] }] }] }, 100] }, 0] } } },
  ]).toArray();
  if (!r) return noData(scope, `No termination statistics for ${leaId}.`);
  const ctx = { areaLevel: "lea", areaId: leaId, since: since.toISOString().slice(0, 10), comparedWith: `${r.of} LEAs` };
  const refs = [ref("areas", leaId)];
  scope.add({ tool: "tenancyRisk", claim: "Termination-notice rate per 1,000 tenancies (average per quarter)", value: r.ratePer1000, unit: "per 1000", context: ctx, refs, sourceIds: ["rtb_terminations"] });
  scope.add({ tool: "tenancyRisk", claim: `Share of LEAs with a lower termination rate (of ${r.of})`, value: r.percentile, unit: "percentile", context: ctx, refs, sourceIds: ["rtb_terminations"] });
  return envelope({ scope, data: r, coverage: { geoMatch: "lea", n: r.of, confidence: r.of >= 10 ? "high" : "low" },
    warnings: ["Correlation, not causation: a high termination rate does not mean this landlord or property is risky."] });
}

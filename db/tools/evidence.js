// Evidence checks that run inside MongoDB against the stored analysis.
import { ObjectId } from "mongodb";
import { envelope, noData } from "../lib/envelope.js";

/** Op 7. Are the numbers the report states the numbers the database produced? */
export async function verifyClaims(db, { analysisId, claims }, ledger) {
  const scope = ledger.scope();
  const clean = claims.map((c) => ({ id: c.id, asserted: c.asserted, tol: c.tol ?? 0 }));
  const rows = await db.collection("analyses").aggregate([
    { $match: { _id: new ObjectId(analysisId) } },
    { $project: { evidence: 1 } },
    { $set: { claims: { $literal: clean } } },
    { $unwind: "$claims" },
    { $set: { ev: { $first: { $filter: { input: "$evidence", cond: { $eq: ["$$this.id", "$claims.id"] } } } } } },
    { $project: { _id: 0, id: "$claims.id", asserted: "$claims.asserted", stored: "$ev.value",
      status: { $switch: { branches: [
        { case: { $eq: [{ $type: "$ev" }, "missing"] }, then: "no_such_evidence" },
        { case: { $not: [{ $and: [{ $isNumber: "$ev.value" }, { $isNumber: "$claims.asserted" }] }] },
          then: { $cond: [{ $eq: ["$ev.value", "$claims.asserted"] }, "verified", "mismatch"] } },
        { case: { $lte: [{ $abs: { $subtract: ["$claims.asserted", "$ev.value"] } }, "$claims.tol"] }, then: "verified" }],
        default: "mismatch" } } } },
  ]).toArray();
  if (!rows.length) return noData(scope, "Analysis not found.");
  const bad = rows.filter((r) => r.status !== "verified");
  return envelope({
    scope, data: { results: rows, allVerified: bad.length === 0, failed: bad.map((b) => b.id) },
    coverage: { n: rows.length, confidence: "high" },
    warnings: bad.length ? [`${bad.length} claim(s) did not match stored evidence. Regenerate or remove them.`] : [],
  });
}

/** Op 12. Age of each evidence item's source and its geographic level. */
export async function evidenceFreshness(db, { analysisId, levels, maxAgeMonths }, ledger) {
  const scope = ledger.scope();
  const levelStage = levels?.length ? [{ $match: { "evidence.context.areaLevel": { $in: levels } } }] : [];
  const rows = await db.collection("analyses").aggregate([
    { $match: { _id: new ObjectId(analysisId) } }, { $unwind: "$evidence" },
    ...levelStage,
    { $unwind: "$evidence.sourceIds" },
    { $lookup: { from: "sources", localField: "evidence.sourceIds", foreignField: "_id", as: "s" } }, { $unwind: "$s" },
    { $set: { ageMonths: { $dateDiff: { startDate: "$s.coverage.to", endDate: "$$NOW", unit: "month" } } } },
    { $group: { _id: "$evidence.id", claim: { $first: "$evidence.claim" }, areaLevel: { $first: "$evidence.context.areaLevel" },
      oldestSourceMonths: { $max: "$ageMonths" }, sources: { $addToSet: "$s.title" } } },
    { $set: { freshness: { $switch: { branches: [
      { case: { $eq: ["$oldestSourceMonths", null] }, then: "unknown" },
      { case: { $lte: ["$oldestSourceMonths", 6] }, then: "current" },
      { case: { $lte: ["$oldestSourceMonths", 18] }, then: "recent" }], default: "dated" } } } },
    ...(maxAgeMonths != null ? [{ $match: { oldestSourceMonths: { $gt: maxAgeMonths } } }] : []),
    { $sort: { _id: 1 } },
  ]).toArray();
  return envelope({
    scope, data: { items: rows }, coverage: { n: rows.length, confidence: "high" },
    warnings: rows.filter((r) => r.freshness === "dated").map((r) => `${r._id} relies on data more than 18 months old (${r.areaLevel ?? "unknown level"}).`),
  });
}

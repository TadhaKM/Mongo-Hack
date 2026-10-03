// Public surface for Person 2 (agent tools) and Person 4 (API).
//
//   const { analysisId } = await startAnalysis(db, input);   // get-or-create property + analysis (tools/properties.js)
//   const res = await callTool(db, analysisId, "nearbyTransport", { lng, lat });
//
// callTool runs the tool, then stores its result and evidence on the analysis,
// so evidence ids stay unique and verifyClaims has something to check against.
import { ObjectId } from "mongodb";
import { createHash } from "node:crypto";
import { Ledger } from "../lib/envelope.js";
import * as geo from "./geo.js";
import * as rent from "./rent.js";
import * as profile from "./profile.js";
import * as evidence from "./evidence.js";
import * as comparables from "./comparables.js";
export { startAnalysis, getOrCreateProperty, addressKey } from "./properties.js";

export const TOOLS = {
  locateProperty: geo.locateProperty,
  vacancyForLocation: geo.vacancyForLocation,
  nearbyTransport: geo.nearbyTransport,
  nearestStops: geo.nearestStops,
  nearbyPlanning: geo.nearbyPlanning,
  recentSales: geo.recentSales,
  rentsInSameArea: geo.rentsInSameArea,
  comparableListings: geo.comparableListings,
  rentalComparables: comparables.rentalComparables,
  benchmarkRent: rent.benchmarkRent,
  zoneComparables: rent.zoneComparables,
  rentTrend: rent.rentTrend,
  listingMarket: rent.listingMarket,
  neighbourhoodProfile: profile.neighbourhoodProfile,
  tenancyRisk: profile.tenancyRisk,
  verifyClaims: evidence.verifyClaims,
  evidenceFreshness: evidence.evidenceFreshness,
};

/** analyses.input is stored verbatim; inputHash (day-granular) is the cache key. */
export async function createAnalysis(db, { propertyId, input, dataVersions = {} }) {
  const day = input.analysisDate ? new Date(input.analysisDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  const inputHash = createHash("sha256").update(JSON.stringify({ ...input, analysisDate: day })).digest("hex").slice(0, 16);
  const { insertedId } = await db.collection("analyses").insertOne({
    propertyId, input, inputHash, status: "running", results: {}, evidence: [], warnings: [], dataVersions, createdAt: new Date(),
  });
  return insertedId;
}

const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null));

/** Turn a tool's evidence item into the full stored shape (docs/mongodb-schema.md, section 10). */
export function enrichEvidence(item, params) {
  const c = item.context ?? {};
  const observationPeriod = compact({ from: c.since ?? c.from, to: c.to, period: c.period, windowDays: c.windowDays, sinceMonths: c.sinceMonths });
  return {
    ...item,
    evidenceType: item.tool,
    queryParameters: params,
    geographicScope: compact({ level: c.areaLevel, areaId: c.areaId, radiusM: c.radiusM ?? c.maxDistanceM }),
    ...(Object.keys(observationPeriod).length && { observationPeriod }),
    generatedAt: new Date(),
  };
}

/** Run a tool and persist {results.<tool>, evidence[]} on the analysis. Returns the envelope. */
export async function callTool(db, analysisId, name, params) {
  const fn = TOOLS[name];
  if (!fn) throw new Error(`Unknown tool ${name}`);
  const id = new ObjectId(analysisId);
  const [{ n = 0 } = {}] = await db.collection("analyses").aggregate([
    { $match: { _id: id } }, { $project: { n: { $size: "$evidence" } } }]).toArray();
  const res = await fn(db, params, new Ledger(n));
  res.evidence = res.evidence.map((e) => enrichEvidence(e, params));
  if (name !== "verifyClaims" && name !== "evidenceFreshness") {
    await db.collection("analyses").updateOne({ _id: id }, {
      $set: { [`results.${name}`]: res.data },
      ...(res.evidence.length && { $push: { evidence: { $each: res.evidence } } }),
      ...(res.warnings.length && { $addToSet: { warnings: { $each: res.warnings } } }),
    });
  }
  return res;
}

export async function completeAnalysis(db, analysisId, resolved) {
  const doc = await db.collection("analyses").findOne({ _id: new ObjectId(analysisId) }, { projection: { createdAt: 1 } });
  await db.collection("analyses").updateOne({ _id: doc._id }, {
    $set: { status: "complete", completedAt: new Date(), durationMs: Date.now() - doc.createdAt.getTime(), ...(resolved && { resolved }) } });
}

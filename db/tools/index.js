// Public surface for Person 2 (agent tools) and Person 4 (API).
//
//   const { analysisId } = await startAnalysis(db, input);   // get-or-create property + analysis (tools/properties.js)
//   const res = await callTool(db, analysisId, "nearbyTransport", { lng, lat });
//
// callTool runs the tool, then stores its result and evidence on the analysis,
// so evidence ids stay unique and verifyClaims has something to check against.
import { ObjectId } from "mongodb";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Ledger } from "../lib/envelope.js";
import { recordingDb, toSafe, hashOf, sha256 } from "../lib/queryLog.js";
import { resolveProvenance, policyFromEnv, checkPolicy, blockedEnvelope, bannerFor, worstClass } from "../lib/provenance.js";
import * as trace from "./trace.js";
import * as geo from "./geo.js";
import * as rent from "./rent.js";
import * as profile from "./profile.js";
import * as evidence from "./evidence.js";
import * as comparables from "./comparables.js";
import * as trends from "./trends.js";
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
  rentalTrend: trends.rentalTrend,
  locateRentArea: rent.locateRentArea,
  rentContext: rent.rentContext,
  benchmarkRent: rent.benchmarkRent,
  zoneComparables: rent.zoneComparables,
  rentTrend: rent.rentTrend,
  listingMarket: rent.listingMarket,
  neighbourhoodProfile: profile.neighbourhoodProfile,
  tenancyRisk: profile.tenancyRisk,
  verifyClaims: evidence.verifyClaims,
  evidenceFreshness: evidence.evidenceFreshness,
};

const ENGINE_VERSION = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;
const META_TOOLS = new Set(["verifyClaims", "evidenceFreshness"]);   // they inspect stored evidence; they produce no data of their own
const TIME_AWARE = new Set(["rentalComparables", "rentalTrend"]);    // their results depend on "today"; pin it so a run can be reproduced
const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null));

/** analyses.input is stored verbatim; inputHash (day-granular) is the cache key. */
export async function createAnalysis(db, { propertyId, input, dataVersions = {}, dataPolicy }) {
  const day = input.analysisDate ? new Date(input.analysisDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  const inputHash = createHash("sha256").update(JSON.stringify({ ...input, analysisDate: day })).digest("hex").slice(0, 16);
  const { insertedId } = await db.collection("analyses").insertOne({
    propertyId, input, inputHash, status: "running", resultRefs: {}, evidence: [], warnings: [], dataVersions, createdAt: new Date(),
    dataPolicy: checkPolicy(dataPolicy ?? policyFromEnv()), dataClass: "none", publishable: false, blockedTools: [],
  });
  return insertedId;
}

/** Turn a tool's evidence item into the full stored shape (docs/mongodb-evidence-provenance.md, section 3). */
export function enrichEvidence(item, params, { queryId, prov, now = new Date() } = {}) {
  const c = item.context ?? {};
  const observationPeriod = compact({ from: c.since ?? c.from, to: c.to, period: c.period, windowDays: c.windowDays, sinceMonths: c.sinceMonths });
  const p = prov?.per.get(item.id);
  const cls = p?.dataClass ?? "unknown";
  return {
    ...item,
    ...(cls !== "real" && { claim: `[${bannerFor(cls)}] ${item.claim}`, claimRaw: item.claim }),   // the label travels with the sentence
    evidenceType: item.tool,
    ...(queryId && { queryId }),
    queryParameters: toSafe(params),
    geographicScope: compact({ level: c.areaLevel, areaId: c.areaId, radiusM: c.radiusM ?? c.maxDistanceM }),
    ...(Object.keys(observationPeriod).length && { observationPeriod }),
    dataClass: cls, publishable: cls === "real",
    sources: p?.sources ?? [], recordClasses: p?.recordClasses ?? {},
    generatedAt: now,
  };
}

/**
 * Run a tool with full provenance: records the exact queries, resolves which sources and data classes the cited records
 * belong to, applies the data policy, labels non-real results, and stores a query_run. Does not touch an analysis.
 */
export async function runTool(db, name, params = {}, { ledger = new Ledger(), dataPolicy = policyFromEnv(), analysisId = null, persist = true } = {}) {
  const fn = TOOLS[name];
  if (!fn) throw new Error(`Unknown tool ${name}`);
  checkPolicy(dataPolicy);
  const queryId = new ObjectId(), startedAt = new Date(), t0 = performance.now();
  const rec = recordingDb(db);
  const res = await fn(rec.db, params, ledger);
  const durationMs = Math.round(performance.now() - t0);
  if (META_TOOLS.has(name)) return { ...res, evidence: res.evidence.map((e) => enrichEvidence(e, params)) };

  const raw = res.evidence;
  const prov = await resolveProvenance(db, raw);
  const dataClass = res.data == null && !raw.length ? "none" : prov.dataClass;
  const blocked = dataPolicy === "real_only" && res.data != null && dataClass !== "real";
  let out;
  if (blocked) {
    const reason = `This result is built from ${dataClass === "unknown" ? "unverified" : dataClass} data (${[...prov.sources.map((x) => x.sourceId), ...prov.unknownSourceIds].join(", ") || "no registered source"}), not real Irish data.`;
    out = { ...blockedEnvelope(reason, prov) };
  } else {
    out = { ...res, evidence: raw.map((e) => enrichEvidence(e, params, { queryId: queryId.toHexString(), prov })) };
    if (res.data != null && dataClass !== "real") out.warnings = [`${bannerFor(dataClass)}: this result is not built from verified real Irish data and must not be presented as such.`, ...out.warnings];
  }
  out.queryId = queryId.toHexString();
  out.provenance = { dataClass, publishable: dataClass === "real" && !blocked, dataPolicy, sources: prov.sources, unknownSourceIds: prov.unknownSourceIds, queryId: out.queryId };

  if (persist) {
    const refs = new Map();
    for (const e of raw) for (const r of e.refs ?? []) refs.set(`${r.collection}:${r.docId}`, r);
    const sourceVersions = Object.fromEntries(prov.sources.map((x) => [x.sourceId, x.version]));
    await db.collection("query_runs").insertOne({
      _id: queryId, analysisId, tool: name, toolModel: res.data?.scoringModel ?? res.data?.model ?? null,
      params: toSafe(params), paramsHash: hashOf(params), dataPolicy, dataClass, status: blocked ? "blocked" : "ok",
      queries: rec.log, collections: [...new Set(rec.log.map((q) => q.collection))],
      sourceIds: prov.sources.map((x) => x.sourceId), sourceVersions,
      recordCount: refs.size, recordRefs: [...refs.values()].slice(0, 5000), recordRefsTruncated: refs.size > 5000,
      evidenceIds: out.evidence.map((e) => e.id), evidenceSummary: raw.map((e) => ({ id: e.id, claim: e.claim, value: e.value })),
      resultDigest: res.data == null ? null : sha256(JSON.stringify(toSafe(res.data))),
      startedAt, durationMs, engine: { name: "mend-engine", version: ENGINE_VERSION },
    });
  }
  return out;
}

/** Run a tool for an analysis: persists the query run, the result (analysis_results), and the evidence (embedded in analyses). */
export async function callTool(db, analysisId, name, params = {}) {
  if (!TOOLS[name]) throw new Error(`Unknown tool ${name}`);
  const id = new ObjectId(analysisId);
  const analysis = await db.collection("analyses").findOne({ _id: id }, { projection: { evidence: 1, dataPolicy: 1, input: 1 } });
  if (!analysis) throw new RangeError("analysis not found");
  if (TIME_AWARE.has(name) && params.analysisDate == null) params = { analysisDate: new Date(analysis.input?.analysisDate ?? Date.now()).toISOString(), ...params };
  const res = await runTool(db, name, params, { ledger: new Ledger(analysis.evidence.length), dataPolicy: analysis.dataPolicy ?? policyFromEnv(), analysisId: id });
  if (META_TOOLS.has(name)) return res;

  const status = res.blocked ? "blocked" : "ok", cls = res.provenance.dataClass;
  await db.collection("analysis_results").replaceOne({ analysisId: id, tool: name }, {
    analysisId: id, tool: name, queryId: new ObjectId(res.queryId), status, dataClass: cls, publishable: res.provenance.publishable,
    data: res.data, coverage: res.coverage, warnings: res.warnings, evidenceIds: res.evidence.map((e) => e.id), ...(res.blocked && { blocked: res.blocked }), createdAt: new Date(),
  }, { upsert: true });
  await db.collection("analyses").updateOne({ _id: id }, {
    $set: { [`resultRefs.${name}`]: { queryId: res.queryId, status, dataClass: cls, evidenceIds: res.evidence.map((e) => e.id) } },
    ...(res.evidence.length && { $push: { evidence: { $each: res.evidence } } }),
    $addToSet: { warnings: { $each: res.warnings }, ...(res.blocked && { blockedTools: name }) },
  });
  // roll the tool results up: the analysis is publishable only if every tool ran on real data and none was blocked
  const { resultRefs } = await db.collection("analyses").findOne({ _id: id }, { projection: { resultRefs: 1 } });
  const refs = Object.values(resultRefs);
  await db.collection("analyses").updateOne({ _id: id }, { $set: {
    dataClass: worstClass(refs.filter((r) => r.status === "ok").map((r) => r.dataClass)),
    publishable: refs.length > 0 && refs.every((r) => r.status === "ok" && r.dataClass === "real"),
  } });
  return res;
}

/** The analysis with each tool's result joined in from analysis_results (`results`), and the light index kept as `resultRefs`. */
export async function getAnalysis(db, analysisId) {
  const id = new ObjectId(analysisId);
  const doc = await db.collection("analyses").findOne({ _id: id });
  if (!doc) return null;
  const results = {};
  for await (const r of db.collection("analysis_results").find({ analysisId: id })) results[r.tool] = r.data;
  return { ...doc, results };
}

export const explainEvidence = (db, p) => trace.explainEvidence(db, p);
export const reproduceQueryRun = (db, queryId) => trace.reproduceQueryRun(db, queryId, runTool);
export const reportReadiness = (db, analysisId) => trace.reportReadiness(db, analysisId);

export async function completeAnalysis(db, analysisId, resolved) {
  const doc = await db.collection("analyses").findOne({ _id: new ObjectId(analysisId) }, { projection: { createdAt: 1 } });
  await db.collection("analyses").updateOne({ _id: doc._id }, {
    $set: { status: "complete", completedAt: new Date(), durationMs: Date.now() - doc.createdAt.getTime(), ...(resolved && { resolved }) } });
}

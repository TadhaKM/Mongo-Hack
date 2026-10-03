// Tracing a claim back to its records: evidence -> query run -> source records -> registered sources.
import { ObjectId } from "mongodb";
import { fromSafe } from "../lib/queryLog.js";

const OBS_DATE_FIELDS = ["observedAt", "periodStart", "saleDate", "applicationDate"];
const idVariants = (id) => (/^[0-9a-f]{24}$/.test(String(id)) ? [String(id), ObjectId.createFromHexString(String(id))] : [String(id)]);
const oid = (v) => { try { return ObjectId.createFromHexString(String(v)); } catch { throw new RangeError("invalid id"); } };

/** One cited record, described with the provenance fields every record is required to carry. */
export function traceRow(collection, d) {
  const src = d.src ?? {};
  return {
    collection, docId: String(d._id),
    sourceId: src.sourceId ?? null, sourceRecordId: src.recordId ?? null, sourceVersion: src.version ?? null,
    observationDate: OBS_DATE_FIELDS.map((f) => d[f]).find((v) => v != null) ?? null,
    geographicLevel: d.areaLevel ?? d.level ?? (d.geo ? "point" : null), geographicId: d.areaId ?? (d.level ? d._id : null),
    retrievedAt: src.retrievedAt ?? null, ingestedAt: src.ingestedAt ?? null, transform: src.transform ?? null,
    dataClass: src.dataClass ?? "unknown",
  };
}

const short = (o) => JSON.stringify(o, (k, v) => (v && v.$date ? v.$date.slice(0, 10) : v && v.$oid ? v.$oid : v)).replace(/"/g, "");

/** Plain-language, deterministic description of what a recorded query did. No model involved. */
function describeQuery(q) {
  if (q.op === "aggregate") {
    const first = q.spec.pipeline?.[0] ?? {};
    if (first.$geoNear) {
      const g = first.$geoNear, [lng, lat] = g.near.coordinates;
      return `Searched ${q.collection} for documents within ${g.maxDistance ?? "any"} m of (${lng}, ${lat}), nearest first, keeping only those matching ${short(g.query ?? {})}`;
    }
    if (first.$match) return `Aggregated ${q.collection} over documents matching ${short(first.$match)} (${q.spec.pipeline.length} pipeline stages)`;
    return `Ran a ${q.spec.pipeline?.length ?? "?"}-stage aggregation on ${q.collection}`;
  }
  if (q.op === "distinct") return `Listed distinct ${q.spec.field} values in ${q.collection}`;
  return `${q.op === "countDocuments" ? "Counted" : "Looked up"} ${q.collection} documents matching ${short(q.spec.filter ?? {})}`;
}

export async function explainEvidence(db, { analysisId, evidenceId, recordLimit = 100 }) {
  const analysis = await db.collection("analyses").findOne({ _id: oid(analysisId) });
  if (!analysis) return { ok: false, error: "analysis not found" };
  const ev = analysis.evidence.find((e) => e.id === evidenceId);
  if (!ev) return { ok: false, error: `no evidence '${evidenceId}' in this analysis` };
  const run = ev.queryId ? await db.collection("query_runs").findOne({ _id: oid(ev.queryId) }) : null;

  // the records, grouped by collection, as full documents (minus bulky vectors)
  const refs = ev.refs ?? [], shown = refs.slice(0, recordLimit), rows = [], missing = [];
  const byColl = new Map();
  for (const r of shown) (byColl.get(r.collection) ?? byColl.set(r.collection, []).get(r.collection)).push(r.docId);
  for (const [coll, ids] of byColl) {
    const found = new Map();
    for await (const d of db.collection(coll).find({ _id: { $in: ids.flatMap(idVariants) } }, { projection: { embedding: 0 } })) found.set(String(d._id), d);
    for (const id of ids) {
      const d = found.get(String(id));
      if (!d) { missing.push({ collection: coll, docId: id }); continue; }
      rows.push({ ...traceRow(coll, d), record: d });
    }
  }
  const sourceIds = [...new Set([...(ev.sourceIds ?? []), ...rows.map((r) => r.sourceId).filter(Boolean)])];
  const sources = await db.collection("sources").find({ _id: { $in: sourceIds } }).toArray();
  const recordClasses = rows.reduce((a, r) => ({ ...a, [r.dataClass]: (a[r.dataClass] ?? 0) + 1 }), {});

  const steps = [];
  if (run) {
    steps.push(`Tool ${run.tool}${run.toolModel ? ` (model ${run.toolModel})` : ""} was run at ${run.startedAt.toISOString()} with parameters ${short(run.params)}.`);
    for (const q of run.queries) steps.push(`${describeQuery(q)}.`);
    const c = ev.context ?? {};
    if (c.n != null || c.minScore != null || c.windowDays != null) steps.push(`Selection: ${[c.n != null && `${c.n} records kept`, c.radiusM != null && `radius ${c.radiusM} m`, c.windowDays != null && `last ${c.windowDays} days`, c.minScore != null && `minimum comparable score ${c.minScore}`].filter(Boolean).join(", ")}.`);
  } else steps.push("No query run is stored for this evidence item (it predates provenance tracking).");
  steps.push(`Result: "${ev.claimRaw ?? ev.claim}" = ${ev.value}${ev.unit ? ` ${ev.unit}` : ""}, computed from ${refs.length} cited record(s).`);

  return {
    ok: true,
    question: `Why does the database say: ${ev.claim} = ${ev.value}${ev.unit ? ` ${ev.unit}` : ""}?`,
    answer: steps,
    evidence: { id: ev.id, claim: ev.claim, value: ev.value, unit: ev.unit ?? null, dataClass: ev.dataClass ?? "unknown", publishable: ev.publishable ?? false,
      geographicScope: ev.geographicScope ?? null, observationPeriod: ev.observationPeriod ?? null, generatedAt: ev.generatedAt, queryParameters: ev.queryParameters },
    queryRun: run && { queryId: String(run._id), tool: run.tool, model: run.toolModel, params: run.params, dataPolicy: run.dataPolicy, status: run.status, startedAt: run.startedAt,
      durationMs: run.durationMs, queries: run.queries.map((q) => ({ seq: q.seq, collection: q.collection, op: q.op, spec: q.spec, specHash: q.specHash })),
      sourceVersions: run.sourceVersions, recordCount: run.recordCount, engine: run.engine, reproduce: `POST /query-runs/${run._id}/reproduce` },
    records: { total: refs.length, shown: rows.length, missing, items: rows },
    sources: sources.map((s) => ({ sourceId: s._id, title: s.title, organisation: s.organisation, url: s.url ?? null, licence: s.licence ?? null, version: s.version ?? null, retrievedAt: s.retrievedAt ?? null, dataClass: s.dataClass ?? "unknown" })),
    integrity: { recordsCited: refs.length, recordsFound: rows.length, allShownRecordsFound: missing.length === 0, recordDataClasses: recordClasses, evidenceDataClass: ev.dataClass ?? "unknown" },
  };
}

/** Re-execute the stored tool with the stored parameters on the current data and compare every figure. */
export async function reproduceQueryRun(db, queryId, runTool) {
  const run = await db.collection("query_runs").findOne({ _id: oid(queryId) });
  if (!run) return { ok: false, error: "query run not found" };
  const again = await runTool(db, run.tool, fromSafe(run.params), { dataPolicy: run.dataPolicy, persist: false });
  const now = again.evidence ?? [], was = run.evidenceSummary ?? [], differences = [];
  if (now.length !== was.length) differences.push({ what: "number of evidence items", stored: was.length, now: now.length });
  for (let i = 0; i < Math.min(now.length, was.length); i++) {
    const a = was[i].value, b = now[i].value;
    if (JSON.stringify(a) !== JSON.stringify(b)) differences.push({ claim: was[i].claim, stored: a, now: b });
  }
  const sources = await db.collection("sources").find({ _id: { $in: Object.keys(run.sourceVersions ?? {}) } }).toArray();
  const changed = sources.filter((s) => s.version !== run.sourceVersions[s._id]).map((s) => ({ sourceId: s._id, then: run.sourceVersions[s._id], now: s.version }));
  return {
    ok: true, queryId: String(run._id), tool: run.tool, reproduced: differences.length === 0, compared: Math.min(now.length, was.length), differences, sourceVersionsChanged: changed,
    note: differences.length ? "The same tool and parameters give different figures now. If sourceVersionsChanged is non-empty the data was reloaded; otherwise records were added or removed after this run." : "Identical figures from the same tool, parameters and data.",
  };
}

export async function reportReadiness(db, analysisId) {
  const a = await db.collection("analyses").findOne({ _id: oid(analysisId) }, { projection: { resultRefs: 1, dataPolicy: 1, dataClass: 1, publishable: 1, blockedTools: 1 } });
  if (!a) return { ok: false, error: "analysis not found" };
  const tools = Object.entries(a.resultRefs ?? {}).map(([tool, r]) => ({ tool, status: r.status, dataClass: r.dataClass, queryId: r.queryId }));
  const reasons = [];
  if (!tools.length) reasons.push("No data tool has been run for this analysis.");
  for (const t of tools) if (t.status === "blocked") reasons.push(`${t.tool} was blocked: it was built from ${t.dataClass} data.`);
    else if (t.dataClass !== "real") reasons.push(`${t.tool} used ${t.dataClass} data.`);
  return { ok: true, analysisId: String(a._id), publishable: !!a.publishable, dataClass: a.dataClass, dataPolicy: a.dataPolicy, blockedTools: a.blockedTools ?? [], tools, reasons };
}

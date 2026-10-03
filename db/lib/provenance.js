// Provenance resolution and the guard against presenting synthetic or test data as real Irish data.
//
// Every record carries src.dataClass ("real" | "synthetic" | "test"); every source in the registry declares one too.
// A result's class is the WORST class of the records it was built from and of their registered sources.
// Anything unmarked or unregistered is "unknown" and is treated as NOT real (default-deny).
import { ObjectId } from "mongodb";

export const DATA_CLASSES = ["real", "synthetic", "test"];
export const BANNERS = {
  synthetic: "SYNTHETIC SAMPLE DATA",
  test: "TEST DATA",
  unknown: "UNVERIFIED DATA (source not registered or not marked as real)",
};
const RANK = { real: 0, synthetic: 1, test: 2, unknown: 3 };

/** real_only (default) blocks results built from non-real data; allow_synthetic is for development and must be explicit. */
export const policyFromEnv = () => (process.env.DATA_POLICY === "allow_synthetic" ? "allow_synthetic" : "real_only");
export const checkPolicy = (p) => { if (!["real_only", "allow_synthetic"].includes(p)) throw new RangeError("dataPolicy must be 'real_only' or 'allow_synthetic'"); return p; };

export function worstClass(classes) {
  const list = [...classes].filter(Boolean);
  if (!list.length) return "none";
  return list.reduce((w, c) => (RANK[c] ?? 3) > (RANK[w] ?? 3) ? c : w, "real");
}

const idOf = (id) => (/^[0-9a-f]{24}$/.test(String(id)) ? [String(id), ObjectId.createFromHexString(String(id))] : [String(id)]);

/** Compact, self-describing description of a registered source, stored with the evidence so it survives registry changes. */
export const snapshot = (s) => ({
  sourceId: s._id, title: s.title, organisation: s.organisation, url: s.url ?? null, licence: s.licence ?? null,
  version: s.version ?? null, retrievedAt: s.retrievedAt ?? null, dataClass: s.dataClass ?? "unknown",
});

/**
 * For a set of evidence items, look at the records they cite (refs) and the sources they declare, and work out each item's
 * provenance: which sources, which record-level data classes, and the overall class.
 * Returns a Map(evidence.id -> { dataClass, sources[], recordClasses{}, unknownSourceIds[] }) and the run-level union.
 */
export async function resolveProvenance(db, evidence) {
  const byColl = new Map();
  for (const e of evidence) for (const r of e.refs ?? []) { (byColl.get(r.collection) ?? byColl.set(r.collection, new Set()).get(r.collection)).add(String(r.docId)); }
  const recSrc = new Map();   // "collection:id" -> src
  for (const [coll, ids] of byColl) {
    const all = [...ids].flatMap(idOf);
    for (let i = 0; i < all.length; i += 5000) {
      for await (const d of db.collection(coll).find({ _id: { $in: all.slice(i, i + 5000) } }, { projection: { src: 1 } })) recSrc.set(`${coll}:${String(d._id)}`, d.src ?? null);
    }
  }
  const wanted = new Set();
  for (const e of evidence) for (const s of e.sourceIds ?? []) wanted.add(s);
  for (const s of recSrc.values()) if (s?.sourceId) wanted.add(s.sourceId);
  const registry = new Map();
  if (wanted.size) for await (const s of db.collection("sources").find({ _id: { $in: [...wanted] } })) registry.set(s._id, s);

  const per = new Map(), runClasses = new Set(), runSources = new Map(), runUnknown = new Set();
  for (const e of evidence) {
    const ids = new Set(e.sourceIds ?? []), recordClasses = {}, classes = [];
    for (const r of e.refs ?? []) {
      const src = recSrc.get(`${r.collection}:${r.docId}`);
      const c = src === undefined ? "unknown" : (src?.dataClass ?? "unknown");   // cited record missing or unmarked -> unknown
      recordClasses[c] = (recordClasses[c] ?? 0) + 1; classes.push(c);
      if (src?.sourceId) ids.add(src.sourceId);
    }
    const unknownSourceIds = [], snaps = [];
    for (const id of ids) {
      const reg = registry.get(id);
      if (!reg) { unknownSourceIds.push(id); classes.push("unknown"); } else { snaps.push(snapshot(reg)); classes.push(reg.dataClass ?? "unknown"); }
    }
    if (!ids.size) classes.push("unknown");   // evidence that cites no source at all cannot be called real
    const dataClass = worstClass(classes);
    per.set(e.id, { dataClass, sources: snaps, recordClasses, unknownSourceIds });
    runClasses.add(dataClass); for (const s of snaps) runSources.set(s.sourceId, s); for (const u of unknownSourceIds) runUnknown.add(u);
  }
  return { per, dataClass: worstClass(runClasses), sources: [...runSources.values()], unknownSourceIds: [...runUnknown] };
}

export function blockedEnvelope(reason, prov) {
  return {
    ok: true, data: null, evidence: [], coverage: { confidence: "none" },
    warnings: [`BLOCKED: ${reason} The data policy is "real_only", so no figures are returned. Use real data, or set DATA_POLICY=allow_synthetic for development only.`],
    blocked: { reason, dataClass: prov.dataClass, sources: prov.sources, unknownSourceIds: prov.unknownSourceIds },
  };
}

export const bannerFor = (dataClass) => BANNERS[dataClass] ?? BANNERS.unknown;

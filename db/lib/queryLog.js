// Records every MongoDB read a tool performs (collection, operation, exact filter or pipeline), without touching the tools.
// The log becomes part of a query_run, so "why did the database say 37?" can show the queries that produced it.
import { createHash } from "node:crypto";
import { ObjectId } from "mongodb";

const RECORDED = new Set(["aggregate", "find", "findOne", "countDocuments", "distinct"]);
const MAX_SPEC_CHARS = 80_000;

/** JSON-safe copy of a query: Dates -> {$date}, ObjectIds -> {$oid}. */
export function toSafe(value) {
  return JSON.parse(JSON.stringify(value ?? null, function (key) {
    const raw = this[key];
    if (raw instanceof Date) return { $date: raw.toISOString() };
    if (raw && raw._bsontype === "ObjectId") return { $oid: raw.toHexString() };
    return arguments[1];
  }));
}

/** Inverse of toSafe: {$date} -> Date, {$oid} -> ObjectId (so stored parameters can be run again). */
export function fromSafe(v) {
  if (Array.isArray(v)) return v.map(fromSafe);
  if (v && typeof v === "object") {
    if (typeof v.$date === "string" && Object.keys(v).length === 1) return new Date(v.$date);
    if (typeof v.$oid === "string" && Object.keys(v).length === 1) return ObjectId.createFromHexString(v.$oid);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fromSafe(x)]));
  }
  return v;
}

export const sha256 = (text) => createHash("sha256").update(text).digest("hex");
export const hashOf = (value) => sha256(JSON.stringify(toSafe(value)));

function entry(seq, collection, op, args) {
  const spec = op === "aggregate" ? { pipeline: args[0] } : op === "distinct" ? { field: args[0], filter: args[1] ?? {} } : { filter: args[0] ?? {} };
  const safe = toSafe(spec), text = JSON.stringify(safe);
  const stored = text.length > MAX_SPEC_CHARS ? { truncated: true, chars: text.length } : safe;
  return { seq, collection, op, spec: stored, specHash: sha256(text) };
}

/** Returns { db, log }: a drop-in db whose collections append to `log` on aggregate/find/findOne/countDocuments/distinct. */
export function recordingDb(db) {
  const log = [];
  const wrap = (coll, name) => new Proxy(coll, {
    get(target, prop) {
      const v = target[prop];
      if (typeof v !== "function") return v;
      if (RECORDED.has(prop)) return (...args) => { log.push(entry(log.length + 1, name, prop, args)); return v.apply(target, args); };
      return v.bind(target);
    },
  });
  const proxy = new Proxy(db, {
    get(target, prop) {
      if (prop === "collection") return (name, ...rest) => wrap(target.collection(name, ...rest), name);
      const v = target[prop];
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  return { db: proxy, log };
}

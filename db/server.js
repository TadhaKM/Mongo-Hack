// HTTP gateway for the MongoDB engine, so the Python backend, the agents and the frontend can all call the same
// computed, evidence-backed tools.      npm run engine        (PORT, MONGODB_URI, MONGODB_DB)
//
//   GET  /health
//   POST /analyses            { input, geocode? }                      -> { analysisId, propertyId }
//   GET  /analyses/:id                                                  -> stored analysis (results joined in, evidence embedded)
//   GET  /analyses/:id/readiness                                        -> can this analysis be shown as real Irish data?
//   GET  /analyses/:id/evidence/:evidenceId/explain                     -> why does the database say this? (query, records, sources)
//   GET  /query-runs/:id        POST /query-runs/:id/reproduce          -> the recorded queries; re-run them and compare
//   POST /tools/:name         { params, analysisId? }                   -> { ok, data, evidence[], coverage, warnings[] }
//                             with analysisId the result and evidence are stored on that analysis (callTool)
import "./lib/env.js";
import http from "node:http";
import { ObjectId } from "mongodb";
import { TOOLS, startAnalysis, callTool, runTool, getAnalysis, explainEvidence, reproduceQueryRun, reportReadiness } from "./tools/index.js";
import { policyFromEnv } from "./lib/provenance.js";

const send = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST,OPTIONS" });
  res.end(JSON.stringify(body));
};
const readJson = (req) => new Promise((resolve, reject) => {
  let s = ""; req.on("data", (c) => { s += c; if (s.length > 2e6) reject(new RangeError("body too large")); });
  req.on("end", () => { try { resolve(s ? JSON.parse(s) : {}); } catch { reject(new SyntaxError("invalid JSON")); } });
});

export function createServer(db) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x"); const path = url.pathname.replace(/\/+$/, "") || "/";
    try {
      if (req.method === "OPTIONS") return send(res, 204, {});
      if (req.method === "GET" && path === "/health") { await db.command({ ping: 1 }); return send(res, 200, { status: "ok", database: db.databaseName, dataPolicy: policyFromEnv(), tools: Object.keys(TOOLS) }); }
      if (req.method === "POST" && path === "/analyses") {
        const { input, geocode, dataPolicy } = await readJson(req);
        if (!input) return send(res, 422, { error: "input is required" });
        const { analysisId, propertyId } = await startAnalysis(db, input, geocode, { dataPolicy });
        return send(res, 201, { analysisId, propertyId });
      }
      let m = path.match(/^\/analyses\/([0-9a-f]{24})$/);
      if (req.method === "GET" && m) {
        const doc = await getAnalysis(db, m[1]);
        return doc ? send(res, 200, doc) : send(res, 404, { error: "analysis not found" });
      }
      m = path.match(/^\/analyses\/([0-9a-f]{24})\/readiness$/);
      if (req.method === "GET" && m) { const r = await reportReadiness(db, m[1]); return send(res, r.ok ? 200 : 404, r); }
      m = path.match(/^\/analyses\/([0-9a-f]{24})\/evidence\/([A-Za-z0-9_-]+)\/explain$/);
      if (req.method === "GET" && m) { const r = await explainEvidence(db, { analysisId: m[1], evidenceId: m[2], recordLimit: +(url.searchParams.get("recordLimit") ?? 100) }); return send(res, r.ok ? 200 : 404, r); }
      m = path.match(/^\/query-runs\/([0-9a-f]{24})$/);
      if (req.method === "GET" && m) { const r = await db.collection("query_runs").findOne({ _id: new ObjectId(m[1]) }); return r ? send(res, 200, r) : send(res, 404, { error: "query run not found" }); }
      m = path.match(/^\/query-runs\/([0-9a-f]{24})\/reproduce$/);
      if (req.method === "POST" && m) { const r = await reproduceQueryRun(db, m[1]); return send(res, r.ok ? 200 : 404, r); }
      m = path.match(/^\/tools\/([A-Za-z]+)$/);
      if (req.method === "POST" && m) {
        if (!TOOLS[m[1]]) return send(res, 404, { error: `unknown tool '${m[1]}'`, tools: Object.keys(TOOLS) });
        const { params = {}, analysisId, dataPolicy } = await readJson(req);
        const out = analysisId ? await callTool(db, analysisId, m[1], params) : await runTool(db, m[1], params, { dataPolicy: dataPolicy ?? policyFromEnv() });
        return send(res, 200, out);
      }
      return send(res, 404, { error: "not found" });
    } catch (e) {
      // bad input (validation in the tools) is the caller's problem, anything else is ours
      if (e instanceof RangeError || e instanceof TypeError || e instanceof SyntaxError) return send(res, 422, { error: e.message });
      console.error(e); return send(res, 500, { error: "internal error" });
    }
  });
}

if (process.argv[1]?.endsWith("server.js")) {
  const { MongoClient } = await import("mongodb");
  const client = await MongoClient.connect(process.env.MONGODB_URI ?? "mongodb://localhost:27017");
  const db = client.db(process.env.MONGODB_DB ?? "rentcheck_engine");
  const port = +(process.env.PORT ?? 8787);
  createServer(db).listen(port, () => console.log(`rentcheck engine on http://localhost:${port} (db ${db.databaseName})`));
}

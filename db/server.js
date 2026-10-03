// HTTP gateway for the MongoDB engine, so the Python backend, the agents and the frontend can all call the same
// computed, evidence-backed tools.      npm run engine        (PORT, MONGODB_URI, MONGODB_DB)
//
//   GET  /health
//   POST /analyses            { input, geocode? }                      -> { analysisId, propertyId }
//   GET  /analyses/:id                                                  -> stored analysis (results + evidence)
//   POST /tools/:name         { params, analysisId? }                   -> { ok, data, evidence[], coverage, warnings[] }
//                             with analysisId the result and evidence are stored on that analysis (callTool)
import http from "node:http";
import { ObjectId } from "mongodb";
import { Ledger } from "./lib/envelope.js";
import { TOOLS, startAnalysis, callTool } from "./tools/index.js";

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
      if (req.method === "GET" && path === "/health") { await db.command({ ping: 1 }); return send(res, 200, { status: "ok", database: db.databaseName, tools: Object.keys(TOOLS) }); }
      if (req.method === "POST" && path === "/analyses") {
        const { input, geocode } = await readJson(req);
        if (!input) return send(res, 422, { error: "input is required" });
        const { analysisId, propertyId } = await startAnalysis(db, input, geocode);
        return send(res, 201, { analysisId, propertyId });
      }
      let m = path.match(/^\/analyses\/([0-9a-f]{24})$/);
      if (req.method === "GET" && m) {
        const doc = await db.collection("analyses").findOne({ _id: new ObjectId(m[1]) });
        return doc ? send(res, 200, doc) : send(res, 404, { error: "analysis not found" });
      }
      m = path.match(/^\/tools\/([A-Za-z]+)$/);
      if (req.method === "POST" && m) {
        if (!TOOLS[m[1]]) return send(res, 404, { error: `unknown tool '${m[1]}'`, tools: Object.keys(TOOLS) });
        const { params = {}, analysisId } = await readJson(req);
        const out = analysisId ? await callTool(db, analysisId, m[1], params) : await TOOLS[m[1]](db, params, new Ledger());
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

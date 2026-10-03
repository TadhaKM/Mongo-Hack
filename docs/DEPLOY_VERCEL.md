# Deploy mend.ai on Vercel (and show the database in the video)

## What gets deployed
The **Nuxt frontend** in `frontend/` (the map, the check-a-rent flow, the report) plus its **server routes**, which Vercel runs as functions:

| Route | What it does |
|---|---|
| `/` | the app |
| `/api/*` | the app's API: listings, geocoding, analysis. Rent levels and trends are **real CSO/RTB figures** (snapshotted from the database into `frontend/server/fixtures/real-rents.json`). Listings, transport, planning and census are **sample data**, labelled as such |
| `/database` | **the database page**: live from MongoDB Atlas (counts, real vs sample, a live query with the exact pipeline and timing, a real document with its provenance, the source registry) |
| `/api/db/overview`, `/api/db/query` | the read-only endpoints behind that page |

The app works without a database connection (it uses the committed snapshot); only `/database` needs `MONGODB_URI`.

**Not deployed on Vercel:** the Python backend and AI agents (`rentcheck_person4_backend/`, `agents/`; the Gemini report) and the Node engine gateway (`db/server.js`). They need a long-running server and a large Python install, which Vercel functions are not suited to. Run them locally for the video (below) or deploy them to Render or Railway (the backend has a `Dockerfile`). The deployed frontend does not depend on them.

## Steps (about 10 minutes)

### 1. Atlas
1. **Network Access** → Add IP address → **Allow access from anywhere (0.0.0.0/0)**. Vercel's addresses change, so a fixed IP will not work.
2. Recommended: **Database Access** → add a second user (for example `mend_readonly`) with the built-in role **Read only** on `rentcheck_engine`, and use that user for Vercel. The page only reads.
3. **Change the password** of the `rentcheck` database user afterwards; it was shared in chat.
4. Check the data is there: `npm run atlas:check` (from the repo root, with `.env` filled in). You want `rental_indexes cso_riq02 ... OK` plus the sample collections.

### 2. Vercel
1. vercel.com → **Add New → Project** → import the GitHub repo `TadhaKM/Mongo-Hack` (grant access if asked).
2. **Root Directory: `frontend`** (click Edit). Framework Preset: **Nuxt** (auto-detected). Leave build and install commands as default. Node.js version 22.x or 24.x.
3. **Environment Variables** (Production, Preview and Development):

| Name | Value |
|---|---|
| `MONGODB_URI` | `mongodb+srv://<user>:<password>@cluster1.nh6mt5u.mongodb.net/?appName=Cluster1` (your Atlas string, with the real password) |
| `MONGODB_DB` | `rentcheck_engine` |

4. **Deploy.** Every push to `main` redeploys.

### 3. Check it works
Open (replace with your Vercel URL):
- `https://<your-app>.vercel.app/` loads the map; click a pin → check → watch the analysis → open the report.
- `https://<your-app>.vercel.app/database` shows "Connected to MongoDB Atlas", about 125,000 documents, REAL on `rental_indexes`, SAMPLE on the others. Press **Query the database**.
- `https://<your-app>.vercel.app/api/db/overview` returns JSON with `"connected": true`.

| Symptom | Cause |
|---|---|
| `/database` says "MONGODB_URI is not set" | the variable is missing; add it and **Redeploy** |
| "Could not connect" or the page hangs | Atlas Network Access does not allow 0.0.0.0/0 |
| "bad auth" | wrong database-user password (not your Atlas login); special characters must be URL-encoded |
| the map works but numbers look the same as before | the app uses the committed snapshot; refresh it with `npm run snapshot:frontend` and commit `frontend/server/fixtures/real-rents.json` |

## Refreshing the data
```bash
npm run atlas:setup         # real CSO/RTB rent data into Atlas (idempotent)
npm run db:demo             # sample listings, transport, planning, sales, vacancy into Atlas (labelled SYNTHETIC)
npm run snapshot:frontend   # copy the real rent figures into the frontend, then commit and push
```

## Showing the database in the video (about 2 minutes)

**1. The page (30 s)**: open `/database`. Say: "Everything is stored in MongoDB Atlas. Green means official published data, amber is clearly labelled sample data. The app refuses to present sample data as real." Point at the green `rental_indexes` row (about 124,000 documents of real CSO/RTB rent data).

**2. A live query (30 s)**: choose Trinity College, 2 bedrooms, press **Query the database**. Show the answer, the milliseconds, the exact MongoDB pipeline (`$geoNear` for "nearest place with data"), and the provenance box: source, original record id, ingestion date, loader version, data class.

**3. Atlas itself (30 s)**: cloud.mongodb.com → your cluster → **Browse Collections** → `rentcheck_engine` → `rental_indexes`. Paste this filter to show real documents:
```json
{ "areaId": "rtbzone:riq-123500", "propertyType": "apartment", "bedrooms": 2 }
```
Open one document and point at `src.sourceId`, `src.recordId`, `src.dataClass: "real"`. Then open `sources` and show the CSO source with its URL and licence.

**4. The proof trail (optional, 30 s, local)**: run the stack locally (below) and open `http://localhost:8787/analyses/<id>/evidence/<evId>/explain` to show "why did the database say this?": the recorded queries, the source records and the sources. Or run `npm run atlas:check` in a terminal to show the dataset checklist and a live evidence-producing query.

## Running the full stack locally (backend, AI agents, engine)
```bash
npm install
npm run atlas:check                         # connectivity + what data is present
# engine gateway
npm run engine                              # http://localhost:8787
# backend + Gemini agents (reads rentcheck_person4_backend/.env: MONGODB_URI, MONGODB_DATABASE=rentcheck, ENGINE_URL, GEMINI_API_KEY)
cd rentcheck_person4_backend && python -m venv .venv && .venv/Scripts/activate && pip install -r requirements.txt -e ../agents
uvicorn app.main:app --port 8000            # http://localhost:8000/docs
# frontend
cd ../frontend && npm install && npm run dev   # http://localhost:3000  (/database works if MONGODB_URI is in the environment)
```
For the frontend locally, put `MONGODB_URI=...` and `MONGODB_DB=rentcheck_engine` in `frontend/.env` (git-ignored).

## Secrets checklist
Never commit: `.env`, `agents/.env`, `rentcheck_person4_backend/.env`, `frontend/.env` (all git-ignored). The database password and the Gemini key live only in those files and in Vercel's environment variables. The browser never receives the connection string.

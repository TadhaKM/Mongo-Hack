# mend.ai

"Know Before You Rent": evidence-backed rental analysis for Irish properties. Every number in a report is computed in MongoDB or from a cited official dataset, and every claim can be checked against stored evidence.

## What is in this repository

| Folder | Owner | What it is | Run / test |
|---|---|---|---|
| [rentcheck_person4_backend/](rentcheck_person4_backend/) | Person 4 | FastAPI backend: REST API, dataset ingestion, geocoding, Daft (optional). Mounts the AI agents at `/ai` and the MongoDB engine gateway at `/engine`. Database `rentcheck` | `pytest` |
| [agents/](agents/) | Person 2 | AI agents (planner, investigators, verifier, writer). Run in-process inside the backend | `pytest` |
| [db/](db/) | Person 1 | MongoDB engine (Node): schema, indexes, validators, geospatial queries, comparable-rental engine, time-series trends, evidence and claim verification, HTTP gateway. Database `rentcheck_engine` | `npm run db:test` |
| [docs/](docs/) | all | design documents (start with [real-data-and-integration.md](docs/real-data-and-integration.md)) | |
| [data/derived/](data/derived/) | Person 1 | geocoded place centroids for the real rent data (small, committed); generated files are git-ignored | |

## How the pieces fit

```
 frontend (Person 3)
      |  REST
      v
 FastAPI backend (rentcheck_person4_backend)  --- ingest.py ---> MongoDB db "rentcheck"   (rent_index, transport_stops, ...)
   /property /analyse /analysis/*  /agent/*  /daft/*
   /ai/*      -> agents (in-process; read the backend services)
   /engine/*  -> HTTP -> Node engine gateway (db/server.js) ---> MongoDB db "rentcheck_engine"
                          comparables, rent trends, geospatial, evidence, verifyClaims
```
Two databases on purpose: the backend and the engine use different collection shapes (the backend's are loaded by its importers, the engine's are validated and indexed for computation). The **same real data** is loaded into both (see below), so the AI report and the engine's evidence agree.

## Quick start (everything on one machine)

```bash
# 0. MongoDB running locally (or set MONGODB_URI), Node 20+, Python 3.11+
npm install

# 1. REAL rent data (CSO / RTB, open licence). Place centroids are already geocoded in data/derived/.
node db/scripts/importRiq02.js            # downloads RIQ02, loads the engine DB, writes the backend's import files

# 2. Backend + agents
cd rentcheck_person4_backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -e ../agents
cp .env.example .env                       # set MONGODB_URI, ENGINE_URL=http://localhost:8787 (+ GEMINI_API_KEY for the LLM writer)
python scripts/ingest.py seed-sources
python scripts/ingest.py boundary --path ../data/derived/riq02_rtb_areas.geojson --collection rtb_areas --dataset-id riq02_rtb_areas --source-url https://data.cso.ie/table/RIQ02
python scripts/ingest.py riq02 --path ../data/derived/riq02_rtb.csv
uvicorn app.main:app --reload              # http://localhost:8000/docs

# 3. Engine gateway (second terminal, repo root)
npm run engine                             # http://localhost:8787  (PORT, MONGODB_URI, MONGODB_DB)

# 4. Try it on a real address
python scripts/e2e_real_data.py 53.3438 -6.2546 2 apartment 2600          # backend + data
curl -X POST localhost:8000/engine/tools/rentContext -H 'content-type: application/json' \
  -d '{"params":{"lng":-6.2546,"lat":53.3438,"propertyType":"apartment","bedrooms":2,"askingRent":2600}}'
```

## MongoDB Atlas (shared database for the whole team)

1. Atlas: create a **database user** (Database Access) and allow your IP (Network Access; `0.0.0.0/0` is fine for a hackathon).
2. Copy the cluster's connection string (`mongodb+srv://<user>:<password>@<cluster>.mongodb.net/...`) into the git-ignored repo-root `.env` as `MONGODB_URI` (template: `.env.example`).
3. `npm run atlas:setup` creates the validators and indexes and loads the real CSO/RTB rent data into the engine database. `npm run atlas:check` connects and reports which datasets are present or missing in both databases, then runs a live query on the real data.
4. Backend: put the same `MONGODB_URI` and `MONGODB_DATABASE=rentcheck` in `rentcheck_person4_backend/.env`, then run the three `ingest.py` commands from the quick start.

Never commit `.env`: it holds the database password and the Atlas Model API key.

## Tests

| Command | Checks | Needs |
|---|---|---|
| `npm run db:test` | 137 (engine, comparables, trends, gateway, sync, provenance, real data) | downloads a `mongod` binary once; the real-data test needs `data/raw/riq02.json` (run the importer once) and skips itself otherwise |
| `cd rentcheck_person4_backend && pytest` | 12 | none (mongomock) |
| `cd agents && pytest` | 28 | none |

Individual engine suites: `npm run db:test:comparables`, `db:test:trends`, `db:test:server`, `db:test:sync`, `db:test:provenance`, `db:test:real`.

Evidence, provenance and the synthetic-data guard: [docs/mongodb-evidence-provenance.md](docs/mongodb-evidence-provenance.md). By default (`DATA_POLICY=real_only`) the engine returns **no figures** built from synthetic, test or unverified data; the seed data and the demo fixtures are synthetic. Set `DATA_POLICY=allow_synthetic` only for development.

## Real data in the repository

Only one real dataset is loaded so far: **CSO PxStat RIQ02** (RTB Average Monthly Rent Report; 73 quarters to 2025 Q4). Everything else the project can ingest (planning, GTFS, PPR, census) has importers but no data files in the repo, and the demo fixtures are labelled synthetic. Details and limits: [docs/real-data-and-integration.md](docs/real-data-and-integration.md).

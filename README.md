# RentCheck AI

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

## Tests

| Command | Checks | Needs |
|---|---|---|
| `npm run db:test` | 100 (engine, comparables, trends, gateway, real data) | downloads a `mongod` binary once; the real-data test needs `data/raw/riq02.json` (run the importer once) and skips itself otherwise |
| `cd rentcheck_person4_backend && pytest` | 12 | none (mongomock) |
| `cd agents && pytest` | 28 | none |

Individual engine suites: `npm run db:test:comparables`, `db:test:trends`, `db:test:server`, `db:test:real`.

## Real data in the repository

Only one real dataset is loaded so far: **CSO PxStat RIQ02** (RTB Average Monthly Rent Report; 73 quarters to 2025 Q4). Everything else the project can ingest (planning, GTFS, PPR, census) has importers but no data files in the repo, and the demo fixtures are labelled synthetic. Details and limits: [docs/real-data-and-integration.md](docs/real-data-and-integration.md).

# Person 2 → team: what the agent layer needs and provides

## Integrated app (Person 4 backend + Person 2 agents), one process
The agents are mounted inside `rentcheck_person4_backend/app/main.py` at `/ai/*` (in-process: they call the backend
services directly and save into the backend's `analyses` collection).
```bash
cd rentcheck_person4_backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -e ../agents
cp .env.example .env            # set MONGODB_URI (+ GEMINI_API_KEY, or keep it in agents/.env)
python scripts/seed_demo.py     # demo data incl. demo boundary polygons + 12-quarter RTB series
uvicorn app.main:app --reload   # http://localhost:8000/docs
```
Docker: `docker compose up --build` (build context is now the repo root so the image includes `agents/`).
Demo request: `POST /ai/analyse` `{"latitude":53.3405,"longitude":-6.2995,"monthly_rent":2200,"bedrooms":2,"property_type":"apartment"}`.
The stored result is then readable at `GET /analysis/{id}/report` (now includes `report` + `agent`).

### Backend issues: status
| # | Issue | Status |
|---|---|---|
| 1 | analysis router had no `/analysis` prefix | **fixed by Person 4** |
| 7 | `GET /health` swallowed by `/{analysis_id}` | **fixed by Person 4** (consequence of 1) |
| 2 | `rtb_area` never resolved, so rent queries had no area filter | **fixed in integration**: `resolve_geographies` now does `$geoIntersects` on a new `rtb_areas` polygon collection (load real polygons with `scripts/ingest.py boundary --collection rtb_areas`; codes must equal `rent_index.geography.code`). The seed includes a demo polygon |
| 6 | `seed_demo.py` crashed (`_record_key`) | **fixed in integration**; seed also adds demo boundaries, a Luas stop and a 12-quarter rent series |
| 8 | planning importer `NameError: ImportResult` | **fixed in integration** |
| 9 | `first()` ignored CamelCase ArcGIS keys | **fixed in integration**; ArcGIS field aliases added, and `num_residential_units` is now stored and returned |
| 3 | `rental_history` ignores bedrooms/type, capped at `years*4` rows | open (agents filter client-side and merge the comparables series) |
| 4 | `rent_index` has no tenancy counts | open (data limitation: RIQ02 has none) |
| 5 | planning `application_date` stored as a string | open (agents parse defensively) |
| 10 | planning limit 100 / transport limit 50, no date filter | open (agents word counts as minimums) |

### Person 1 vs Person 4 schema conflict: resolved by separate databases
Person 1's `db/` layer (schema v2) reuses collection names that Person 4's backend also uses (`properties`,
`analyses`, `transport_stops`, `planning_applications`, `property_sales`), and applies strict validators. It now
runs in its own database, **`rentcheck_engine`**. The backend and agents stay on **`rentcheck`**
(`MONGODB_DATABASE`). Don't point both at the same database until the schemas are merged.
To run Person 1's engine on the backend's real data, run `npm run db:sync` from the repo root after ingesting
(source `BACKEND_MONGODB_URI`/`BACKEND_MONGODB_DB`, default `rentcheck`; target `MONGODB_URI`/`MONGODB_DB`, default
`rentcheck_engine`). It is idempotent and prints what it skipped and why. Sales are not synced: PPR rows have no
coordinates. Listings are not synced either: none are stored. See the note at the top of `docs/mongodb-schema.md`.

> **Update (Person 1):** the same real rent data (CSO RIQ02) is now loaded into both databases, and the backend reaches the engine through `/engine/*` (set `ENGINE_URL`). See [real-data-and-integration.md](real-data-and-integration.md).

## For Person 1 (MongoDB). Facts about the rent data (verified today)
- **Use CSO PxStat RIQ02** ("RTB Average Monthly Rent Report"):
  `https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadDataset/RIQ02/JSON-stat/2.0/en`.
  - Dimensions: quarter (2007Q4–**2025Q4**) × bedrooms (All, One, Two, Three, Four plus, …) × property type
    (All, Detached, Semi-detached, Terrace, Apartment, Other flats) × **446 locations**, including Dublin neighbourhoods like
    "Rialto, Dublin 8".
  - Values are averages with **no tenancy counts**, and 83% of cells are null in the latest quarter.
  - The "Dublin 8"-style district rows stop at 2021; use the neighbourhood rows.
  - Watch the label quirks: "Kilmainham , Dublin 8" has a stray space before the comma.
- The RTB/ESRI Rent Index PDF (Q1 2026) is standardised by LEA but **not split by bedrooms/type**, and has no counts.
- There is no tenancy-level open data. The RTB Rent Register web tool is search-only, so don't scrape it.
  The app can only point users to it.
- So "comparables" are **aggregate cells**. The agents word it that way.

## For Person 3 (frontend). Contract
- `POST /ai/analyse` (body below) returns **SSE**. Each message is `event: <type>` + `data: <Event JSON>`:
  `{type: "step"|"plan"|"report"|"error", analysis_id, step, status: "running"|"done"|"skipped"|"failed", label, detail, data, ts}`.
  - Show `label`/`detail` per `step`.
  - `plan.data.steps[]` = `{step, label, reason}`.
  - The final `report` event's `data` is the full report.
- `POST /ai/analyse/sync` returns `{analysis_id, report, events}` (no streaming).
- `GET /ai/analysis/{id}` returns the stored doc (`report`, `agent.tool_calls`, `agent.evidence`, …).
- Body:
  ```json
  {"latitude": 53.3392, "longitude": -6.2905, "address": "optional", "eircode": "D08 XXXX (optional)",
   "monthly_rent": 2200, "bedrooms": 2, "property_type": "apartment", "floor_area_m2": null,
   "furnished": null, "listing_text": null}
  ```
  It needs lat/lng (map click), **or** an eircode/address.
- Report shape: `docs/agent-design.md` §G. Each claim has `evidence_ids`; look them up in `report.evidence[]` for
  the evidence popover (statement, source.dataset/organisation/source_url, period, geography, confidence, caveats, tool).
- Map layers: `sections[id=transport].items[].location` (stops) and `sections[id=developments].items[].location`
  (applications), plus `report.property.location`.
- Chart: `sections[id=rent_trend].items[] = {period, average_rent_eur}`.
- A sample report JSON can be generated offline: `cd agents && uv run python scripts/demo.py --no-llm --json sample_report.json`.

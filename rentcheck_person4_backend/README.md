# mend.ai — Person 4 Backend

A hackathon-ready backend and ingestion framework for Irish rental intelligence.

## What this package delivers

- FastAPI backend with stable REST contracts for Person 2 (AI agents) and Person 3 (frontend)
- MongoDB geospatial schema and indexes
- Address -> coordinates -> official boundary resolution
- NTA/TFI GTFS ingestion
- National Planning Applications ingestion via official ArcGIS REST/GeoJSON
- CSO Census 2022 SAPS / housing-vacancy loaders
- RTB/ESRI rent loader designed for **manual official-file import** (no website scraping)
- Residential Property Price Register CSV loader
- Optional Met Éireann / EPA adapters
- Data provenance and ingestion-run tracking
- Validation and deduplication hooks
- Docker Compose for MongoDB + API
- Tests for address normalisation, validation, and API contracts

## Verified official-source notes (2026-10-03)

1. **NTA GTFS** — published by the National Transport Authority, CC BY 4.0, daily updates, GTFS ZIP plus developer API. Landing page: https://www.transportforireland.ie/transitData/PT_Data.html
2. **National Planning Applications** — Department of Housing, Local Government and Heritage, CC BY 4.0, national coverage, weekly updates, official ArcGIS REST/GeoJSON. REST service: https://services.arcgis.com/NzlPQPKn5QF9v2US/arcgis/rest/services/IrishPlanningApplications/FeatureServer
3. **Census 2022 SAPS** — CSO; small-area data can be downloaded as CSV; corresponding boundaries are published by Tailte Eireann. Landing page: https://www.cso.ie/en/census/census2022/census2022smallareapopulationstatistics/
4. **CSO FP010 Housing Stock and Vacant Dwellings 2022** — CC BY 4.0; JSON-stat/CSV/XLSX resources. API example: https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadDataset/FP010/JSON-stat/1.0/en
5. **RTB/ESRI Rent Index** — quarterly rent information with location/property selections and data from end-2007 onward. Use published official downloads; the RTB website terms prohibit automated robots/scraping and restrict redistribution, so this repo intentionally does not scrape RTB pages.
6. **Residential Property Price Register** — PSRA permits free re-use subject to source acknowledgement, accurate reproduction and restrictions described on its copyright page. https://propertypriceregister.ie/website/npsra/ppr-copyright-en.html
7. **Met Eireann** — open data including observations; datasets are released under CC BY 4.0. https://www.met.ie/about-us/specialised-services/open-data
8. **EPA** — open-data REST APIs include Bathing Water, WFD, LEAP, EPR, Extractive Industries and others. https://data.epa.ie/

## Important licensing implementation rule

Do not treat every official webpage as an open-data licence. `data_sources` records preserve the exact source URL, licence text/identifier, attribution requirement and an internal `usage_note`.

RTB is deliberately configured for manual file ingestion only because its current website Terms of Use prohibit automated processes/robots for viewing/downloading/copying website content and place restrictions on modification, commercial use and redistribution.

## Quick start

### 1. Start MongoDB + API

```bash
docker compose up --build
```

API docs: http://localhost:8000/docs
Health: http://localhost:8000/health

### 2. Configure environment

```bash
cp .env.example .env
```

For local hackathon use, the default Mongo URI points at the Compose Mongo service.

### 3. Ingest NTA GTFS

Download the current official operator GTFS ZIPs from the TFI public transport data page and place them under `data/raw/nta/`.

Example files seen in current official-feed mirrors include:
- `GTFS_Bus_Eireann.zip`
- `GTFS_LUAS.zip`
- `GTFS_Irish_Rail.zip`

Then:

```bash
python scripts/ingest.py nta --path data/raw/nta
```

### 4. Ingest planning applications

Use the official ArcGIS REST layer directly:

```bash
python scripts/ingest.py planning --url 'https://services.arcgis.com/NzlPQPKn5QF9v2US/arcgis/rest/services/IrishPlanningApplications/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson'
```

For large loads, prefer the included paginated REST importer instead of a single giant request.

### 5. Ingest PPR

Place an official/current CSV export under `data/raw/ppr/` and run:

```bash
python scripts/ingest.py ppr --path data/raw/ppr/current.csv
```

### 6. Ingest RTB

Manually download the official RTB/ESRI file the team is permitted to use, place it under `data/raw/rtb/`, then run:

```bash
python scripts/ingest.py rtb --path data/raw/rtb/your_official_file.csv
```

The RTB loader accepts flexible column aliases and stores every row with provenance plus a matching-method field.

## API contract

### Property

`POST /property`

```json
{
  "address": "25 Example Street, Dublin 8",
  "eircode": null,
  "property_type": "apartment",
  "bedrooms": 2,
  "latitude": null,
  "longitude": null
}
```

### Analyse

`POST /analyse`

```json
{
  "property_id": "property_...",
  "requested_analysis": ["rental", "transport", "planning", "neighbourhood", "sales"]
}
```

### Evidence endpoints

- `GET /analysis/{analysis_id}`
- `GET /analysis/{analysis_id}/comparables`
- `GET /analysis/{analysis_id}/transport`
- `GET /analysis/{analysis_id}/planning`
- `GET /analysis/{analysis_id}/neighbourhood`
- `GET /analysis/{analysis_id}/sales`
- `GET /analysis/{analysis_id}/report`

## Agent tools

Person 2 should call the REST endpoints (or the same service layer) for:

- `getProperty`
- `getRentalComparables`
- `getRentalHistory`
- `getNearbyTransport`
- `getNeighbourhoodData`
- `getNearbyPlanning`
- `getPropertySales`

The AI agent should never query MongoDB directly.

## Canonical geographic representation

All GeoJSON points use `[longitude, latitude]`.

A property stores the resolved hierarchy separately:

```json
{
  "county": {...},
  "local_authority": {...},
  "electoral_division": {...},
  "local_electoral_area": {...},
  "small_area": {...},
  "rtb_area": {...}
}
```

Only use exact official codes where available. Never infer that similarly named areas are equivalent.

## Project layout

```text
app/
  api/          FastAPI routes
  db/           MongoDB client/indexes
  geo/          geocoding + boundary helpers
  ingestion/    dataset adapters + validators
  models/       Pydantic request/response contracts
  services/     business logic
scripts/        CLI ingestion runner
source_catalog.json  official source catalogue
```

## Production/hackathon deployment

Recommended hackathon deployment:

```text
Vercel/Netlify frontend
        |
        v
Render/Fly.io/Railway FastAPI
        |
        v
MongoDB Atlas
        |
        +--> raw data object storage (optional)
```

For the demo, pre-ingest everything spatial and use MongoDB `$near` / `$geoWithin`.

## Data quality principles

Every imported record gets:

- source organisation
- dataset name
- source URL
- retrieval timestamp
- source/dataset period
- pipeline version
- validation status
- deterministic record key

Outliers are flagged rather than silently deleted.

## Not a valuation engine

PPR data is historical sales evidence, not rental value. RTB/ESRI data is area/property-characteristic rental evidence, not a guaranteed valuation of an individual dwelling. The API therefore returns explicit match metadata and data vintage.

## Daft.ie API V3 (optional)

This project contains an optional live Daft.ie V3 SOAP adapter. It is disabled by default and requires a real authorised Daft API key. See `HANDOFF_TO_TEAM.md` for the relevant terms and setup. Do not put the API key in Git.

### Testing Daft after authorisation

After installing dependencies and configuring a real authorised Daft API key in `.env`, create/use a test property, then run:

```bash
python scripts/daft_smoke_test.py <property_id> --kind rental --radius-m 5000 --limit 5
```

The script performs one live search and prints the returned evidence. It does not save the results to MongoDB.

# RentCheck AI — Person 4 Handoff

## What this folder is

This is Person 4's backend + external-data integration layer. It is designed to be combined with the other team members' work, not replace it.

## What Person 4 owns

- FastAPI REST API
- MongoDB access contract and geospatial indexes
- External dataset ingestion adapters
- Address/geography resolution helpers
- Evidence query services
- Source provenance and validation
- Agent-facing tool endpoints

## How the team should combine the work

### Person 1 — MongoDB / data layer

Keep the team's agreed MongoDB database. Merge these from Person 4:

- `schema.json`
- `app/db/`
- collection/index definitions in `app/db/indexes.py`
- the canonical property/geography shape in `app/models/schemas.py`

Person 1 can keep their own connection/config code if it is already better; the important thing is that the API sees the same collection names and field names.

### Person 2 — AI agents

Do NOT query MongoDB directly.

Call the Person 4 agent/API functions:

- `getProperty`
- `getRentalComparables`
- `getRentalHistory`
- `getNearbyTransport`
- `getNeighbourhoodData`
- `getNearbyPlanning`
- `getPropertySales`

Each response contains evidence plus source/provenance information.

### Person 3 — frontend

Do NOT call RTB/CSO/NTA/Planning/PPR directly.

Call the stable REST API:

- `POST /property`
- `POST /analyse`
- `GET /analysis/{id}`
- `GET /analysis/{id}/comparables`
- `GET /analysis/{id}/transport`
- `GET /analysis/{id}/planning`
- `GET /analysis/{id}/neighbourhood`
- `GET /analysis/{id}/sales`
- `GET /analysis/{id}/report`

## The contract that must not drift

### Canonical location

Use GeoJSON everywhere:

```json
{
  "type": "Point",
  "coordinates": [-6.3000, 53.3400]
}
```

The order is `[longitude, latitude]`.

### Canonical property

```json
{
  "property_id": "property_123",
  "address": {
    "raw": "25 Example Street, Dublin 8",
    "normalised": "25 EXAMPLE STREET DUBLIN 8",
    "eircode": null
  },
  "location": {
    "type": "Point",
    "coordinates": [-6.3000, 53.3400]
  },
  "geography": {
    "county": {},
    "local_authority": {},
    "electoral_division": {},
    "local_electoral_area": {},
    "small_area": {},
    "rtb_area": {}
  },
  "property_attributes": {
    "property_type": "apartment",
    "bedrooms": 2
  }
}
```

Do not replace the location object with `lat`/`lng` fields only.

## Dataset ownership

Person 4 owns the adapters for:

- NTA GTFS
- National Planning Applications
- CSO Census/SAPS
- CSO vacancy
- RTB/ESRI published files
- PPR
- optional Met Éireann
- optional EPA

The repository does not contain restricted/raw third-party data. Put downloaded data under `data/raw/` locally or in object storage.

## RTB rule

Do not build a scraper for RTB pages. Use official downloadable files that the team is permitted to use. The RTB loader is intentionally manual-file based.

## Integration sequence

1. Agree collection names and canonical schema.
2. Start MongoDB.
3. Run the API.
4. Run `scripts/ingest.py` for the datasets being used in the demo.
5. Verify `/health` and `/docs`.
6. Person 2 connects agents to the API.
7. Person 3 connects frontend to the API.
8. Keep all raw-source parsing behind `app/ingestion/`.

## What can be changed safely

- UI design
- AI prompts/agent orchestration
- deployment provider
- raw-file storage location
- individual ingestion implementation details, provided the output schema stays stable

## What should be agreed before changing

- MongoDB collection names
- canonical property JSON
- GeoJSON coordinate order
- endpoint names/request/response shape
- source/provenance fields
- meaning of geographic codes

## One-line architecture

External Irish datasets -> ingestion -> normalisation/validation -> MongoDB -> FastAPI -> AI agents + frontend

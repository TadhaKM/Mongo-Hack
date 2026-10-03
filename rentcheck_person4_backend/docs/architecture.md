# RentCheck AI — Backend Architecture

```text
                         OFFICIAL IRISH DATA
 ┌──────────┬──────────┬──────────┬───────────┬───────────┐
 │ RTB/ESRI │ NTA/TFI  │   CSO    │ Planning  │   PSRA    │
 │ rent     │ GTFS     │ Census   │ NPAD      │ PPR       │
 └────┬─────┴────┬─────┴────┬─────┴─────┬─────┴─────┬─────┘
      │           │          │           │           │
      └───────────┴──────────┴─────┬─────┴───────────┘
                                   ▼
                         INGESTION ADAPTERS
                                   │
                          raw -> parse ->
                      normalise -> validate ->
                         provenance -> upsert
                                   │
                                   ▼
                              MONGODB
        ┌─────────────────────────────────────────────────────┐
        │ spatial collections + source metadata + indexes    │
        │ properties / stops / planning / boundaries         │
        │ rent / census / vacancy / sales / analyses         │
        └──────────────────────────┬──────────────────────────┘
                                   │
                         SERVICE / QUERY LAYER
                                   │
                                   ▼
                               FASTAPI
                         ┌─────────┴─────────┐
                         ▼                   ▼
                    PERSON 2             PERSON 3
                    AI AGENTS             FRONTEND
```

## Team contract

Person 1 owns MongoDB/data-layer evolution. Person 4 owns data ingestion and stable API contracts. Person 2 consumes only evidence APIs/agent tools. Person 3 consumes only REST JSON.

## Geography contract

- GeoJSON point: `[longitude, latitude]`
- Geographic systems are stored separately; name similarity is never treated as equivalence.
- Property point is canonical for radius searches.
- Official boundary polygons are used for point-in-polygon resolution.
- RTB geography is a separate mapping field; there is no generic `area` field.

## Evidence contract

Every evidence object should expose:

- dataset name
- organisation
- official source URL
- retrieval date
- dataset period/year
- geographic matching method
- property matching method, where relevant
- limitations/interpretation note

## Demo performance contract

All large datasets are preloaded. User requests never download/parse source datasets. Spatial lookups use MongoDB `2dsphere` indexes.

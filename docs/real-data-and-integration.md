# Real data and integration: what was merged, what runs, what is still approximate

Written after pulling the team's work (Person 2's agents, Person 4's backend, the Daft package) into the MongoDB engine.

## 1. What changed in the repository

| Change | Why |
|---|---|
| **One backend folder.** `rentcheck_person4_backend_FINAL_PACKAGE` was a pure superset of the integrated `rentcheck_person4_backend` in docs, schema and catalog, but its code lacked the integration fixes (agents mounted at `/ai`, `rtb_areas` resolution, planning importer fixes). The integrated folder is the base, with every Daft addition (client, routes, config, tests, smoke script, catalog entry) overlaid. The duplicate folder was removed (recoverable from git history) | two diverging copies of the same app would have rotted |
| **Backend ingestion fixes** | (a) `_record_key`, the upsert key every importer uses, had **no index**, so each upsert scanned the whole collection; a 138k-row load never finished. Now a partial unique index; the same load takes ~75 s. (b) Importers wrote one document per round trip; now `bulk_write` in batches of 1,000. Both are in `app/db/indexes.py` and `app/ingestion/base.py` |
| **New `riq02` importer** (`app/ingestion/rtb.py`, `scripts/ingest.py riq02`) | The existing RTB importer hard-codes its dataset as the "RTB/ESRI Rent Index". RIQ02 is a *different* dataset (average rent of newly registered tenancies, not the standardised index), so it gets its own dataset id, organisation and source URL. Provenance would otherwise be wrong |
| **Engine gateway** `db/server.js` + backend routes `/engine/*` (`app/api/engine.py`) | the Node engine was unreachable from the Python app. Disabled with a clear 503 until `ENGINE_URL` is set |
| **Engine schema additions** | `rental_indexes.measure` gains `registered_average`; property type gains `other_flat`; counties are a separate level from places |
| **Official-index trend is now gap-safe** | `rentTrend` used `$shift` by documents; real RIQ02 series have suppressed quarters, which made year-on-year compare the wrong quarters. It now `$densify`s first |
| **Root `README.md`** | there was none |

Not changed: Person 2's agent code and Person 3's work (none yet in the repo). Daft stays optional and disabled by default.

## 2. Database topology

| Database | Used by | Loaded by |
|---|---|---|
| `rentcheck` | backend API and agents (collections `properties`, `rent_index`, `transport_stops`, `rtb_areas`, `analyses`, ...) | `scripts/ingest.py` (the backend's own importers) |
| `rentcheck_engine` | the MongoDB engine (`areas`, `rental_indexes`, `rental_observations`, `analyses`, evidence, ...) | `node db/scripts/importRiq02.js` and the engine's other loaders |

They stay separate because the two models share collection names with different shapes (`properties`, `analyses`, `transport_stops`, ...) and the engine applies strict validators. The bridge is the data (the same real rows go into both) and the `/engine` gateway (results go to the API).

## 3. The real data

**CSO PxStat RIQ02, "RTB Average Monthly Rent Report"** (open, CC BY 4.0). Downloaded from the CSO API; version 2026-05-14.

| | |
|---|---|
| Shape | 73 quarters (2007 Q4 to 2025 Q4) x 7 bedroom bands x 6 property types x 446 places |
| What a value is | average monthly rent of **newly registered tenancies**. No sample sizes. About 83% of cells are suppressed in the latest quarter |
| Loaded (backend) | 138,252 rows since 2015 through `ingest.py riq02`; 276 nearest-place regions through `ingest.py boundary` |
| Loaded (engine) | 356 places (330 places + 26 counties), 123,547 `rental_indexes` since 2015; measure `registered_average`, source `cso_riq02` |
| Not loaded | the bedroom ranges "1 to 2 bed" and "1 to 3 bed" (138,617 cells); the 90 places with no figure in the last 12 quarters (356 of 446 places were geocoded, all 356 resolved) |

**Verified:** the engine test re-reads the raw CSO cube independently and checks that real values round-trip (for example Dublin, 2-bed apartment, 2025 Q4 = EUR 2,283.59) and that 20 random cells match.

### Where the approximation is (read this)
1. **CSO publishes no coordinates for the 446 places.** Centroids were geocoded once with OpenStreetMap Nominatim (c) OpenStreetMap contributors, ODbL, and cached in `data/derived/riq02_locations.json`. A sanity check against each "Town, County" place's county centroid flagged nothing, but these are place centres, not boundaries.
2. **Matching a property to a place is therefore approximate.**
   - The backend uses nearest-place regions (Voronoi cells around the place centroids), so an address gets the closest named place.
   - The engine picks the **nearest place that actually has a recent figure** for the requested bedrooms and type (most cells are suppressed), and says how far away it is and how many nearer places had no figure. Example: Trinity College Dublin resolves to a nearby Dublin place, not the county.
3. **Counties are a different level from places and are never mixed with them.** If no place is within 30 km with a figure, the engine falls back to the **county-wide** average, labels it as such in the claim, the warning and the evidence (`areaLevel: county`), and compares it only with other counties.
4. **Republic of Ireland only.** RIQ02 does not cover Northern Ireland. A point near the border could still match a southern county within 90 km; there is no national polygon to stop it.
5. **It is not the standardised RTB/ESRI index.** The two live under different measures (`registered_average` vs `index_mean`) and are never merged. The engine prefers `index_mean` when a zone has both.
6. **No listings.** RIQ02 has no individual rents, so the comparable-rental engine returns `status: none` with the official cross-check beside it until a legitimate listings source exists.

### Listings and Daft
The Daft terms recorded in `source_catalog.json` forbid pre-fetching, caching or storing search results. Therefore **Daft results must not be loaded into `rental_observations`**, and they are not. Daft stays a live, non-persisted lookup in the backend. The engine's listing store needs a source whose licence allows storage, or stays empty; the engine reports that honestly rather than inventing comparables.

## 4. What runs end to end (verified)

On a real `mongod`, with the real data loaded through both pipelines:

| Check | Result |
|---|---|
| Backend: property at Trinity College -> `rtb_area` | "Pearse Street, Dublin 2" (correct), 10 real quarterly rows, `cso_riq02` provenance |
| Backend: Cork city centre, 1-bed apartment | "Cork City", 2025 Q4 average EUR 1,252.96 |
| Backend: Galway, 3-bed terraced | "Galway City", relaxed to house/apartment matches and labelled as relaxed |
| Agents: `/ai/analyse/sync` for Trinity College | full report, 7 sections, evidence cites `cso_riq02`, no LLM key needed for the offline path |
| Engine: `rentContext` for the same point | place used and its distance, asking EUR 2,600 vs the average with the difference and band, multi-year trend with year-on-year, surrounding places; about 10 evidence items with ids |
| Engine over HTTP, and through the backend proxy | same envelope; bad input is a 422, unknown tool a 404, engine down a 502, not configured a 503 |

Test totals: engine 100, backend 12, agents 28. Run `npm run db:test`, then `pytest` in `rentcheck_person4_backend` and `agents`.

## 5. For each teammate

**Person 2 (agents).** Your in-process tools still read the backend (`rentcheck`), now with real rent data. To use computed, verified evidence as well, call the engine through the backend: `POST /engine/tools/{tool}` with `{params, analysis_id?}`. Useful tools: `rentContext` (official rent picture at a point), `rentalComparables` (scored comparables; `none` until listings exist), `rentalTrend` (monthly/quarterly/yearly from listings), `nearbyTransport`, `nearbyPlanning`, `verifyClaims` (check every number you state against stored evidence). Every result is `{ok, data, evidence[], coverage, warnings[]}`; quote `evidence[].value`, cite `evidence[].id`, repeat `warnings`.

**Person 3 (frontend).** Keep using the stable REST API and `/ai/analyse`. Optionally call `/engine/tools/rentContext` for a ready-made chart series (`data.trend.series`, gaps are `null`) and the surrounding-places distribution.

**Person 4 (backend/data).** Please keep: the `_record_key` index, batched writes, the separate `cso_riq02` dataset id. Next real datasets to load through your importers (each already has an importer): planning (ArcGIS REST), GTFS, PPR, CSO census/vacancy. When they land, the engine loaders in `db/` can read them the same way `importRiq02.js` reads RIQ02. Normalise `terraced`/`semi-detached`/`detached` consistently: the importer maps them to `house`, but a user-supplied `terraced` does not match `house` today, which forces a relaxed match.

## 6. Known gaps
- No real planning, transport, sales or census data in the repository (importers exist; files are not committed). The engine's tools for those run on synthetic seed data until real files are loaded.
- The engine and the backend do not share a collection model; there is no automatic sync of non-rent datasets between them yet.
- Place matching is approximate (section 3), and county fallback is coarse by nature.

# mend.ai: MongoDB Architecture (Person 1)

> **Early overview, partly superseded.** The collection list and schemas in this first document were refined: the current, authoritative model is [mongodb-schema.md](mongodb-schema.md). The boundary table (section 0) and the feature rationale still apply.

Assumptions: MongoDB Atlas M10+ (MongoDB 7.0+ / 8.0 for `$percentile`, time series, Atlas Search, Vector Search), Node.js driver. Change if the team differs.

---

## 0. Ownership boundary

| | P1 MongoDB | P2 AI agents | P3 Frontend | P4 Backend / Data |
|---|---|---|---|---|
| **Owns** | Schemas, validators, indexes, geo model, aggregation pipelines, materialised views, time-series, Search/Vector indexes, provenance + evidence model, the `db-tools` module | Orchestration, prompts, tool definitions, reasoning, report text, claim checking against evidence | UI, maps, charts, state | Dataset discovery, download, cleaning, geocoding, ingestion, REST API, caching, auth |
| **Does** | All numeric/spatial/statistical computation. Returns *facts + evidence IDs* | Decides *which* tool to call, interprets, writes prose | Renders what the API returns | Writes raw→clean docs *into* P1's schemas; exposes P1's functions over HTTP |
| **Never does** | Fetch datasets, call LLMs (except embedding if agreed), render UI | Compute medians/distances/counts itself | Query Mongo | Define indexes/pipelines |
| **Contract** | `ingest-contract.md` (P4 must conform) + `db-tools` function signatures (P2/P4 consume) | Calls `db-tools` only; cites `evidenceId`s | Gets `AnalysisResult` JSON via P4 | Imports `db-tools`, serves it |

**Rule of thumb:** if the answer is a number, a distance, a count, a ranking or a "is X inside Y", MongoDB computes it. The AI only interprets numbers that came back with an `evidenceId`.

---

## 1. Collections

| Collection | Type | Content | Source |
|---|---|---|---|
| `sources` | regular | Dataset registry: publisher, licence, URL, version, geography level, refresh cadence | P4 |
| `ingestion_runs` | regular | Run id, source, counts in/out/rejected, checksums, timestamps | P4 |
| `geographies` | regular | Polygons: small areas (CSO SA), electoral divisions, LEAs, counties, RTB zones | CSO / OSi boundaries |
| `geo_crosswalk` | regular | Maps RTB/ESRI geography keys to `geographies` ids | P4 + P1 |
| `census_small_area` | regular | Census 2022 SAPS stats per small area | CSO |
| `rent_index` | regular | RTB/ESRI index cells: geography × beds × type × quarter | RTB |
| `rent_observations` | **time series** | Any dated rent datapoints (RTB quarterly averages, listings if P4 sources them) | RTB / other |
| `rtb_disputes` | regular | Dispute counts/outcomes by geography × period × category | RTB |
| `rtb_terminations` | regular | Notices of termination by geography × period × ground | RTB |
| `transport_stops` | regular | GTFS stops as GeoJSON Points + mode + routes served | NTA/TFI |
| `stop_service_stats` | materialised | Trips/hour per stop per time band (from `stop_times`) | derived |
| `planning_applications` | regular + Search + Vector | Point, status, dates, units, description, embedding | National Planning |
| `property_sales` | regular | PPR sales: Point (geocoded), price, date, address, `geoConfidence` | PPR |
| `housing_vacancy` | regular | CSO vacancy / stock by geography × period | CSO |
| `climate_daily` | **time series** | Met Éireann station daily readings | Met Éireann |
| `weather_stations` | regular | Station points | Met Éireann |
| `environment_features` | regular | EPA features (noise, flood, etc.) as GeoJSON | EPA |
| `neighbourhood_profiles` | materialised view | One doc per small area: all metrics pre-joined | derived (P1) |
| `knowledge_chunks` | regular + Vector | RTB rules, dataset caveats, method notes as embedded chunks | P1 |
| `analyses` | regular (TTL optional) | One doc per user request: input, resolved geos, tool calls, results | runtime |
| `evidence` | regular | Immutable evidence items cited by analyses | runtime |
| `address_cache` | regular, TTL | Geocode results | P4 |

### Why one database, many collections (not one giant document)
Datasets have different grain, refresh cycles and sizes (GTFS ~100k+ stops, PPR ~500k+ rows). They are joined **spatially**, not by foreign key, so the unit of integration is the **geography id** and the **GeoJSON point**.

---

## 2. Universal document envelope

Every ingested document carries:

```jsonc
{
  "_id": ObjectId,
  "geo": { "type": "Point", "coordinates": [-6.2603, 53.3498] },   // [lng, lat] always
  "areaIds": { "sa": "268001001", "ed": "...", "lea": "...", "county": "Dublin City" },
  "_prov": {
    "sourceId": "rtb_rent_index",        // -> sources._id
    "datasetVersion": "2025Q2",
    "ingestRunId": ObjectId,
    "retrievedAt": ISODate,
    "sourceRowRef": "sheet2!R145",        // row/line in raw file, enables audit
    "licence": "CC-BY-4.0",
    "geoMethod": "eircode|address-match|centroid|polygon",
    "geoConfidence": 0.0-1.0
  }
}
```

**Why:** provenance on every row means any number returned to the AI can be traced to dataset + version + source row. This is the backbone of the hallucination defence.
**Why denormalise `areaIds`:** point-in-polygon at ingest (once) turns every later "what's in this area" into an indexed equality match instead of a spatial join per query. Script: `db/enrichGeo.js` (batched `$geoIntersects` on `geographies`, `bulkWrite`).

---

## 3. Key schemas

### `geographies`
```jsonc
{ "_id": "sa:268001001", "level": "small_area",
  "name": "...", "county": "...", "parents": {"ed":"...", "lea":"...", "county":"..."},
  "geometry": { "type": "MultiPolygon", "coordinates": [...] },
  "centroid": { "type":"Point", "coordinates":[...] },
  "areaKm2": 0.31 }
```
Indexes: `{geometry:"2dsphere"}`, `{level:1, "parents.lea":1}`, `{centroid:"2dsphere"}`.

### `rent_index`
```jsonc
{ "geoKey": "lea:dublin-city-central", "geoLevel": "lea",
  "propertyType": "apartment", "beds": 2, "period": "2025Q2", "periodStart": ISODate,
  "avgRent": 2214, "stdErr": 41, "n": 312, "_prov": {...} }
```
Indexes: `{geoKey:1, propertyType:1, beds:1, periodStart:-1}` (unique), `{periodStart:-1, geoLevel:1}`.
Equality (geoKey, type, beds) → sort/range (period): ESR order.

### `rent_observations` (time series)
```js
db.createCollection("rent_observations", {
  timeseries: { timeField:"ts", metaField:"meta", granularity:"months" },
  expireAfterSeconds: undefined })
// meta: { geoKey, geoLevel, propertyType, beds, sourceId }
// measurements: avgRent, n, stdErr
```
Secondary index: `{ "meta.geoKey":1, "meta.propertyType":1, "meta.beds":1, ts:-1 }`.

### `transport_stops`
```jsonc
{ "stopId":"8220DB000002", "name":"...", "geo":{Point}, "modes":["bus","luas"],
  "routes":[{"routeShort":"46A","agency":"Dublin Bus"}], "wheelchair":true, "_prov":{} }
```
Index: `{geo:"2dsphere"}`, `{modes:1, geo:"2dsphere"}`.

### `stop_service_stats`
```jsonc
{ "stopId":"...", "weekdayPeakTripsPerHour": 14, "weekdayOffPeakTripsPerHour": 6,
  "weekendTripsPerHour": 4, "firstDeparture":"05:40", "lastDeparture":"23:50", "feedVersion":"..." }
```
Built once per GTFS refresh by pipeline on `stop_times` (P4 loads raw `stop_times` into a staging collection; P1 pipeline `$group`s → `$merge`).

### `planning_applications`
```jsonc
{ "ref":"3456/24", "authority":"Dublin City Council", "geo":{Point},
  "receivedDate":ISODate, "decisionDate":ISODate, "status":"granted|refused|pending|withdrawn",
  "devType":"residential", "units": 42, "description":"...", "embedding":[...1024], "_prov":{} }
```
Indexes: `{geo:"2dsphere", status:1, receivedDate:-1}` (compound geo + equality prefix works for `$geoNear` with `query`), Atlas Search index on `description`, Vector index on `embedding` with filter fields `status`, `devType`.

### `property_sales`
```jsonc
{ "address":"...", "geo":{Point}, "saleDate":ISODate, "price":385000, "vatExclusive":false,
  "newDwelling":false, "areaIds":{}, "geoConfidence":0.82, "_prov":{} }
```
Indexes: `{geo:"2dsphere", saleDate:-1}`, `{ "areaIds.sa":1, saleDate:-1 }`. Atlas Search autocomplete on `address`.

### `evidence`
```jsonc
{ "_id":"ev_7f3a…",            // deterministic hash(tool, params, resultDigest)
  "analysisId": ObjectId,
  "tool":"getRentalComparables",
  "claimType":"median_rent",
  "value": 2180, "unit":"EUR/month",
  "context": {"geoKey":"lea:…","beds":2,"period":"2025Q2","n":312},
  "sources":[{"sourceId":"rtb_rent_index","version":"2025Q2","rowRefs":["…"]}],
  "pipelineName":"rentComparables@v3",
  "computedAt":ISODate }
```
Index: `{analysisId:1}`, `{_id:1}`.

---

## 4. Features: why / where / query / output

All functions live in `db/tools/*.ts`, return the **standard envelope**:

```jsonc
{ "ok":true, "data":{...}, "evidence":[{"id":"ev_…","claim":"…","value":…}],
  "coverage":{"geoMatch":"small_area","dataAsOf":"2025Q2","n":312,"confidence":"high|medium|low"},
  "warnings":["Rent index is area-level, not property-level"] }
```
"No data" returns `ok:true, data:null, coverage.confidence:"none"`. It never returns a plausible empty guess.

### 4.1 Resolve location → geographies
- **Why Mongo:** point-in-polygon on real boundaries; every other tool keys off the result.
- **Why not AI:** LLMs guess "Rathmines is in Dublin 6", which is wrong at LEA/ED level.
- **Query:**
```js
db.geographies.find({ geometry:{ $geoIntersects:{ $geometry:{type:"Point",coordinates:[lng,lat]} } } },
                    { level:1, name:1, parents:1 })
```
- **Output:** `{ sa, ed, lea, county, rentGeoKey }`; `rentGeoKey` found via `geo_crosswalk`, since RTB geography ≠ CSO geography.

### 4.2 `getRentalComparables({lng,lat,beds,type,askingRent,radiusM})`
- **What it really is:** RTB/ESRI index cells (area-level) for the property's geography, plus neighbouring areas, plus optional listings if P4 sources them. **It is not individual comparable listings** unless such a dataset exists. Say so in `warnings`.
- **Why Mongo:** percentile, z-score and rank over a distribution is a stats job; the model would approximate.
- **Pipeline (neighbour cells, latest period):**
```js
db.geographies.aggregate([
  { $geoNear:{ near:pt, key:"centroid", distanceField:"d", maxDistance:radiusM,
               query:{ level:"lea" }, spherical:true } },
  { $lookup:{ from:"rent_index", let:{k:"$_id"},
      pipeline:[ { $match:{ $expr:{ $eq:["$geoKey","$$k"] }, propertyType:type, beds } },
                 { $sort:{ periodStart:-1 } }, { $limit:1 } ], as:"cell" } },
  { $unwind:"$cell" },
  { $group:{ _id:null,
      rents:{ $push:"$cell.avgRent" },
      median:{ $median:{ input:"$cell.avgRent", method:"approximate" } },
      pcts:{ $percentile:{ input:"$cell.avgRent", p:[0.25,0.75], method:"approximate" } },
      mean:{ $avg:"$cell.avgRent" }, sd:{ $stdDevPop:"$cell.avgRent" }, n:{ $sum:1 } } },
  { $set:{ z:{ $divide:[{ $subtract:[askingRent,"$mean"] },"$sd"] },
           pctRank:{ $size:{ $filter:{ input:"$rents", cond:{ $lte:["$$this",askingRent] } } } } } }
])
```
- **Output:** `{ ownCell:{avgRent,period,n}, neighbours:{median,p25,p75,n}, asking:{vsOwnCellPct:+8.1, zScore:1.2, percentile:84}, label:"above_market" }`. The label thresholds are set in the DB function, not the prompt.

### 4.3 `getRentalHistory(geoKey,beds,type,months)`
- **Why Mongo:** time-series collection compresses and bucket-scans efficiently; window functions do trend maths.
- **Pipeline:**
```js
db.rent_observations.aggregate([
 { $match:{ "meta.geoKey":k, "meta.beds":b, "meta.propertyType":t, ts:{ $gte:from } } },
 { $setWindowFields:{ sortBy:{ts:1}, output:{
     yoyPct:{ $shift:{ output:"$avgRent", by:-4 } },        // 4 quarters back
     ma4:{ $avg:"$avgRent", window:{ documents:[-3,0] } } } } },
 { $set:{ yoyPct:{ $multiply:[{ $divide:[{ $subtract:["$avgRent","$yoyPct"] },"$yoyPct"] },100] } } }
])
```
- **Output:** array `[{period, avgRent, ma4, yoyPct}]` + summary `{cagr, peak, latestYoY}`, ready for P3's chart.

### 4.4 `getNearbyTransport(lng,lat,radiusM)`
- **Why Mongo:** `$geoNear` over 2dsphere returns sorted distance cheaply; join to precomputed frequency.
- **Pipeline:**
```js
db.transport_stops.aggregate([
 { $geoNear:{ near:pt, distanceField:"m", maxDistance:radiusM, spherical:true } },
 { $lookup:{ from:"stop_service_stats", localField:"stopId", foreignField:"stopId", as:"svc" } },
 { $unwind:"$svc" },
 { $group:{ _id:"$modes", stops:{ $push:{ name:"$name", m:"$m", tph:"$svc.weekdayPeakTripsPerHour" } },
            nearest:{ $min:"$m" }, peakTph:{ $sum:"$svc.weekdayPeakTripsPerHour" } } }
])
```
- **Output:** per mode `{nearestM, stopsWithin, peakTripsPerHour, topStops[]}` + a `transportScore` (0–100, formula versioned and stored in the evidence). Distance is straight-line; a `walkMinutesEst = m*1.3/80` field is labelled an estimate.

### 4.5 `getNearbyPlanning(lng,lat,radiusM,sinceYears)`
- **Why Mongo:** spatial + date + status aggregation; Atlas Search for keyword (e.g. "student accommodation", "demolition").
- **Pipeline:**
```js
db.planning_applications.aggregate([
 { $geoNear:{ near:pt, distanceField:"m", maxDistance:radiusM, spherical:true,
              query:{ receivedDate:{ $gte:since } } } },
 { $facet:{
    byStatus:[ { $group:{ _id:"$status", n:{ $sum:1 }, units:{ $sum:"$units" } } } ],
    largest:[ { $match:{ units:{ $gt:0 } } }, { $sort:{ units:-1 } }, { $limit:5 },
              { $project:{ ref:1, units:1, status:1, m:1, description:1 } } ],
    pipelineUnits:[ { $match:{ status:{ $in:["granted","pending"] } } },
                    { $group:{ _id:null, units:{ $sum:"$units" } } } ] } }
])
```
- **Output:** `{ counts, pipelineUnits, largestSchemes[], supplyPressure:"rising|flat" }` with refs as evidence rows. **Semantic variant:** `$vectorSearch` (4.9) over `description` with `filter:{status}` and a `$geoWithin` post-filter, for "developments like this one".

### 4.6 `getPropertySales(lng,lat,radiusM,months)`
- Context only. Sales are not rents. The warning is hard-coded.
- **Pipeline:** `$geoNear` (with `query:{saleDate:{$gte}}`) → `$group` `{median price, p25, p75, n, trend via $setWindowFields by quarter}`.
- **Output:** `{medianPrice, n, qoqTrend, recentSales[5]}`. Rows with `geoConfidence < 0.5` are excluded by the pipeline, and the count excluded is reported.

### 4.7 `getNeighbourhoodData(lng,lat)`
- **Why Mongo:** `neighbourhood_profiles` is a materialised view, so read time is one `_id` lookup.
- **Build (nightly / on ingest):** from `census_small_area`, `housing_vacancy`, `rtb_disputes`, `rtb_terminations`, `property_sales`, `transport_stops`, `planning_applications`, using per-area `$group`s joined by `areaIds.sa`, then:
```js
{ $merge:{ into:"neighbourhood_profiles", on:"_id", whenMatched:"replace" } }
```
- **Doc:**
```jsonc
{ "_id":"sa:268001001",
  "census":{ "pop":412, "rentersPct":58.1, "avgHHsize":2.4, "age25_34Pct":31.2 },
  "vacancy":{ "ratePct":3.1, "asOf":"2022" },
  "rtb":{ "disputesPer1000Tenancies":4.2, "terminationsPer1000":7.8, "trend":"up" },
  "transportScore":78, "planningPipelineUnits":120,
  "featureVector":[0.31,-1.2, …],   // z-scored, for similarity search
  "_prov":{ "builtFrom":[…], "builtAt":ISODate } }
```
- **Output:** that doc, plus `rankWithinLea` fields via `$setWindowFields` with `$rank` and a whole-partition `$count` (percentile = (rank-1)/(count-1)) so "tenant-friendly" claims are relative, not adjectives.

### 4.8 Atlas Search
- `property_sales.address` and `geographies.name`: `autocomplete` + `fuzzy` → user address/area box, and a fallback when geocoding fails.
- `planning_applications.description`: `text` with `geoWithin` compound clause and `score` boost.
- Why Mongo: it keeps lexical search in the same cluster and same filters. No separate Elastic.

### 4.9 Vector Search (two real uses)
1. **Similar neighbourhoods:** `featureVector` on `neighbourhood_profiles` (numeric, no LLM needed). `$vectorSearch` returns "areas like this one that are cheaper", which can then be filtered by rent. Use: *alternatives* section.
2. **Method / rule retrieval:** `knowledge_chunks` (RTB rent-pressure-zone rules, dataset caveats). Embeddings via Voyage AI or whichever model P2 uses. One model, one dimension, fixed at index creation. Lets the agent cite rules and limitations with chunk ids as evidence.
3. (Optional) planning-description embeddings as in 4.5.
- Honest limit: vector search is for text/similarity only. Prices and distances never go through it.

### 4.10 Evidence + verification
- Every tool result writes `evidence` docs (bulk insert, same call).
- `verifyClaims(analysisId, claims[{evidenceId, assertedValue, tolerance}])`: DB-side check that the number the report states equals the stored value. P2 calls this before finalising; failures are returned for regeneration.
- `getEvidence(ids[])` for P3's "show source" panel: returns evidence + `sources` + `sourceRowRef`, so the UI can link to the dataset.

### 4.11 Whole-property report in one call
`analyzeProperty(input)` runs 4.1–4.7 in parallel (`Promise.all`), writes `analyses` + `evidence`, returns one `AnalysisResult`. P2 may call tools individually or this aggregate; P4 uses it for the non-agent path and caching.

---

## 5. Performance

- Only **one** `$geoNear` per pipeline, and it is first. Where a collection has multiple geo indexes, pass `key`.
- Index shape: equality fields first, then sort, then range (ESR). For `$geoNear`, put the filter in `query` and prefix with those fields where selectivity warrants (planning: `status`).
- `maxDistance` is always set (default 1500 m, cap 5000 m) so a query never scans a county.
- Pre-computation over query-time joins: `areaIds`, `stop_service_stats`, `neighbourhood_profiles`.
- Projection + covered queries for `rent_index` lookups.
- `$percentile`/`$median` with `approximate` for neighbours (small n, so `discrete` is acceptable).
- JSON-Schema validators with `validationAction:"error"` in dev and `"warn"` on loads, so bad rows are surfaced, not dropped.
- Verify with `explain("executionStats")`: target `totalDocsExamined ≈ nReturned`. Keep an `db/perf/explain.js` script and record numbers.
- Time series: `granularity` matched to ingest cadence; query by `meta` + `ts` only.
- Cache: `analyses` keyed by `hash(input)`, TTL index 24 h (P4 uses it).

---

## 6. Deliverables from P1 (repo layout)

```
db/
  schemas/        validators.json per collection
  indexes/        createIndexes.js (idempotent)
  pipelines/      rentComparables.js, rentHistory.js, nearbyTransport.js, ...
  materialise/    neighbourhoodProfiles.js, stopServiceStats.js
  tools/          index.ts  <- P2 and P4 import this
  search/         atlas-search-indexes.json, vector-indexes.json
  enrichGeo.js    batched areaIds assignment
  perf/           explain.js, seed-sample.js
docs/
  ingest-contract.md   required fields/types/provenance per collection (for P4)
  tool-contract.md     signatures + envelope + sample outputs (for P2/P3)
```

### Ingest contract (to P4), summarised
GeoJSON `[lng, lat]`; ISODate not strings; `_prov` complete; `geoConfidence` set; unique natural keys (so re-runs upsert); load to `*_staging` first, then P1's `promote()` validates and swaps.

### Build order (hackathon)
1. `sources`, `geographies`, `createIndexes` and the envelope, then `resolveLocation` (unblocks all)
2. `rent_index` + `getRentalComparables`, `getRentalHistory`, the demo core
3. `transport_stops` + `stop_service_stats`, `planning_applications`, `property_sales` tools
4. `evidence` + `verifyClaims`
5. `neighbourhood_profiles` view
6. Atlas Search, then Vector Search (stretch)
7. Perf `explain` numbers for the demo slide

---

## 7. Known risks to agree early

- **Geography mismatch:** RTB index geographies ≠ CSO small areas → `geo_crosswalk` needed from P4 on day 1.
- **No true listing-level comparables** unless P4 finds one. The design degrades to area-level and says so.
- **PPR geocoding quality** drives sales accuracy → `geoConfidence` filter.
- **Embedding model** must be fixed before any vector index is created.

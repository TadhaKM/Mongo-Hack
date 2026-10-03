# mend.ai: Evidence, Provenance and the Synthetic-Data Guard

Implemented in `db/lib/provenance.js`, `db/lib/queryLog.js`, `db/tools/index.js` (`runTool`, `callTool`, `getAnalysis`) and `db/tools/trace.js`; tested by `db/test/provenance.test.js` (24 checks on a real `mongod`).

**What it guarantees**
1. Any figure the AI states can be traced to the exact queries, parameters and source records that produced it.
2. Every record says where it came from, when, by which transformation, and whether it is **real**.
3. Synthetic, test or unverified data cannot be presented as real Irish data: it is blocked by default, labelled when allowed, and can never be "verified".

---

## 1. Separate collections or embedded?

| Thing | Decision | Why |
|---|---|---|
| **`sources`** | **separate** | A registry referenced by every record and every claim. One copy of each URL and licence; changes rarely |
| **`query_runs`** | **separate** (new) | One run yields many evidence items (the comparable engine yields 9), so embedding would copy the parameters and queries into each. Runs also hold the full recorded queries and up to 5,000 record references, which would bloat `analyses`. Independent lifecycle and audit retention |
| **`analysis_results`** | **separate** (new) | One document per analysis x tool. Results are large (40 comparables, 24-month series) and tool-specific; keeping them out means listing or loading an analysis stays light (the index in `analyses` is under 2 KB). Each result links to the run that produced it |
| **`evidence`** | **embedded** in `analyses.evidence[]` | Small (about 1 KB each), bounded (a few dozen per analysis), always read with its analysis, and `verifyClaims` needs them atomically. Each item carries a `queryId`, so nothing is lost by embedding |
| **`analyses`** | separate | The manifest: input, policy, evidence, an index of results, and the roll-up (`dataClass`, `publishable`) |

```
sources  <----- sourceIds / src.sourceId ------- every record and every evidence item
   ^
analyses ---- evidence[] (embedded) ---- queryId ---> query_runs ---- recordRefs ---> source records (any collection)
   |                                                      ^
   +--- resultRefs {tool: {queryId, status, dataClass}}   |
analysis_results (analysisId, tool) ---- queryId ---------+
```

---

## 2. What every record carries (`src`)

Required by the database validators on the collections the engine computes from (`rental_observations`, `rental_indexes`, `property_sales`) and set by every loader:

| Field | Meaning | Requirement covered |
|---|---|---|
| `sourceId` | the registered dataset (`sources._id`) | source dataset, organisation, URL (via the registry) |
| `recordId` | the original record's id in that dataset | original record ID |
| `version` | dataset release, e.g. `2026-05-14`, `2025Q4` | |
| `retrievedAt` | when the file or API response was fetched | |
| `ingestedAt` | when the record was written to MongoDB | ingestion date |
| `transform` | the loader and its version, e.g. `importRiq02.js@1.0`, `syncFromBackend.js@1`, `seed.js@1` | transformation version |
| `dataClass` | `real`, `synthetic` or `test` | synthetic-data guard |
| `geoMethod`, `geoConfidence` | how the location was derived (optional) | |

The rest of the required provenance is on the record itself: **observation date** (`observedAt`, `periodStart`, `saleDate`, `applicationDate`), **geographic level** (`areaLevel`, or `level` on `areas`; points are `point`), **geographic identifier** (`areaId`).

**`sources`** (validated): `title`, `organisation`, `url`, `licence`, `version`, `retrievedAt`, `dataClass`. A source marked `real` **must** have a URL and a licence, or the database rejects it.

### Example record (real)
```json
{ "areaId": "rtbzone:riq-124600", "areaLevel": "rtb_zone", "propertyType": "apartment", "bedrooms": 2,
  "measure": "registered_average", "avgRent": 2112.06, "periodStart": {"$date":"2023-10-01T00:00:00Z"}, "periodLabel": "2023Q4",
  "src": { "sourceId": "cso_riq02", "recordId": "124600|apartment|2|2023Q4", "version": "2026-05-14",
           "retrievedAt": {"$date":"2026-10-03T14:30:00Z"}, "ingestedAt": {"$date":"2026-10-03T14:31:10Z"},
           "transform": "importRiq02.js@1.0", "dataClass": "real" } }
```

### Example source
```json
{ "_id": "cso_riq02", "dataClass": "real", "title": "RTB Average Monthly Rent Report (RIQ02)",
  "organisation": "Residential Tenancies Board, published by the Central Statistics Office",
  "url": "https://data.cso.ie/table/RIQ02", "licence": "CC BY 4.0 (CSO open data)", "version": "2026-05-14",
  "retrievedAt": {"$date":"2026-10-03T14:30:00Z"}, "transform": "importRiq02.js@1.0", "collections": ["rental_indexes", "areas"],
  "notes": "Area averages, not listings. No sample sizes..." }
```

---

## 3. Evidence (embedded in `analyses.evidence[]`)

```json
{ "id": "ev7", "evidenceType": "rentalComparables", "tool": "rentalComparables",
  "claim": "Comparable listings used (2-bed, within 1000 m, last 90 days)", "value": 37, "unit": "count",
  "queryId": "6ac1f0c2e7b4a1d2c3e4f5a6",
  "queryParameters": { "latitude": 53.3264, "longitude": -6.2551, "bedrooms": 2, "propertyType": "apartment", "analysisDate": "2026-10-03T12:00:00.000Z" },
  "context": { "model": "comp-v1", "measure": "advertised", "n": 37, "radiusM": 1000, "windowDays": 90, "minScore": 50 },
  "geographicScope": { "level": "point", "radiusM": 1000 }, "observationPeriod": { "windowDays": 90 },
  "refs": [ { "collection": "rental_observations", "docId": "6ac0f62f3dc3fff0c559d6f7" }, "... one per record ..." ],
  "sources": [ { "sourceId": "listings", "title": "...", "organisation": "...", "url": "https://...", "licence": "...", "version": "...", "dataClass": "real" } ],
  "dataClass": "real", "publishable": true, "recordClasses": { "real": 37 }, "generatedAt": {"$date":"2026-10-03T12:00:04Z"} }
```
For non-real evidence the claim is prefixed and the original kept: `"claim": "[SYNTHETIC SAMPLE DATA] Comparable listings used ...", "claimRaw": "Comparable listings used ...", "publishable": false`.

## 4. `query_runs`

One document per tool execution (also blocked ones, for audit):

| Field | |
|---|---|
| `_id` | the `queryId` |
| `tool`, `toolModel` | e.g. `rentalComparables`, `comp-v1` |
| `params`, `paramsHash` | the exact inputs (dates pinned: `analysisDate` is stored even when defaulted) |
| `queries[]` | **every MongoDB read the tool made**: `{seq, collection, op, spec (the exact pipeline or filter), specHash}`. Recorded automatically by wrapping the db handle, so no tool needed changing |
| `collections`, `sourceIds`, `sourceVersions` | what was read, from which sources and versions |
| `recordCount`, `recordRefs[]` | the records the result cites (up to 5,000, flagged if truncated) |
| `evidenceIds`, `evidenceSummary[]` | the claims and values it produced (used to reproduce it) |
| `resultDigest` | SHA-256 of the result |
| `dataPolicy`, `dataClass`, `status` | `ok` or `blocked` |
| `startedAt`, `durationMs`, `engine` | when, how long, which engine version |
| `analysisId` | the analysis it belonged to, or null |

## 5. `analysis_results` and the analysis roll-up

`analysis_results`: `{analysisId, tool, queryId, status, dataClass, publishable, data, coverage, warnings, evidenceIds}`, unique on `(analysisId, tool)` (latest run wins; older evidence stays in the analysis, immutable).

`analyses` gains `dataPolicy`, `resultRefs` (a small index), `dataClass`, `publishable` (true only if every tool ran, none was blocked and all used real data) and `blockedTools`. `getAnalysis(db, id)` joins the results back in.

---

## 6. "Why did MongoDB say there were 37 comparable properties?"

Person 2 asks the engine, not the model:

```
GET /analyses/{analysisId}/evidence/{evidenceId}/explain          (engine)   |   GET /engine/... via the backend proxy
explainEvidence(db, { analysisId, evidenceId })                    (Node)
```

Returns, all assembled from stored data (no model involved):

```jsonc
{ "question": "Why does the database say: Comparable listings used (...) = 37 count?",
  "answer": [                                          // deterministic, readable
    "Tool rentalComparables (model comp-v1) was run at 2026-10-03T12:00:03Z with parameters {latitude:53.3264, ...}.",
    "Searched rental_observations for documents within 1000 m of (-6.2551, 53.3264), nearest first, keeping only those matching {measure:advertised, bedrooms:2, ...}.",
    "Selection: 37 records kept, radius 1000 m, last 90 days, minimum comparable score 50.",
    "Result: \"Comparable listings used\" = 37 count, computed from 37 cited record(s)." ],
  "evidence":  { "id": "ev7", "value": 37, "dataClass": "real", "publishable": true, "generatedAt": "..." },
  "queryRun":  { "queryId": "...", "tool": "...", "params": {...}, "queries": [ { "collection": "rental_observations", "op": "aggregate", "spec": { "pipeline": [ { "$geoNear": {...} }, ... ] } } ],
                 "sourceVersions": {...}, "engine": { "name": "mend-engine", "version": "0.1.0" }, "reproduce": "POST /query-runs/<id>/reproduce" },
  "records":   { "total": 37, "shown": 37, "missing": [],
                 "items": [ { "collection": "rental_observations", "docId": "...", "sourceId": "listings", "sourceRecordId": "L-100", "sourceVersion": "...",
                              "observationDate": "...", "geographicLevel": "point", "geographicId": "sa:268001001",
                              "retrievedAt": "...", "ingestedAt": "...", "transform": "...", "dataClass": "real", "record": { "...the full stored document..." } } ] },
  "sources":   [ { "sourceId": "listings", "organisation": "...", "url": "...", "licence": "...", "dataClass": "real" } ],
  "integrity": { "recordsCited": 37, "recordsFound": 37, "allShownRecordsFound": true, "recordDataClasses": { "real": 37 } } }
```
The chain is **claim, evidence, query run (exact queries), source records (full documents), registered sources**. If a cited record has since been deleted it is listed under `missing`, not skipped.

**Reproduce:** `POST /query-runs/{queryId}/reproduce` re-runs the stored tool with the stored parameters on the current data and compares every figure: `{reproduced: true}` or the list of `differences` plus `sourceVersionsChanged`. Tested: deleting one cited comparable flips `reproduced` to false.

## 7. Protection against presenting synthetic or test data as real

Default-deny, enforced in layers:

| Layer | What it does |
|---|---|
| **1. Honest seed data** | `db/scripts/seed.js` marks every source and record `synthetic`; its sources are titled "(SYNTHETIC SAMPLE)" and named "SYNTHETIC SAMPLE imitating: <publisher>", with `example.org` URLs, so it never claims a real publisher |
| **2. Validators** | records must declare `dataClass`, `transform`, `ingestedAt`; a `real` source must have a URL and licence. Tested |
| **3. Loaders classify** | `importRiq02.js` marks `real` with a transform version. `syncFromBackend.js` classifies each record: anything with `demo`/`fixture`/`test`/`example.org` in its key, code or source, or with no named publisher and URL, is `synthetic` |
| **4. Class is computed from the records actually cited**, not from the tool's hard-coded source names | the engine looks up every cited record and its registered source. The result's class is the **worst** of them: a single unmarked, unregistered, `test` or `synthetic` record makes the whole result non-real. A record marked `real` under an unregistered source is `unknown`. Tested, including one `test` record under a real source name |
| **5. Policy gate** | `DATA_POLICY=real_only` (the default): a result built from non-real data returns **no figures**, a `blocked` reason and the sources named; the run is still recorded. `allow_synthetic` is explicit, for development |
| **6. Labels travel with the sentence** | when synthetic data is allowed, every claim is prefixed `[SYNTHETIC SAMPLE DATA]` (or `[TEST DATA]`, `[UNVERIFIED DATA ...]`), the first warning is a banner, and `publishable` is false, so even a copied claim carries the label |
| **7. Roll-up and report gate** | `analyses.publishable` is true only if every tool ran on real data and none was blocked. `GET /analyses/{id}/readiness` lists the reasons. The report layer should refuse to render a report when `publishable` is false |
| **8. `verifyClaims` cannot be fooled** | claims on non-real evidence return `not_real_data`, even when the number is correct |

**Which data is real today:** only CSO RIQ02. The seed data and Person 4's demo fixtures are synthetic.

## 8. For Person 2

1. Call tools through `POST /engine/tools/{tool}` with an `analysis_id`, so results, queries and evidence are stored.
2. Quote `evidence[].value`, cite `evidence[].id`. Never state a number that is not in the evidence.
3. If `blocked` is present or `provenance.publishable` is false, do not present the figures as real; say the data is unavailable.
4. Call `verifyClaims` before finalising; anything other than `verified` must be removed or rewritten.
5. To answer "where does this come from?", call `explain` for that evidence id and show `answer`, `records.items[].sourceRecordId` and `sources[].url`.

## 9. Limits
- Reproduction uses the stored parameters; tools that look back from "today" (planning, sales) can differ by a few days if reproduced much later. The two time-dependent engines (`rentalComparables`, `rentalTrend`) pin their date.
- The backend's own (Python) services do not yet write `query_runs`; only results obtained through the engine are traced.
- `dataClass` is only as good as the loader that set it. The sync's classifier is conservative (default `synthetic`), but a new loader must set it deliberately.

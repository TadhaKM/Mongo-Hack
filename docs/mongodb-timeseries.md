# RentCheck AI: MongoDB Time-Series and Rent Trends

Answers: **"How has rent changed around this property?"**

Implemented in `db/tools/trends.js` (tool `rentalTrend`), configured in `db/config/trendConfig.js` (model `trend-v1`), tested by `db/test/trends.test.js` (28 checks against a real mongod 7.0.14; every statistic is recomputed independently in JS). Runnable mongosh for all seven recipes: [db/pipelines/rentTrend.mongosh.js](../db/pipelines/rentTrend.mongosh.js), generated from the same builder and verified to return exactly what the tool returns.

---

## 1. Which datasets use a time-series collection

I probed MongoDB 7.0.14 first, because the answer depends on what time-series collections cannot do.

| Capability on 7.0.14 | Result |
|---|---|
| `$geoNear` with a 2dsphere index | works, but **`query` is not allowed inside `$geoNear`**: filters must follow as `$match` |
| `$dateTrunc`, `$densify`, `$setWindowFields` (`$shift`), `$minN`, `$sortArray` | work |
| Custom buckets (`bucketMaxSpanSeconds` up to 1 year) | works (6.3+) |
| Secondary indexes on `metaField` sub-fields, the time field, and measurement fields (including 2dsphere) | work |
| **JSON-Schema validator** | **not allowed** (`'timeseries' is not allowed with 'validator'`) |
| **Unique index** | **not allowed** |
| Single-document update | **not allowed**; `updateMany` limited to `metaField` |
| `$merge` into a time-series collection | **not allowed** (`$out` works) |

Our rental collections rely on exactly the three things a time-series collection lacks: the **validator** that stops advertised, registered, index and sale data being mixed, the **unique index** that makes loads idempotent, and **updates** (linking a re-listing to a property). So the decision is:

| Dataset | Time-series? | Decision and reason |
|---|---|---|
| Rental observations (advertised, registered) | **Yes, as an analytic copy** | Append-only, time-first, large (every listing, every month, for years) and queried by `period x geography x type x bedrooms`. The validated, unique `rental_observations` stays the system of record and runs the comparable engine; `rental_observation_series` is rebuilt from it for trends |
| RTB / ESRI Rent Index (`rental_indexes`) | **No** | Quarterly, thousands of rows. Time-series buys no performance, and loses the unique key and validator. Trend queries already work on the regular collection (`rentTrend`, quarterly, with `$shift`) |
| Property sales (PPR) | No (optional later) | A dated event stream, but only used as price context |
| `area_stats` (vacancy, RTB) | No | Small, annual or quarterly |
| Met Éireann weather | **Yes, if used** | The textbook case: regular, dense, time-first. Not part of rent trends |
| `analyses`, `areas`, `transport_stops`, `planning_applications` | No | Not time-series |

**Honest scale note.** At hackathon volumes (thousands of rows) a regular collection with `$dateTrunc` would be just as fast. The time-series copy is the right design if listing history reaches millions of rows, and it is the part of the architecture that uses this MongoDB feature for what it is built for. It is a *derived* store: if it disappears, `rebuildObservationSeries()` recreates it from the system of record.

```
Person 4 loads  ->  rental_observations   (regular, validated, unique)   -> comparable engine ($geoNear, scoring)
                          |
                          |  rebuildObservationSeries()   one $out aggregation
                          v
                    rental_observation_series   (time series)           -> rentalTrend (monthly / quarterly / yearly)
```
Nothing unvalidated can reach the series: it is built only from the validated collection.

---

## 2. The time-series collection

### `rental_observation_series`

| Setting | Value | Why |
|---|---|---|
| `timeField` | `observedAt` | the date of the advertisement or registration |
| `metaField` | `meta` | the **identity of a series**; buckets never mix different `meta` values |
| `granularity` | not used; **custom buckets**: `bucketMaxSpanSeconds = bucketRoundingSeconds = 31536000` (1 year) | The standard `granularity: "hours"` caps a bucket at 30 days. Our series (measure x source x type x bedrooms x LEA) get roughly 5-100 observations a month, so 30-day buckets would hold a handful of documents. One-year buckets fill properly and prune cleanly by year. (On MongoDB older than 6.3, use `granularity: "hours"`) |
| `expireAfterSeconds` | none | history is the product |

**`meta` (series identity, deliberately low-cardinality)**

| Field | Why it is in `meta` |
|---|---|
| `measure` | `advertised` or `registered`. Different measures can never share a bucket |
| `sourceId` | different sources never share a bucket |
| `propertyType` | |
| `bedrooms` | |
| `leaId` | coarse geography. ~170 LEAs in Ireland, so about 2 x few sources x 6 types x 6 beds x 170 = ~10^4 series, which buckets well. Small-area ids (tens of thousands) would create ~10^6 near-empty series, so `areaId` is a **measurement**, not `meta` |

**Measurements (per document)**

| Field | Type | Meaning |
|---|---|---|
| `observedAt` | date | timeField |
| `rent` | double | EUR per month |
| `areaId` | string | small area (for small-area trends) |
| `geo` | GeoJSON Point | for "around a property" trends |
| `floorAreaM2`, `geoConfidence` | double | |
| `obsId` | ObjectId | `_id` of the source record in `rental_observations` (traceability) |
| `recordId` | string | the original listing id (`src.recordId`) |
| `version` | string | dataset release (`src.version`) |
| `retrievedAt` | date | when the data was pulled |

**Example document**
```json
{ "observedAt": {"$date":"2024-12-05T12:00:00Z"},
  "meta": { "measure": "advertised", "sourceId": "listings", "propertyType": "apartment", "bedrooms": 2, "leaId": "lea:dublin-city-south-east" },
  "rent": 2160, "areaId": "sa:268001002", "floorAreaM2": 53,
  "geo": { "type": "Point", "coordinates": [-6.25029, 53.32455] }, "geoConfidence": 0.9,
  "obsId": {"$oid":"6ac0fbefff683d2510ea258f"}, "recordId": "listings-apartment-2-sa:268001002-22-0",
  "version": "hist-seed", "retrievedAt": {"$date":"2026-10-03T12:00:00Z"} }
```

**Indexes** (created by `rebuildObservationSeries`; not in `createIndexes.js`, because creating an index would implicitly create a *regular* collection of that name)

| Index | Serves |
|---|---|
| `{"meta.measure":1, "meta.leaId":1, "meta.bedrooms":1, "meta.propertyType":1, observedAt:-1}` (`lea_series`) | LEA-level trends; also bucket pruning by time |
| `{"meta.measure":1, areaId:1, observedAt:-1}` (`area_series`) | small-area trends; the planner also uses it for radius queries |
| `{geo:"2dsphere"}` (`geo`) | geo filtering on measurements |

**Loading and refreshing.** Person 4 loads `rental_observations` as before. After a load (historical backfill or monthly refresh) call:
```js
import { rebuildObservationSeries } from "./db/tools/trends.js";
await rebuildObservationSeries(db);     // drop + one $out aggregation + indexes; idempotent
```
The rebuild is one aggregation: `$lookup` the LEA from `areas`, `$project` into `{observedAt, meta, rent, ...}`, `$out` with the time-series options. An incremental `insertMany` of new rows is the natural next step if rebuild time ever matters.

---

## 3. What the trend answers

**Tool:** `rentalTrend(db, input)` (`callTool(db, analysisId, "rentalTrend", input)`).

```js
{ latitude, longitude,                         // required for a radius scope
  scope: { type: "radius", radiusM? }          // around the property (radiusM omitted = widening ladder 1 km / 2 km / 4 km)
       | { type: "lea", id } | { type: "small_area", id },
  measure: "advertised" | "registered",        // default "advertised"
  bedrooms?, propertyType?, sourceId?,         // optional narrowing
  pool: false,                                 // true = combine sources (explicit opt-in)
  unit: "month" | "quarter" | "year",          // default "month"
  periods?,                                    // reported window length; default 24 months / 8 quarters / 4 years
  analysisDate?, includeIncompletePeriod: false }
```
**Output:** `data.series[]`, one per *source x bedrooms x property type*, each with a dense ordered `points[]` and a summary; plus `provenance`, `period`, `scope`, `search`, and an `officialIndex` cross-check. Real output (radius scope, seed history, trimmed):

```jsonc
{ "status": "sufficient", "model": "trend-v1", "measure": "advertised", "unit": "month",
  "scope": { "type": "radius", "radiusM": 1000 },
  "period": { "from": "2024-10-01", "to": "2026-10-01", "comparisonFrom": "2023-10-01", "periods": 24,
              "incompletePeriodIncluded": false, "comparison": "same month 12 month(s) earlier" },
  "series": [ {
    "key": { "sourceId": "listings", "bedrooms": 2, "propertyType": "apartment" },
    "records": 244, "sufficientPeriods": 22,
    "latestMedian": 2515, "latestYoYMedianPct": 9.8, "totalChangeMedianPct": 18.7, "direction": "rising",
    "points": [
      { "label": "2024-10", "n": 8,  "medianRent": 2118, "avgRent": 2113, "yoyMedianPct": null, "yoyAvgPct": null, "complete": true,
        "p25Rent": 2094, "p75Rent": 2129, "minRent": 2060, "maxRent": 2170,
        "observedFrom": "2024-10-02", "observedTo": "2024-10-28", "versions": ["hist-seed"], "retrievedAt": "2026-10-03",
        "recordIdSample": ["listings-apartment-2-sa:268001001-24-0", "…"], "obsIdSample": ["6ac0fbadfa5a028429a8d7de", "…"] },
      { "label": "2025-09", "n": 8,  "medianRent": 2290, "avgRent": 2297, "yoyMedianPct": 8.8, "yoyAvgPct": 9.4, "…": "…" },
      { "label": "2026-09", "n": 13, "medianRent": 2515, "avgRent": 2425, "yoyMedianPct": 9.8, "yoyAvgPct": 5.6, "…": "…" } ] } ],
  "provenance": { "collection": "rental_observation_series", "systemOfRecord": "rental_observations", "measure": "advertised",
                  "sourceIds": ["listings"], "versions": ["hist-seed", "seed"],
                  "observedFrom": "2024-03-01", "observedTo": "2026-09-28", "retrievedAt": "2026-10-03", "records": 244 },
  "officialIndex": { "unit": "quarter", "measure": "index_mean", "zone": "rtbzone:dublin-6", "from": "2025Q1", "to": "2026Q3",
                     "totalChangePct": 8.1, "latestYoY": 5.3, "direction": "rising" } }
```
(`records` and `provenance.observedFrom` include the year of lookback read for the year-on-year comparison, so provenance describes all data actually used.)

---

## 4. The pipeline

One pipeline, parametrised by scope and filters, produces the monthly median, monthly average and year-on-year growth together (recipes 1-3), and the scope changes only the first stage (4-5), the filters narrow it (6-7). Condensed and annotated; the exact text is generated into `db/pipelines/rentTrend.mongosh.js`.

```js
db.rental_observation_series.aggregate([

 // FIRST STAGE: the scope (exactly one geographic level) + filters.  [recipes 4-7 differ only here]
 { $match: { "meta.measure": "advertised",                 // never mixed
             "meta.sourceId": "listings",                  // optional
             "meta.bedrooms": 2, "meta.propertyType": "apartment",
             observedAt: { $gte: ISODate("2023-10-01"), $lt: ISODate("2026-10-01") },   // whole periods: lookback year + reported window
             "meta.leaId": "lea:dublin-city-south-east" } },

 // bucket every observation into its period (UTC)
 { $set: { period: { $dateTrunc: { date: "$observedAt", unit: "month", timezone: "UTC" } } } },

 // one row per source x bedrooms x type x period: exact statistics + provenance
 { $group: { _id: { sourceId: "$meta.sourceId", bedrooms: "$meta.bedrooms", propertyType: "$meta.propertyType", period: "$period" },
     n: { $sum: 1 }, avg: { $avg: "$rent" }, rents: { $push: "$rent" }, min: { $min: "$rent" }, max: { $max: "$rent" },
     observedFrom: { $min: "$observedAt" }, observedTo: { $max: "$observedAt" }, versions: { $addToSet: "$version" },
     retrievedAt: { $max: "$retrievedAt" },
     recordIdSample: { $minN: { n: 3, input: "$recordId" } }, obsIdSample: { $minN: { n: 3, input: "$obsId" } } } },
 { $set: { sufficient: { $gte: ["$n", 5] } } },                 // fewer than 5 observations: no statistics published
 { $project: { /* medianRent = round(exact percentile(rents, 0.5)), avgRent, p25, p75, min, max, each null unless sufficient */ } },

 // every period present in every series, so "12 documents back" really means "12 months back"
 { $densify: { field: "period", partitionByFields: ["sourceId", "bedrooms", "propertyType"], range: { step: 1, unit: "month", bounds: [ISODate("2023-10-01"), ISODate("2026-10-01")] } } },

 // year-on-year: the same period 12 months earlier, only if both periods are sufficient
 { $setWindowFields: { partitionBy: { sourceId: "$sourceId", bedrooms: "$bedrooms", propertyType: "$propertyType" }, sortBy: { period: 1 },
     output: { prevMedian: { $shift: { output: "$medianRent", by: -12 } }, prevAvg: { $shift: { output: "$avgRent", by: -12 } } } } },
 { $set: { yoyMedianPct: { $cond: [{ $and: [{ $ne: ["$medianRent", null] }, { $gt: ["$prevMedian", 0] }] },
                                    { $round: [{ $multiply: [{ $divide: [{ $subtract: ["$medianRent", "$prevMedian"] }, "$prevMedian"] }, 100] }, 1] }, null] } /* yoyAvgPct likewise */ } },

 // fold into one document per series; return only the requested window (drop the lookback year); summarise
 { $sort: { sourceId: 1, bedrooms: 1, propertyType: 1, period: 1 } },
 { $group: { _id: { sourceId: "$sourceId", bedrooms: "$bedrooms", propertyType: "$propertyType" }, points: { $push: { /* label, n, medianRent, avgRent, yoy..., provenance */ } }, records: { $sum: "$n" } /* ... */ } },
 { $set: { points: { $filter: { input: "$points", cond: { $gte: ["$$this.period", ISODate("2024-10-01")] } } } } }
 /* ... sufficientPeriods, latestMedian, latestYoYMedianPct, totalChangeMedianPct, direction ... */
])
```

**Why these choices**
- **Exact percentile, not `$median`.** `$median`/`$percentile` use an approximation (t-digest) in 7.0. For trends of small monthly samples an exact value is needed so that results are reproducible and independently verifiable. The pipeline sorts the monthly array and interpolates (the same expression the comparable engine uses).
- **`$densify` before `$shift`.** `$shift` moves by *documents*, not months. Without densifying, one missing month makes every later "12 back" comparison silently compare the wrong months. The test history has a missing month and a thin month, and the month 12 later correctly reports no year-on-year change.
- **A lookback year is read but not reported.** Asking for 24 months returns 24 points *each with* a year-on-year value (reading 36 months). Without this, the first 12 points could never have a comparison.
- **Incomplete periods.** The current month is excluded by default, because half a month would look like a fall. `includeIncompletePeriod: true` returns it flagged `complete: false`.
- **`$geoNear` on a time-series collection** cannot take a `query`. The radius recipe is `[{ $geoNear: {...} }, { $match: filters }, ...]`. Verified with `explain`: the planner turns it into an index scan on the series indexes with a bucket-level geo filter (`$_internalBucketGeoWithin`), and does not scan the whole collection. The *comparable engine* keeps true `GEO_NEAR_2DSPHERE` because it runs on the regular collection.

### The seven recipes

| # | Question | What changes | Output fields used |
|---|---|---|---|
| 1 | **Monthly median rent** | scope `lea`, `unit: "month"` | `points[].medianRent` |
| 2 | **Monthly average rent** | same pipeline | `points[].avgRent` |
| 3 | **Year-on-year rent growth** | same pipeline | `points[].yoyMedianPct`, `yoyAvgPct`, `latestYoYMedianPct`, `direction` |
| 4 | **Trend around a specific property** | first stage `[{ $geoNear: {near, key:"geo", maxDistance: 1000} }, { $match }]` | all; plus `officialIndex` cross-check |
| 5 | **Trend within a geographic area** | first stage `$match` on `areaId: "sa:268001001"` (small area) or `"meta.leaId"` (LEA) | all |
| 6 | **Trend for a bedroom count** | `$match` `"meta.bedrooms": 1`. Property type and source stay separate series | all |
| 7 | **Trend for a property type** | `$match` `"meta.propertyType": "house"`. Bedroom counts stay separate series | all |

Quarterly and yearly trends are the same pipeline with `unit: "quarter"` (YoY = 4 quarters back) or `"year"` (1 year back).

---

## 5. Preventing mixed or incompatible comparisons

| Danger | Prevention | How it is enforced | Tested |
|---|---|---|---|
| **Different geographic levels** | A call takes exactly **one** `scope` (`radius`, `lea` or `small_area`). A county or missing scope is rejected. The output echoes `geographicScope` and evidence `context.areaLevel`. The LEA lives in `meta`, the small area and point are measurements, so the filters cannot be combined by accident | `validate()` throws; one `$match`/`$geoNear` per call | scope rejection; small-area vs LEA differ and match independent counts |
| **Different rental definitions** (advertised, registered, index, sale) | Four separate stores (section 3 of [mongodb-schema.md](mongodb-schema.md)). The series contains only observations; `meta.measure` is the first filter and part of every bucket; the official index is a different collection and appears only as a separately labelled `officialIndex` | `measure` is validated (`all` is rejected) and is the first condition in every pipeline | registered never in advertised results and vice versa |
| **Different sources** | Reported **separately by default**: one series per `sourceId`. Pooling needs `pool: true`, which produces a series keyed `ALL` and a warning | `sourceId` is part of `meta` and of the group key | two sources differ systematically and are separate; pooling sums and warns |
| **Advertised vs registered** | Same as definitions: `meta.measure` partitions the buckets, so the two cannot share a bucket even by mistake | | the registered median is lower and its source never appears in advertised provenance |
| **Different bedroom counts / property types** | The group key always includes both, so they can never be pooled; filters only narrow | `bedrooms`, `propertyType` in `meta` and in the series key | unfiltered call returns one series per combination |
| **Incompatible time periods** | One `unit` per call; `$dateTrunc` in UTC; whole periods only; year-on-year compares the *same* period `lag` units earlier (12 months / 4 quarters / 1 year); the current partial period excluded by default; gaps are densified instead of shifted over; the quarterly official index is never merged with monthly figures | `unit` enum; `$densify`; `period.comparison` states the comparison in words | quarterly and yearly match independent calculations; a gap month yields no YoY |
| **Too little data** | A period with fewer than 5 observations shows `n` but **no statistics**; YoY needs both periods sufficient; `status` and `confidence` follow the number of sufficient periods | `minPerBucket` | thin month has null statistics |

---

## 6. Provenance and evidence

Every number keeps its source and date.

| Where | What is kept |
|---|---|
| each `point` | `n`, `observedFrom`/`observedTo` (actual observation dates), `versions` (dataset releases), `retrievedAt`, `recordIdSample` (original listing ids), `obsIdSample` (`rental_observations` `_id`s) |
| each `series` | `sourceIds`, `versions`, `observedFrom`/`observedTo`, `retrievedAt`, `records` |
| `provenance` | collection, system of record, measure, all source ids and versions, date range, total records |
| `evidence[]` | per series: latest median, latest average, latest year-on-year change, change over the period. Each has `context` (`model`, `measure`, `unit`, `areaLevel`, `areaId`/`radiusM`, `bedrooms`, `propertyType`, `sourceId`, `period`, `from`, `to`, `n`), `refs` to real `rental_observations` records, `sourceIds`, and (via `callTool`) `queryParameters` and `generatedAt` |

`verifyClaims` accepts the stored median and rejects an altered one (tested).

---

## 7. Insufficient data

| Situation | `status` | Behaviour |
|---|---|---|
| No observations match | `none` | `series: []`, evidence "0", warning; the AI must not describe a trend |
| Fewer than 3 sufficient periods in the best series | `insufficient` | points listed with counts; warning "unreliable"; the AI must not state a direction |
| 3-5 sufficient periods | `limited` | published as "indicative" |
| 6+ sufficient periods | `sufficient` | `confidence: high` from 12 periods |
| Radius scope with sparse data | ladder 1 km, 2 km, 4 km | stops at the smallest radius with 6 sufficient periods; the radius used is reported and a warning says it widened |
| A month with fewer than 5 observations | | `n` shown, statistics null, never interpolated |
| Official index available | | cross-check shown separately (`officialIndex`), explicitly quarterly |

---

## 8. Limits

- **Derived copy.** `rental_observation_series` duplicates the observations. It must be rebuilt after loads; stale until then.
- **No validator or unique key on the series.** The guard against mixing is structural (built only from the validated collection, `measure` in `meta`) rather than enforced on the collection itself.
- **Radius queries are bucket-filtered, not `GEO_NEAR`.** Fine at this scale; the comparable engine is unaffected.
- **Medians of listings are asking-price medians.** They describe advertised rents, not what tenants pay, and the warning is part of every result.
- **Trend direction uses year-on-year change only** (threshold 2%). It is a summary, not a forecast.

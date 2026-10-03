# mend.ai: MongoDB Comparable-Rental Engine

> **Schema v2 (current): see [mongodb-schema.md](mongodb-schema.md).** The old `rents` collection was split into `rental_observations` (individual advertised or registered rents; `measure` is a required top-level field) and `rental_indexes` (official area averages; value field `avgRent`, period field `periodStart`). The code in `db/` is authoritative.


Tool `rentalComparables` in [db/tools/comparables.js](../db/tools/comparables.js). Scoring constants in [db/config/comparableScoring.js](../db/config/comparableScoring.js) (model `comp-v1`). Exact runnable pipeline: [db/pipelines/rentalComparables.mongosh.js](../db/pipelines/rentalComparables.mongosh.js), generated from the same code by `node db/scripts/printComparablePipeline.js`.

**Verified:** `npm run db:test:comparables` runs 20 checks against a real mongod 7.0.14 (statistics checked against an independent JS calculation, determinism, thin-data behaviour, `explain` uses the 2dsphere index, and the generated mongosh text returns exactly what the engine returns).

**Division of labour:** MongoDB finds the comparables, scores them, ranks them and computes every number. Person 2's AI receives the finished result plus evidence ids and writes prose. Person 4 loads listings into `rental_observations` (`measure:"advertised"`) and should de-duplicate re-posted ads (see Limits).

---

## 1. Input and output

```js
// Input
{ latitude: 53.3264, longitude: -6.2551, bedrooms: 2, propertyType: "apartment",
  monthlyRent: 2350, floorArea: 68, analysisDate: "2026-10-03T12:00:00Z" }
```
| Field | Required | Notes |
|---|---|---|
| `latitude`, `longitude` | yes | WGS84. Rejected if outside Ireland (catches swapped values) |
| `bedrooms` | yes | integer 0-5 (0 = studio, 5 = 5+) |
| `propertyType` | no | `apartment`, `house`, `detached`, `semi_detached`, `terraced`, `studio`. Omitted: no type filter, type factor scored neutral |
| `monthlyRent` | no | EUR. Omitted: statistics returned, target comparison null |
| `floorArea` | no | m². Omitted: floor-area factor scored neutral |
| `analysisDate` | no | defaults to now. Nothing dated after it is used, and ages are measured from it, so a result can be reproduced later |

**Real output** (seed data; `comparables` and `history` shortened):
```jsonc
{
  "status": "sufficient",            // none | insufficient | limited | sufficient
  "confidence": "medium",            // none | low | medium | high
  "scoringModel": "comp-v1",
  "comparableCount": 10,
  "medianRent": 2262, "averageRent": 2248, "minRent": 1950, "maxRent": 2650,
  "rentRange": { "min": 1950, "max": 2650, "spread": 700, "p25": 2125, "p75": 2338, "iqr": 213 },
  "weightedAverageRent": 2251, "stdDev": 203.6, "outlierCount": 0,
  "targetRent": 2350, "differenceFromMedian": 88, "percentageDifference": 3.9,
  "percentileRank": 80, "position": "upper_quartile",
  "perSquareMetre": { "comparablesWithFloorArea": 10, "medianRentPerM2": 35.47, "targetRentPerM2": 34.56 },
  "dateRange": { "from": "2026-07-24", "to": "2026-09-28",
                 "searchWindow": { "from": "2026-07-05", "to": "2026-10-03", "days": 90 } },
  "mostRecent": { "address": "4 Sample Ave", "rent": 2250, "observedAt": "2026-09-28", "distM": 43, "score": 97 },
  "coverage": { "radiusM": 1000, "windowDays": 90, "nearestM": 43, "medianDistanceM": 408, "farthestM": 914,
                "distinctSmallAreas": 1, "byTier": { "small_area": 10, "electoral_division": 0, "lea": 0, "outside": 0 } },
  "history": {
    "listingsByMonth": [ { "month": "2026-07", "n": 1, "avgRent": 2275, "minRent": 2275, "maxRent": 2275 }, "…" ],
    "rtbIndex": { "zone": "rtbzone:dublin-6",
      "trend": { "from": "2024Q1", "to": "2026Q3", "totalChangePct": 13.8, "latestYoY": 5.3, "direction": "rising" },
      "benchmark": { "period": "2026Q3", "areaMean": 2207, "diffPct": 6.5, "band": "above_average" } } },
  "search": { "candidatePool": 10, "minScore": 50, "maxComparables": 40,
              "ladder": [ { "radiusM": 1000, "windowDays": 90, "candidatePool": 10, "comparables": 10, "accepted": true } ] },
  "comparables": [ { "address": "4 Sample Ave", "rent": 2250, "distM": 43, "ageDays": 5, "floorAreaM2": 66, "geoTier": "small_area",
                     "score": 97, "factors": { "distance": 0.99, "recency": 0.96, "floorArea": 0.94, "type": 1, "area": 1, "quality": 0.9 },
                     "rentPerM2": 34.09, "deltaVsTarget": -100, "recordId": "L-100", "sourceId": "listings" }, "…" ]
}
```
The tool returns this as `data` inside the standard envelope with `evidence[]`, `coverage` and `warnings[]` (section 7).

---

## 2. What counts as a comparable (hard filters)

A listing is a candidate only if **all** hold. Scoring never rescues a failed filter.

| # | Filter | Rule | Reason |
|---|---|---|---|
| 1 | Measurement type | `measure:"advertised"` by default (`"registered"` only if asked; the two are never mixed), `rent.amount > 0` | Index cells live in a different collection and sale prices in another; neither can reach this query |
| 2 | Bedrooms | exactly equal | A 1-bed is not a comparable for a 2-bed |
| 3 | Property type | same compatibility group: `flat` = apartment, studio; `house` = house, detached, semi_detached, terraced. Skipped when type unknown | A terraced house is not a comparable for a flat |
| 4 | Time | `observedAt` between `analysisDate - 12 months` (history pool) and `analysisDate`; the **selected** set is further limited to `ageDays <= windowDays` of the search step | No future data; old ads are stale |
| 5 | Distance | within `radiusM` of the search step, by great-circle distance | `$geoNear` |
| 6 | Score | `score >= 50` | Weak matches never enter the statistics |

---

## 3. The score (0 to 100), exactly

```
score = round( 30*distance + 20*recency + 15*floorArea + 15*type + 10*area + 10*quality , 1 )
```
Each factor is in [0, 1]. Weights sum to 100, so the score needs no scaling.

| Factor | Weight | Formula | Notes |
|---|---:|---|---|
| **distance** | 30 | `max(0, 1 - d / 4000)` with `d` in metres | Linear. The scale is fixed at 4,000 m (the widest ladder step), so a listing scores the same whichever step finds it |
| **recency** | 20 | `0.5 ^ (ageDays / 90)` | Half-life 90 days: 90 days old scores 0.5, 180 days 0.25 |
| **floor area** | 15 | `max(0, 1 - (abs(a - t) / t) / 0.5)`; **0.5** if either area is unknown | `a` = listing m², `t` = target m². A 50% size difference scores 0 |
| **type** | 15 | 1 if the same type, 0.5 if compatible (e.g. studio for apartment), 0.5 if the target type is unknown | |
| **area** | 10 | 1 same census small area; 0.7 same electoral division; 0.4 same LEA; 0 otherwise | Computed from the target's `areas.parents` |
| **quality** | 10 | `clamp(src.geoConfidence, 0, 1)`; **0.5** if unknown | How sure we are of the listing's location |

**Why these weights:** location and freshness decide whether two listings compete (50 of 100). Size and type say whether they are alike in kind (30). Area and quality are tie-breakers (20). Unknown values score a neutral 0.5 rather than 0 or 1, so missing data neither rewards nor punishes a listing, and the warning list says so.

**Worked example** (`4 Sample Ave`: 43 m away, 5 days old, 66 m² vs target 68 m², same type, same small area, geoConfidence 0.9):
```
distance  = 1 - 43/4000                      = 0.989  x30 = 29.68
recency   = 0.5^(5/90)                       = 0.962  x20 = 19.24
floorArea = 1 - (|66-68|/68)/0.5             = 0.941  x15 = 14.12
type      = same                             = 1      x15 = 15.00
area      = same small area                  = 1      x10 = 10.00
quality   = 0.9                                       x10 =  9.00
score                                                      = 97.0
```
This matches the `score: 97` the database returned, and the tests assert that every returned score equals the weighted sum of its returned `factors`.

**Ranking:** `score` descending, then `distM` ascending, then `observedAt` descending, then `_id`. A total order, so the same data always gives the same top N. The strongest **40** are kept (`maxComparables`).

---

## 4. Statistics (all computed in MongoDB, on the selected set)

| Output | Definition |
|---|---|
| `comparableCount` | number selected |
| `medianRent` | exact median: sort the rents and interpolate (PERCENTILE.INC, so even counts average the middle two) |
| `averageRent` | arithmetic mean |
| `weightedAverageRent` | `sum(score x rent) / sum(score)`: stronger matches count more |
| `minRent`, `maxRent`, `rentRange.spread` | min, max, max - min |
| `rentRange.p25/p75/iqr` | exact quartiles by the same interpolation |
| `stdDev` | sample standard deviation |
| `outlierCount` | comparables outside `[p25 - 1.5 iqr, p75 + 1.5 iqr]` (reported, **not** removed) |
| `differenceFromMedian` | `monthlyRent - medianRent` |
| `percentageDifference` | `(monthlyRent - medianRent) / medianRent x 100`, 1 dp |
| `percentileRank` | share of comparables with rent <= target, whole % |
| `position` | `below_all_comparables`, `lower_quartile`, `interquartile_range`, `upper_quartile`, `above_all_comparables` |
| `perSquareMetre` | median rent per m² over comparables with a known area, and the target's rent per m² |
| `dateRange` | earliest and latest `observedAt` among the selected; `searchWindow` is the period searched |
| `mostRecent` | the selected comparable with the latest date (tie: higher score) |
| `coverage` | radius used, nearest / median / farthest distance, distinct small areas, counts per geographic tier |
| `history.listingsByMonth` | per-month count, average, min, max for **all** candidates in the last 12 months within the radius |
| `history.rtbIndex` | cross-check from the official RTB index: 3-year change, latest YoY, and the asking rent versus the area mean |

Rent values are rounded to whole euro with MongoDB `$round`, which rounds halves **to even** (2262.5 becomes 2262, not 2263). The percentage difference uses the rounded median, so the numbers on screen are consistent with each other.

---

## 5. The pipeline

One aggregation per search step. Shown condensed; the complete runnable text (every expression, one stage per line) is in `db/pipelines/rentalComparables.mongosh.js` and was verified to return exactly what the engine returns. Index used: `rental_observations {geo:"2dsphere", measure:1, propertyType:1, bedrooms:1, observedAt:-1}` (`GEO_NEAR_2DSPHERE`).

```js
db.rental_observations.aggregate([

 // 1-5. Find nearby observations; filter bedrooms, property type, time window (inside the index scan); compute distance
 { $geoNear: { near: { type: "Point", coordinates: [-6.2551, 53.3264] }, key: "geo", distanceField: "distM",
     maxDistance: 1000, spherical: true,
     query: { measure: "advertised", "rent.amount": { $gt: 0 },
              bedrooms: 2, propertyType: { $in: ["apartment", "studio"] },
              observedAt: { $gte: ISODate("2025-10-03T06:00:00Z"), $lte: ISODate("2026-10-03T12:00:00Z") } } } },

 { $set: { ageDays: { $dateDiff: { startDate: "$observedAt", endDate: ISODate("2026-10-03T12:00:00Z"), unit: "day" } } } },

 // 6. Factor scores (each 0..1)
 { $set: { f: {
     distance:  { $max: [0, { $subtract: [1, { $divide: ["$distM", 4000] }] }] },
     recency:   { $pow: [0.5, { $divide: ["$ageDays", 90] }] },
     floorArea: { $cond: [{ $gt: ["$floorAreaM2", 0] },
                  { $max: [0, { $subtract: [1, { $divide: [{ $divide: [{ $abs: { $subtract: ["$floorAreaM2", 68] } }, 68] }, 0.5] }] }] }, 0.5] },
     type:      { $cond: [{ $eq: ["$propertyType", "apartment"] }, 1, 0.5] },
     area:      { $switch: { branches: [
                    { case: { $eq: ["$areaId", "sa:268001001"] }, then: 1 },
                    { case: { $in: ["$areaId", { $literal: ["…same electoral division ids…"] }] }, then: 0.7 },
                    { case: { $in: ["$areaId", { $literal: ["…same LEA ids…"] }] }, then: 0.4 }], default: 0 } },
     quality:   { $min: [1, { $max: [0, { $ifNull: ["$src.geoConfidence", 0.5] }] }] } } } },

 { $set: { score: { $round: [{ $add: [
     { $multiply: [30, "$f.distance"] }, { $multiply: [20, "$f.recency"] }, { $multiply: [15, "$f.floorArea"] },
     { $multiply: [15, "$f.type"] },     { $multiply: [10, "$f.area"] },    { $multiply: [10, "$f.quality"] }] }, 1] } } },

 // 7-8. Sort and keep the strongest; also keep the whole pool for monthly history
 { $facet: {
     selected: [
       { $match: { ageDays: { $lte: 90 }, score: { $gte: 50 } } },
       { $sort: { score: -1, distM: 1, observedAt: -1, _id: 1 } },
       { $limit: 40 },
       { $project: { address: 1, rent: "$rent.amount", distM: { $round: ["$distM", 0] }, observedAt: 1, ageDays: 1, floorAreaM2: 1,
                     bedrooms: 1, propertyType: 1, areaId: 1, score: 1, recordId: "$src.recordId", sourceId: "$src.sourceId",
                     factors: { distance: { $round: ["$f.distance", 2] } /* …one entry per factor… */ } } } ],
     history: [
       { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$observedAt" } }, n: { $sum: 1 },
                   avgRent: { $avg: "$rent.amount" }, minRent: { $min: "$rent.amount" }, maxRent: { $max: "$rent.amount" } } },
       { $sort: { _id: 1 } } ],
     pool: [{ $count: "n" }] } },

 // 9. Statistics, computed from the selected array
 { $set: { n: { $size: "$selected" }, rents: "$selected.rent" } },
 { $set: { stats: {
     mean: { $round: [{ $avg: "$rents" }, 0] }, min: { $min: "$rents" }, max: { $max: "$rents" },
     median: { $round: [ /* exact percentile(0.5) of $rents, see pctExpr() */ ], 0] },
     p25: "…", p75: "…", stdDev: { $round: [{ $stdDevSamp: "$rents" }, 1] },
     weightedMean: { $round: [{ $divide: [
        { $sum: { $map: { input: "$selected", in: { $multiply: ["$$this.score", "$$this.rent"] } } } },
        { $sum: "$selected.score" }] }, 0] } } } },

 // 10. Compare the target with the comparables
 { $set: { target: { $cond: [{ $gt: ["$n", 0] }, {
     monthlyRent: 2350,
     differenceFromMedian:  { $subtract: [2350, "$stats.median"] },
     percentageDifference:  { $round: [{ $multiply: [{ $divide: [{ $subtract: [2350, "$stats.median"] }, "$stats.median"] }, 100] }, 1] },
     percentileRank:        { $round: [{ $multiply: [{ $divide: [{ $size: { $filter: { input: "$rents", cond: { $lte: ["$$this", 2350] } } } }, "$n"] }, 100] }, 0] } }, null] } } }
])
```

**The exact percentile expression** (no t-digest approximation, so small samples are exact and tests can verify them):
```js
const pctExpr = (arr, p) => ({ $let: {
  vars: { s: { $sortArray: { input: arr, sortBy: 1 } } },
  in: { $cond: [{ $eq: [{ $size: "$$s" }, 0] }, null, { $let: {
    vars: { pos: { $multiply: [{ $subtract: [{ $size: "$$s" }, 1] }, p] } },
    in: { $let: { vars: { lo: { $floor: "$$pos" }, hi: { $ceil: "$$pos" } },
      in: { $add: [ { $arrayElemAt: ["$$s", "$$lo"] },
            { $multiply: [{ $subtract: [{ $arrayElemAt: ["$$s", "$$hi"] }, { $arrayElemAt: ["$$s", "$$lo"] }] }, { $subtract: ["$$pos", "$$lo"] }] } ] } } } } }] } } })
```
The pipeline needs MongoDB 5.2+ (`$sortArray`) and 5.0+ (`$dateDiff`). It was run on 7.0.14.

---

## 6. Insufficient data

The engine never invents a number and never silently lowers the bar. The behaviour is fixed by the count of comparables **n** after all filters and `score >= 50`:

### Step 1: widen deterministically
Searches stop at the first step with **at least 8** comparables:

| Step | Radius | Selected-set window |
|---|---:|---:|
| 1 | 1,000 m | 90 days |
| 2 | 2,000 m | 180 days |
| 3 | 3,000 m | 365 days |
| 4 | 4,000 m | 365 days |

Every step is recorded in `search.ladder` (`candidatePool`, `comparables`), and a warning says if it widened. Bedrooms and property-type compatibility are never relaxed. A 3-bed is not evidence about a 2-bed.

### Step 2: classify what is left

| n | `status` | `confidence` | Statistics | `comparables` | What the AI may say |
|---:|---|---|---|---|---|
| 0 | `none` | `none` | all `null` | empty | "No comparable listings were found." May cite the RTB index cross-check (`history.rtbIndex`) clearly labelled as area-level. Must not state a market median |
| 1-2 | `insufficient` | `none` | **withheld** (`null`) plus `withheld` reason | listed | May describe the individual listings. Must not give a median, range or "above/below market" |
| 3-7 | `limited` | `low` | published | listed | May state them as "indicative, based on n listings" |
| 8-19 | `sufficient` | `medium` | published | listed | Normal use |
| >= 20 | `sufficient` | `high` | published | listed | Normal use |

Evidence mirrors this: when statistics are withheld there is **no evidence item for a median**, so the AI cannot cite one and `verifyClaims` would reject it.

### Other degradations
| Situation | Behaviour |
|---|---|
| No floor area given | floor-area factor 0.5 for all; warning |
| No property type given | no type filter; type factor 0.5; warning |
| No `monthlyRent` | statistics returned; every target comparison is `null` |
| Coordinates outside every loaded small area | engine still runs; area factor 0; warning |
| Listing without `geoConfidence` | quality 0.5 |
| Statistical outliers present | kept in the figures; count reported in `outlierCount` and warnings |
| Zone or RTB cell missing | `history.rtbIndex` is `null`; no error |
| Bad input (swapped lat/lng, fractional bedrooms, rent <= 0) | throws a descriptive error before any query |

---

## 7. Evidence and how Person 2 uses it

```jsonc
{ "id": "ev9", "tool": "rentalComparables", "claim": "Median comparable asking rent", "value": 2262, "unit": "EUR/month",
  "context": { "areaLevel": "point", "model": "comp-v1", "n": 10, "radiusM": 1000, "windowDays": 90, "minScore": 50, "bedrooms": 2, "propertyType": "apartment" },
  "refs": [ { "collection": "rental_observations", "docId": "6ac0f62f…" }, "… one per comparable …" ],
  "sourceIds": ["listings"] }
```
Evidence items are created for: comparable count, median, average, minimum, maximum, target minus median, target versus median (%), percentile of target, distance to nearest comparable, and date of the most recent comparable. Items for the RTB cross-check come from `benchmarkRent` and `rentTrend`.

`warnings` always includes: *comparables are asking rents, not agreed rents; distances are straight-line*.

**Rules for the AI (enforced by `verifyClaims`):**
1. Quote numbers from `data` or `evidence` only. Do not compute, round or re-derive any figure.
2. Cite the evidence id for each number.
3. Respect `status`: never state a statistic when it is `null`.
4. Reflect `warnings` and `confidence` in the wording.
5. Call `verifyClaims` before finishing. A changed number returns `mismatch`.

---

## 8. Limits to state honestly

- **Asking rents, not agreed rents.** Listings overstate what tenants pay. The RTB index cross-check is there to show that gap.
- **Duplicates.** A property re-advertised appears once per ad. The engine excludes one record id (`excludeRecordId`, for the subject property itself) but does not de-duplicate listings. Person 4 should collapse re-postings (same address, similar rent) at ingest, or the median is biased toward long-listed properties.
- **Straight-line distance**, not walking or commuting time, and not "same side of the river".
- **Geocoding quality** is only as good as `geoConfidence`; the quality factor is worth 10 points, so a badly located listing can still rank if everything else matches.
- **Weights are judgement, not fitted.** They are explicit, versioned (`comp-v1`) and stored with every result. Changing them means a new version, and old results remain reproducible against the version recorded in their evidence.
- **Single bedroom count.** A 2-bed + study or a 2-bed in a 3-bed-heavy block is not modelled.

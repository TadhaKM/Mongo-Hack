# mend.ai: MongoDB Data Model (v1, hackathon)

> **SUPERSEDED.** This is the v1 model. **Schema v2 (current): see [mongodb-schema.md](mongodb-schema.md).** The old `rents` collection was split into `rental_observations` (individual advertised or registered rents; `measure` is a required top-level field) and `rental_indexes` (official area averages; value field `avgRent`, period field `periodStart`). Wherever this document says `rents`, `kind:"listing"` or `kind:"index_cell"`, read `rental_observations` with `measure:"advertised"`, or `rental_indexes` with `measure:"index_mean"`. The code in `db/` is authoritative.


Database name: `rentcheck`. Conventions apply to every collection.

## 0. Decisions

### 0.1 Eight collections

| # | Collection | Holds | Datasets sharing it |
|---|---|---|---|
| 1 | `sources` | dataset registry | n/a |
| 2 | `areas` | polygons for every geography level + Census 2022 snapshot | CSO boundaries, SAPS census, RTB geography polygons |
| 3 | `area_stats` | dated statistics per area | CSO vacancy, RTB disputes, RTB terminations (+ later EPA/Met area summaries) |
| 4 | `rents` | rental observations | RTB/ESRI index cells **and** listing-level rents, via `kind` |
| 5 | `transport_stops` | stops with embedded routes + service frequency | GTFS stops/routes/stop_times (aggregated) |
| 6 | `planning_applications` | planning applications | National Planning |
| 7 | `property_sales` | PPR sales | PPR |
| 8 | `analyses` | one doc per user request, with embedded evidence | n/a |

### 0.2 When datasets share a collection, and when they stay separate

**Share a collection when** the documents answer the same question with the same access path. Same key (`areaId` + date), same query shape, same indexes, differing only in which numbers they carry.
- `area_stats`: vacancy, RTB disputes and RTB terminations are all "a statistic about an area in a period". One index serves all, and adding EPA or Met summaries later needs no new collection. The per-stat payload lives in `values`, validated per `stat`.
- `rents`: an RTB index cell and a listing are both "a rent for a bedroom/type in an area at a date". Comparable queries want one distribution to read, with `kind` and `rent.measure` to filter. Geo exists only on listings (2dsphere is sparse, so no cost for cells).
- `areas`: small areas, EDs, LEAs, counties and RTB zones are all polygons with a parent chain. Census is 1:1 with small area, so it is **embedded**, not a separate collection.

**Keep separate when** the geometry, volume, key or query shape differs.
- `transport_stops`, `planning_applications`, `property_sales` are all point datasets, but their filters (mode; status/date; price/date) and volumes differ, and they are never ranked against each other. One "places" collection would need `type`-guarded sparse fields in every index, and would make every `$geoNear` scan irrelevant documents.
- `areas` vs `area_stats`: polygons are large and static; stats are small and appended each period. Keeping polygons out of the stats avoids 100 KB+ documents being read to get a vacancy number.

**Not collections (deliberately):**
- *Property*: the subject property is a value object embedded at `analyses.subject`. No other feature reads it independently. If P4 ever supplies a property register, add `properties` then.
- *Evidence*: embedded in `analyses.evidence[]` (bounded, ~20–80 items, always read with the analysis, atomic write). Not a separate collection.
- *Transport routes*: embedded in the stop (`routes[]`). The app never asks "list all routes" and always asks "what serves here".
- *GTFS `stop_times`*: P4 aggregates it before delivery into `transport_stops.service`. Raw stop_times is not stored.
- *Time-series collections*: **not used** for rents. Revised from my earlier doc. The RTB index is thousands of rows, not millions; time series cannot be updated or deleted freely and complicates upserts. A regular collection with the compound index below gives the same history queries. Reconsider only if listing-level data reaches millions of rows.

### 0.3 Conventions (all collections)

| Convention | Rule |
|---|---|
| `_id` | Natural string for reference data (`areas`, `sources`, `transport_stops`); `ObjectId` for the rest |
| GeoJSON | `[longitude, latitude]` order. WGS84. Points as `{type:"Point", coordinates:[lng,lat]}` |
| Dates | BSON `Date`, UTC. Period data uses the first instant of the period in `periodStart` |
| Money | `double`, EUR, whole units (€2,180.00 = `2180`) |
| Provenance | Every non-reference document has a `src` object (below) |
| Area link | `areaId` is a string equal to `areas._id` of the **small area** the record falls in (or the area it describes, for stats and rent cells) |
| Unknown | Omit the field. Never `""`, `0` or `"N/A"` as a placeholder |
| Enums | lowercase snake_case |

**`src` subdocument (shared shape)**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `sourceId` | string | R | `sources._id` |
| `recordId` | string | R | Identifier of the row in the original dataset (planning ref, PPR row id, GTFS `stop_id`, index cell key). Part of the idempotency key |
| `version` | string | R | Dataset release, e.g. `2025Q2`, `gtfs-2026-09-30` |
| `retrievedAt` | date | R | When P4 pulled it |
| `geoMethod` | string enum `source_coords`, `eircode`, `address_match`, `centroid`, `polygon` | O | How the location was derived. Required when `geo` is present and not original |
| `geoConfidence` | double 0–1 | O | Required when `geoMethod` is `address_match` or `centroid` |

---

## 1. `sources`

**Purpose:** one doc per dataset release. The target of every `src.sourceId`, and what the UI shows as the citation (organisation, URL, date).

| Field | Type | Req | Notes |
|---|---|---|---|
| `_id` | string | R | slug: `rtb_rent_index`, `cso_saps_2022`, `nta_gtfs`, `ppr`, `planning_national`, `cso_vacancy`, `rtb_disputes`, `rtb_terminations` |
| `title` | string | R | Dataset title |
| `organisation` | string | R | Publisher, e.g. `Residential Tenancies Board` |
| `url` | string | R | Landing page of the dataset |
| `downloadUrl` | string | O | Direct file URL |
| `licence` | string | R | e.g. `CC-BY-4.0` |
| `version` | string | R | Current loaded release |
| `publishedAt` | date | O | Publisher's release date |
| `retrievedAt` | date | R | |
| `recordIdField` | string | R | Which source column becomes `src.recordId` |
| `geographyLevel` | string | O | `point`, `small_area`, `lea`, `county`, `rtb_zone` |
| `coverage` | object `{from: date, to: date}` | R for `rents`, `area_stats` and `analyses` sources; O otherwise | Data period. `coverage.to` drives the freshness check (Op 12) |
| `notes` | string | O | Caveats, e.g. "area-level averages, not listings" |

**Example**
```json
{ "_id":"rtb_rent_index", "title":"RTB Rent Index", "organisation":"Residential Tenancies Board / ESRI",
  "url":"https://www.rtb.ie/research-and-reports/rtb-rent-index",
  "licence":"CC-BY-4.0", "version":"2025Q2", "publishedAt":{"$date":"2025-09-15T00:00:00Z"},
  "retrievedAt":{"$date":"2026-09-30T10:00:00Z"}, "recordIdField":"cell_key",
  "geographyLevel":"rtb_zone", "coverage":{"from":{"$date":"2007-01-01T00:00:00Z"},"to":{"$date":"2025-06-30T00:00:00Z"}},
  "notes":"Area-level standardised averages. Not individual listings." }
```
*(URL above is illustrative. P4 supplies the real one.)*

**Indexes:** `_id` only (tiny collection).
**Relationships:** referenced by `*.src.sourceId` and `analyses.evidence[].sourceIds[]`.
**GeoJSON:** none.
**Query:** `db.sources.find({_id:{$in:["rtb_rent_index","ppr"]}})`

---

## 2. `areas`

**Purpose:** every geography the system reasons over, with polygon, hierarchy and (for small areas) the Census 2022 snapshot. This is the spatial join table: a coordinate → one small area → `parents` gives every other level's id with no further spatial queries.

| Field | Type | Req | Notes |
|---|---|---|---|
| `_id` | string | R | `${level}:${code}`, e.g. `sa:268001001`, `lea:dublin-city-central`, `county:dublin-city`, `rtbzone:dublin-4` |
| `level` | string enum `small_area`,`electoral_division`,`lea`,`county`,`rtb_zone` | R | |
| `code` | string | R | Official code |
| `name` | string | R | |
| `geometry` | GeoJSON `Polygon`/`MultiPolygon` | R | |
| `centroid` | GeoJSON `Point` | R | |
| `featureVector` | array<double> (4) | O | Small areas only. z-scored `[renterPct, avgHouseholdSize, share aged 25-34, population density]`, computed in-database (Op 15) |
| `areaKm2` | double | R | |
| `parents` | object `{electoral_division?, lea?, county?, rtb_zone?}` of area `_id` strings | R for `small_area`; O otherwise | `rtb_zone` is the key for rent cells. P4 provides the mapping. If the RTB geography has no polygon, P4 sets `parents.rtb_zone` on each small area directly |
| `census` | object (below) | O | Only on `small_area` |
| `src` | `src` | R | |

`census` (all optional except `population`, `year`):

| Field | Type |
|---|---|
| `year` | int (2022) |
| `population` | int |
| `households` | int |
| `avgHouseholdSize` | double |
| `dwellings` | int |
| `renterHouseholds` | int |
| `ownerOccupiedHouseholds` | int |
| `renterPct` | double (0–100) |
| `vacantDwellings` | int |
| `ageBands` | object `{ "0_14": int, "15_24": int, "25_34": int, "35_64": int, "65_plus": int }` |

**Example**
```json
{ "_id":"sa:268001001","level":"small_area","code":"268001001","name":"Ranelagh A",
  "geometry":{"type":"Polygon","coordinates":[[[-6.2561,53.3258],[-6.2531,53.3258],[-6.2531,53.3281],[-6.2561,53.3281],[-6.2561,53.3258]]]},
  "centroid":{"type":"Point","coordinates":[-6.2546,53.327]}, "areaKm2":0.31,
  "parents":{"electoral_division":"ed:268001","lea":"lea:dublin-city-south-east","county":"county:dublin-city","rtb_zone":"rtbzone:dublin-6"},
  "census":{"year":2022,"population":412,"households":171,"avgHouseholdSize":2.4,"dwellings":188,
            "renterHouseholds":99,"renterPct":57.9,"vacantDwellings":9,
            "ageBands":{"0_14":48,"15_24":55,"25_34":129,"35_64":140,"65_plus":40}},
  "src":{"sourceId":"cso_saps_2022","recordId":"268001001","version":"2022","retrievedAt":{"$date":"2026-09-30T10:00:00Z"}} }
```

**Indexes**
```js
db.areas.createIndex({ geometry: "2dsphere", level: 1 })   // point-in-polygon, filtered by level
db.areas.createIndex({ centroid: "2dsphere", level: 1 })   // nearest zones by distance, filtered by level
db.areas.createIndex({ level: 1, code: 1 }, { unique: true })
db.areas.createIndex({ "parents.lea": 1 })                 // list small areas in an LEA
```
**Relationships:** `parents.*` → `areas._id`; referenced as `areaId` by `rents`, `area_stats`, `planning_applications`, `property_sales`, `transport_stops`.
**GeoJSON:** `geometry` (Polygon/MultiPolygon), `centroid` (Point).
**Queries**
```js
// Which small area contains this coordinate (the one spatial join in the system)
db.areas.findOne(
  { level:"small_area", geometry:{ $geoIntersects:{ $geometry:{ type:"Point", coordinates:[-6.2546,53.327] } } } },
  { parents:1, census:1, name:1 })

// Nearest 5 LEAs to a point (for neighbour rent comparison)
db.areas.aggregate([{ $geoNear:{ near:{type:"Point",coordinates:[-6.2546,53.327]}, key:"centroid",
  distanceField:"distM", maxDistance:5000, query:{level:"lea"}, spherical:true }}, { $limit:5 }])
```

---

## 3. `area_stats`

**Purpose:** dated statistics about an area from datasets that are area × period × numbers: vacancy, RTB disputes, RTB terminations (and later EPA or Met Éireann area summaries).

| Field | Type | Req | Notes |
|---|---|---|---|
| `_id` | ObjectId | R | |
| `areaId` | string | R | `areas._id`, any level (vacancy may be at LEA or county) |
| `areaLevel` | string | R | copy of the area's level, for filtering without join |
| `stat` | string enum `vacancy`,`rtb_disputes`,`rtb_terminations` | R | |
| `dimension` | string | O | Sub-series, e.g. dispute category `deposit_retention`, termination ground `sale_of_property`. Omit if none |
| `periodStart` | date | R | |
| `periodEnd` | date | R | |
| `periodLabel` | string | R | `2022`, `2025Q1` |
| `values` | object | R | shape depends on `stat` (below) |
| `src` | `src` | R | |

`values` by `stat`:

| stat | Fields |
|---|---|
| `vacancy` | `vacantDwellings` int (R), `totalDwellings` int (R), `vacancyRatePct` double (R), `longTermVacantDwellings` int (O) |
| `rtb_disputes` | `cases` int (R), `casesPer1000Tenancies` double (O), `outcomes` object `{upheld?:int, rejected?:int, withdrawn?:int}` (O) |
| `rtb_terminations` | `notices` int (R), `noticesPer1000Tenancies` double (O) |

**Example**
```json
{ "areaId":"lea:dublin-city-south-east","areaLevel":"lea","stat":"rtb_terminations","dimension":"sale_of_property",
  "periodStart":{"$date":"2025-01-01T00:00:00Z"},"periodEnd":{"$date":"2025-03-31T23:59:59Z"},"periodLabel":"2025Q1",
  "values":{"notices":84,"noticesPer1000Tenancies":6.9},
  "src":{"sourceId":"rtb_terminations","recordId":"lea-dcse|2025Q1|sale","version":"2025Q1","retrievedAt":{"$date":"2026-09-30T10:00:00Z"}} }
```

**Indexes**
```js
db.area_stats.createIndex({ areaId:1, stat:1, dimension:1, periodStart:-1 }, { unique:true })  // upsert key + history
db.area_stats.createIndex({ stat:1, areaLevel:1, periodStart:-1 })                            // rank areas within a stat
```
**Relationships:** `areaId` → `areas._id`.
**GeoJSON:** none (location comes from the area).
**Queries**
```js
// Latest vacancy for an area
db.area_stats.find({ areaId:"lea:dublin-city-south-east", stat:"vacancy" }).sort({ periodStart:-1 }).limit(1)

// Termination notices by ground, last 4 quarters, area
db.area_stats.aggregate([
  { $match:{ areaId:"lea:dublin-city-south-east", stat:"rtb_terminations", periodStart:{ $gte:ISODate("2024-07-01") } } },
  { $group:{ _id:"$dimension", notices:{ $sum:"$values.notices" } } }, { $sort:{ notices:-1 } }])
```

---

## 4. `rents`

**Purpose:** every rent datapoint. Area-level (RTB/ESRI index cells) and listing-level share a collection, so comparables, history and "is this rent high" are one distribution query.

| Field | Type | Req | Notes |
|---|---|---|---|
| `_id` | ObjectId | R | |
| `kind` | string enum `index_cell`,`listing` | R | |
| `areaId` | string | R | `index_cell`: the RTB area (`rtbzone:…` or other level). `listing`: small area |
| `areaLevel` | string | R | |
| `propertyType` | string enum `apartment`,`house`,`detached`,`semi_detached`,`terraced`,`studio`,`all` | R | `all` is for index cells that are not split by type |
| `bedrooms` | int 0–5 | O | `0`=studio, `5`=5+. Omit when the cell covers all bedroom counts |
| `rent` | object `{amount: double (R), measure: enum mean/median/asking/registered (R), period: "month" (R)}` | R | Currency is always EUR |
| `stdError` | double | O | Index cells |
| `sampleSize` | int | O | Index cells |
| `observedAt` | date | R | Start of the observation period (quarter start for the index; listing date for listings) |
| `periodLabel` | string | O | `2025Q2` |
| `address` | string | O | Listings only |
| `geo` | GeoJSON `Point` | O | Listings only |
| `floorAreaM2` | double | O | Listings only |
| `description` | string | O | Listings only. Source text for the embedding |
| `embedding` | array<double> | O | Listings only. Vector Search (Op 14). Dimension fixed when the index is created |
| `src` | `src` | R | `recordId` = cell key (`rtbzone:dublin-6|apartment|2|2025Q2`) or listing id |

**Example (index cell)**
```json
{ "kind":"index_cell","areaId":"rtbzone:dublin-6","areaLevel":"rtb_zone","propertyType":"apartment","bedrooms":2,
  "rent":{"amount":2214,"measure":"mean","period":"month"},"stdError":41,"sampleSize":312,
  "observedAt":{"$date":"2025-04-01T00:00:00Z"},"periodLabel":"2025Q2",
  "src":{"sourceId":"rtb_rent_index","recordId":"rtbzone:dublin-6|apartment|2|2025Q2","version":"2025Q2","retrievedAt":{"$date":"2026-09-30T10:00:00Z"}} }
```
**Example (listing)**
```json
{ "kind":"listing","areaId":"sa:268001001","areaLevel":"small_area","propertyType":"apartment","bedrooms":2,
  "rent":{"amount":2350,"measure":"asking","period":"month"},"floorAreaM2":68,
  "address":"12 Example Rd, Ranelagh, Dublin 6","geo":{"type":"Point","coordinates":[-6.2551,53.3264]},
  "observedAt":{"$date":"2026-09-12T00:00:00Z"},
  "src":{"sourceId":"listings","recordId":"L-99812","version":"2026-09","retrievedAt":{"$date":"2026-09-30T10:00:00Z"},"geoMethod":"address_match","geoConfidence":0.9} }
```
(Listings are optional: if P4 has no listing source, `rents` contains only `index_cell`.)

**Indexes**
```js
// history + latest for an area/type/beds (also the upsert key for cells)
db.rents.createIndex({ areaId:1, kind:1, propertyType:1, bedrooms:1, observedAt:-1, "src.recordId":1 }, { unique:true })
// listing comparables near a point
db.rents.createIndex({ geo:"2dsphere", kind:1, propertyType:1, bedrooms:1, observedAt:-1 })
// cross-area ranking in one period
db.rents.createIndex({ kind:1, areaLevel:1, propertyType:1, bedrooms:1, observedAt:-1 })
```
**Relationships:** `areaId` → `areas._id`; `src.sourceId` → `sources._id`.
**GeoJSON:** `geo` (Point, listings only).
**Queries**
```js
// Latest RTB cell for the property's RTB zone (areaId from areas.parents.rtb_zone)
db.rents.find({ areaId:"rtbzone:dublin-6", kind:"index_cell", propertyType:"apartment", bedrooms:2 })
        .sort({ observedAt:-1 }).limit(1)

// History: 3 years of that series
db.rents.find({ areaId:"rtbzone:dublin-6", kind:"index_cell", propertyType:"apartment", bedrooms:2,
                observedAt:{ $gte:ISODate("2022-10-01") } }).sort({ observedAt:1 })

// YoY and moving average
db.rents.aggregate([
 { $match:{ areaId:"rtbzone:dublin-6", kind:"index_cell", propertyType:"apartment", bedrooms:2 } },
 { $setWindowFields:{ sortBy:{ observedAt:1 }, output:{
     prev4:{ $shift:{ output:"$rent.amount", by:-4 } },
     ma4:{ $avg:"$rent.amount", window:{ documents:[-3,0] } } } } },
 { $set:{ yoyPct:{ $round:[{ $multiply:[{ $divide:[{ $subtract:["$rent.amount","$prev4"] },"$prev4"] },100] },1] } } },
 { $project:{ periodLabel:1, "rent.amount":1, ma4:1, yoyPct:1 } }])

// Listing comparables within 1.5 km, same type/beds, last 6 months, with percentile of asking rent
db.rents.aggregate([
 { $geoNear:{ near:{type:"Point",coordinates:[-6.2546,53.327]}, key:"geo", distanceField:"distM", maxDistance:1500, spherical:true,
     query:{ kind:"listing", propertyType:"apartment", bedrooms:2, observedAt:{ $gte:ISODate("2026-04-01") } } } },
 { $group:{ _id:null, n:{ $sum:1 }, median:{ $median:{ input:"$rent.amount", method:"approximate" } },
     p25p75:{ $percentile:{ input:"$rent.amount", p:[0.25,0.75], method:"approximate" } },
     all:{ $push:"$rent.amount" } } },
 { $set:{ askingPercentile:{ $multiply:[{ $divide:[{ $size:{ $filter:{ input:"$all", cond:{ $lte:["$$this",2350] } } } },"$n"] },100] } } },
 { $project:{ all:0 } }])
```

---

## 5. `transport_stops`

**Purpose:** public transport stops with the routes that serve them and pre-aggregated service frequency, so "what's near me and how good is it" is one geo query.

| Field | Type | Req | Notes |
|---|---|---|---|
| `_id` | string | R | `${agency}:${stop_id}` e.g. `nta:8220DB000002` |
| `stopId` | string | R | GTFS `stop_id` |
| `name` | string | R | |
| `geo` | GeoJSON `Point` | R | |
| `modes` | array<string enum `bus`,`luas`,`dart`,`rail`,`commuter_rail`,`other`> | R | min 1 |
| `routes` | array<object> | R | may be empty |
| `routes[].routeId` | string | R | |
| `routes[].shortName` | string | R | `46A` |
| `routes[].longName` | string | O | |
| `routes[].mode` | string enum (as above) | R | |
| `routes[].agency` | string | R | |
| `routes[].headsigns` | array<string> | O | |
| `service` | object | O | pre-aggregated by P4 from `stop_times` |
| `service.weekdayPeakTripsPerHour` | double | O | 07:00–09:30 |
| `service.weekdayOffPeakTripsPerHour` | double | O | |
| `service.weekendTripsPerHour` | double | O | |
| `service.firstDeparture` / `lastDeparture` | string `HH:mm` | O | |
| `wheelchairAccessible` | bool | O | |
| `areaId` | string | R | small area, assigned at load |
| `src` | `src` | R | `recordId` = GTFS `stop_id`, `version` = feed date |

**Example**
```json
{ "_id":"nta:8220DB000002","stopId":"8220DB000002","name":"Ranelagh, Luas",
  "geo":{"type":"Point","coordinates":[-6.2561,53.3266]},"modes":["luas"],
  "routes":[{"routeId":"GREEN","shortName":"Green","mode":"luas","agency":"Luas","headsigns":["Brides Glen","Broombridge"]}],
  "service":{"weekdayPeakTripsPerHour":16,"weekdayOffPeakTripsPerHour":8,"weekendTripsPerHour":8,"firstDeparture":"05:30","lastDeparture":"00:30"},
  "wheelchairAccessible":true,"areaId":"sa:268001001",
  "src":{"sourceId":"nta_gtfs","recordId":"8220DB000002","version":"gtfs-2026-09-30","retrievedAt":{"$date":"2026-09-30T10:00:00Z"}} }
```
**Indexes**
```js
db.transport_stops.createIndex({ geo:"2dsphere" })
db.transport_stops.createIndex({ modes:1, geo:"2dsphere" })
db.transport_stops.createIndex({ areaId:1 })
db.transport_stops.createIndex({ "routes.shortName":1 })
```
**Relationships:** `areaId` → `areas`; `src.sourceId` → `sources`.
**GeoJSON:** `geo` (Point).
**Query**
```js
// Stops within 800 m, grouped by mode, with nearest distance and peak frequency
db.transport_stops.aggregate([
 { $geoNear:{ near:{type:"Point",coordinates:[-6.2546,53.327]}, key:"geo", distanceField:"distM", maxDistance:800, spherical:true } },
 { $unwind:"$modes" },
 { $group:{ _id:"$modes", nearestM:{ $min:"$distM" }, stops:{ $sum:1 },
            peakTripsPerHour:{ $sum:"$service.weekdayPeakTripsPerHour" },
            routes:{ $addToSet:"$routes.shortName" } } },
 { $set:{ routes:{ $reduce:{ input:"$routes", initialValue:[], in:{ $setUnion:["$$value","$$this"] } } } } }])
```

---

## 6. `planning_applications`

**Purpose:** planning applications with location, dates, decision and proposal text, queryable by distance, status and date.

| Field | Type | Req | Notes |
|---|---|---|---|
| `_id` | ObjectId | R | |
| `reference` | string | R | Application number |
| `authority` | string | R | Planning authority |
| `geo` | GeoJSON `Point` | R | Applications without a location are not loaded |
| `address` | string | O | Site address |
| `proposal` | string | R | Development description |
| `applicationDate` | date | R | Received date |
| `status` | string enum `pending`,`granted`,`refused`,`withdrawn`,`invalid`,`appealed`,`unknown` | R | Normalised |
| `decision` | object | O | Omit when pending |
| `decision.outcome` | string (source wording) | R if present | |
| `decision.date` | date | O | |
| `development` | object `{type: enum residential/commercial/mixed/other, residentialUnits?: int, floorAreaM2?: double}` | O | `residentialUnits` is only set when parsed from the data, never inferred from text |
| `areaId` | string | R | small area |
| `src` | `src` | R | `recordId` = authority-qualified reference |

**Example**
```json
{ "reference":"3456/24","authority":"Dublin City Council","geo":{"type":"Point","coordinates":[-6.2570,53.3280]},
  "address":"Site at Cowper Rd, Ranelagh","proposal":"Construction of 42 apartments over basement car park",
  "applicationDate":{"$date":"2024-06-10T00:00:00Z"},"status":"granted",
  "decision":{"outcome":"Grant Permission","date":{"$date":"2024-11-02T00:00:00Z"}},
  "development":{"type":"residential","residentialUnits":42},"areaId":"sa:268001001",
  "src":{"sourceId":"planning_national","recordId":"DCC|3456/24","version":"2026-09","retrievedAt":{"$date":"2026-09-30T10:00:00Z"}} }
```
**Indexes**
```js
db.planning_applications.createIndex({ geo:"2dsphere", applicationDate:-1, status:1 })
db.planning_applications.createIndex({ "src.recordId":1 }, { unique:true })
db.planning_applications.createIndex({ areaId:1, applicationDate:-1 })
db.planning_applications.createIndex({ proposal:"text" })    // hackathon fallback; replace with Atlas Search if time
```
**Relationships:** `areaId` → `areas`.
**GeoJSON:** `geo` (Point).
**Query**
```js
db.planning_applications.aggregate([
 { $geoNear:{ near:{type:"Point",coordinates:[-6.2546,53.327]}, key:"geo", distanceField:"distM", maxDistance:1000, spherical:true,
     query:{ applicationDate:{ $gte:ISODate("2022-01-01") } } } },
 { $facet:{
    byStatus:[{ $group:{ _id:"$status", n:{ $sum:1 }, units:{ $sum:{ $ifNull:["$development.residentialUnits",0] } } } }],
    largest:[{ $match:{ "development.residentialUnits":{ $gt:0 } } }, { $sort:{ "development.residentialUnits":-1 } }, { $limit:5 },
             { $project:{ reference:1, proposal:1, status:1, distM:1, "development.residentialUnits":1 } }] } }])
```

---

## 7. `property_sales`

**Purpose:** Residential Property Price Register sales: price context for the area. Sales are not rents, and results must be labelled that way.

| Field | Type | Req | Notes |
|---|---|---|---|
| `_id` | ObjectId | R | |
| `address` | string | R | as in PPR |
| `eircode` | string | O | |
| `geo` | GeoJSON `Point` | O | Omit if geocoding failed; such rows are excluded from geo queries |
| `salePrice` | double | R | EUR |
| `saleDate` | date | R | |
| `fullMarketPrice` | bool | R | PPR "not full market price" flag inverted |
| `vatExclusive` | bool | O | |
| `newDwelling` | bool | O | |
| `propertyType` | string enum as `rents.propertyType` minus `all`, plus `unknown` | O | |
| `areaId` | string | O | small area, requires `geo` |
| `src` | `src` | R | `recordId` = PPR row id or hash(address,date,price); geo fields mandatory when `geo` present |

**Example**
```json
{ "address":"12 Example Rd, Ranelagh, Dublin 6","geo":{"type":"Point","coordinates":[-6.2551,53.3264]},
  "salePrice":545000,"saleDate":{"$date":"2025-08-14T00:00:00Z"},"fullMarketPrice":true,"newDwelling":false,
  "propertyType":"terraced","areaId":"sa:268001001",
  "src":{"sourceId":"ppr","recordId":"ppr-2025-081423","version":"2025-09","retrievedAt":{"$date":"2026-09-30T10:00:00Z"},"geoMethod":"address_match","geoConfidence":0.88} }
```
**Indexes**
```js
db.property_sales.createIndex({ geo:"2dsphere", saleDate:-1, fullMarketPrice:1 })
db.property_sales.createIndex({ areaId:1, saleDate:-1 })
db.property_sales.createIndex({ "src.recordId":1 }, { unique:true })
```
**Relationships:** `areaId` → `areas`.
**GeoJSON:** `geo` (Point).
**Query**
```js
db.property_sales.aggregate([
 { $geoNear:{ near:{type:"Point",coordinates:[-6.2546,53.327]}, key:"geo", distanceField:"distM", maxDistance:1000, spherical:true,
     query:{ saleDate:{ $gte:ISODate("2025-01-01") }, fullMarketPrice:true, "src.geoConfidence":{ $gte:0.5 } } } },
 { $group:{ _id:null, n:{ $sum:1 }, median:{ $median:{ input:"$salePrice", method:"approximate" } },
            p25p75:{ $percentile:{ input:"$salePrice", p:[0.25,0.75], method:"approximate" } } } }])
```

---

## 8. `analyses`

**Purpose:** a durable record of each analysis: the property analysed, the database results returned, and the evidence items every claim must cite. It doubles as the cache and audit trail.

| Field | Type | Req | Notes |
|---|---|---|---|
| `_id` | ObjectId | R | |
| `inputHash` | string | R | hash of normalised `subject` (cache key) |
| `subject` | object | R | the property analysed |
| `subject.address` | string | R | as entered |
| `subject.geo` | GeoJSON `Point` | R | resolved |
| `subject.geoMethod` / `geoConfidence` | string / double | O | |
| `subject.bedrooms` | int | O | |
| `subject.propertyType` | string enum as `rents.propertyType` | O | |
| `subject.floorAreaM2` | double | O | |
| `subject.askingRent` | double | O | |
| `resolved` | object `{areaId: string, parents: object, areaName: string}` | R | from `areas` |
| `results` | object | R | One key per DB tool: `rentComparables`, `rentHistory`, `transport`, `planning`, `sales`, `neighbourhood`; each is the exact DB output |
| `evidence` | array<object> | R | |
| `evidence[].id` | string | R | `ev1`, `ev2`, … unique within the analysis |
| `evidence[].tool` | string | R | which `results` key produced it |
| `evidence[].claim` | string | R | e.g. `Latest RTB mean rent, 2-bed apartment, Dublin 6` |
| `evidence[].value` | double \| string \| bool | R | |
| `evidence[].unit` | string | O | `EUR/month`, `m`, `count`, `pct` |
| `evidence[].context` | object | O | parameters (radius, period, n). Include `areaLevel` (`small_area`, `lea`, `rtb_zone`, `point`, ...) so the freshness and geographic-level checks work |
| `evidence[].refs` | array<`{collection: string, docId: string}`> | R | underlying records |
| `evidence[].sourceIds` | array<string> | R | `sources._id`s |
| `status` | string enum `running`,`complete`,`failed` | R | |
| `warnings` | array<string> | O | e.g. coverage gaps |
| `report` | object (opaque) | O | whatever the report layer stores. The DB does not interpret it |
| `createdAt` | date | R | |
| `completedAt` | date | O | |
| `durationMs` | int | O | |
| `dataVersions` | object `{ <sourceId>: version }` | R | the dataset versions used, so results are reproducible |

**Example**
```json
{ "inputHash":"9c1f…","subject":{"address":"12 Example Rd, Ranelagh, Dublin 6","geo":{"type":"Point","coordinates":[-6.2551,53.3264]},
    "bedrooms":2,"propertyType":"apartment","floorAreaM2":68,"askingRent":2350},
  "resolved":{"areaId":"sa:268001001","areaName":"Ranelagh A","parents":{"lea":"lea:dublin-city-south-east","rtb_zone":"rtbzone:dublin-6"}},
  "results":{"rentComparables":{"ownCell":{"amount":2214,"period":"2025Q2"},"askingVsCellPct":6.1}},
  "evidence":[{"id":"ev1","tool":"rentComparables","claim":"Latest RTB mean rent, 2-bed apartment, Dublin 6","value":2214,"unit":"EUR/month",
     "context":{"period":"2025Q2","sampleSize":312},"refs":[{"collection":"rents","docId":"6650…"}],"sourceIds":["rtb_rent_index"]}],
  "status":"complete","dataVersions":{"rtb_rent_index":"2025Q2","nta_gtfs":"gtfs-2026-09-30"},
  "createdAt":{"$date":"2026-10-03T14:00:00Z"},"completedAt":{"$date":"2026-10-03T14:00:04Z"},"durationMs":4120 }
```
**Indexes**
```js
db.analyses.createIndex({ inputHash:1, createdAt:-1 })
db.analyses.createIndex({ "subject.geo":"2dsphere" })
db.analyses.createIndex({ createdAt:-1 })
db.analyses.createIndex({ createdAt:1 }, { expireAfterSeconds: 60*60*24*30 })   // optional 30-day TTL; drop if you want permanent history
```
(The last two share a key; keep only the TTL one if you enable TTL.)
**Relationships:** `resolved.areaId` → `areas`; `evidence[].refs` → any collection; `evidence[].sourceIds` → `sources`.
**GeoJSON:** `subject.geo` (Point).
**Queries**
```js
// Cache hit within 24 h
db.analyses.findOne({ inputHash:"9c1f…", status:"complete", createdAt:{ $gte:new Date(Date.now()-864e5) } })

// Resolve the evidence cited in a report, with citations
db.analyses.aggregate([
 { $match:{ _id:ObjectId("…") } }, { $unwind:"$evidence" },
 { $lookup:{ from:"sources", localField:"evidence.sourceIds", foreignField:"_id", as:"evidence.sources" } },
 { $replaceRoot:{ newRoot:"$evidence" } }])

// Verify a stated number against stored evidence
db.analyses.countDocuments({ _id:ObjectId("…"), evidence:{ $elemMatch:{ id:"ev1", value:2214 } } })
```

---

## 9. Relationship map

```
sources <---- src.sourceId ---- {areas, area_stats, rents, transport_stops, planning_applications, property_sales}
areas <------ areaId ---------- {area_stats, rents, transport_stops, planning_applications, property_sales}
areas.parents.* ---> areas        (small_area -> ed, lea, county, rtb_zone)
analyses.resolved.areaId ---> areas
analyses.evidence[].refs ---> any record
```
Only one spatial join exists: **point → `areas`**. Everything else is `areaId` equality or a single-collection `$geoNear`.

## 10. Idempotency keys (for P4)

| Collection | Unique key |
|---|---|
| `areas` | `_id` |
| `area_stats` | `areaId + stat + dimension + periodStart` |
| `rents` | `areaId + kind + propertyType + bedrooms + observedAt + src.recordId` |
| `transport_stops` | `_id` |
| `planning_applications` | `src.recordId` |
| `property_sales` | `src.recordId` |

## 11. Hackathon load order and minimum viable data

1. `sources`, `areas` (small areas + RTB zone parents), required for everything.
2. `rents` index cells, enough for the core demo.
3. `transport_stops`, `property_sales`, `planning_applications`.
4. `area_stats`: vacancy first, then RTB.
5. `analyses`: created at runtime, nothing to load.

## 12. Open items for P4

- Provide `parents.rtb_zone` for each small area, or a polygon for each RTB geography.
- Say whether a listing-level rent source exists. If not, `rents.kind="listing"` stays empty and comparables use index cells and neighbouring zones.
- Provide `src.recordId` as a stable ID so reloads upsert.

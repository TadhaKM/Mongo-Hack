# RentCheck AI: MongoDB Database Schema (v2, authoritative)

Database: **`rentcheck`**. Implemented and tested in `db/` (`npm run db:test`: 49 checks against a real mongod 7.0.14). This replaces the v1 model in [mongodb-data-model.md](mongodb-data-model.md).

**What changed from v1, and why**

| Change | Reason |
|---|---|
| `rents` split into **`rental_observations`** (points) and **`rental_indexes`** (area averages) | Two fundamentally different measurements must not be reachable by the same query. Different collection, different value field name, different geometry, different required fields |
| Required top-level **`measure`** on every rental observation (`advertised` or `registered`) | The comparable engine hard-filters on it, indexes lead with it, and the database rejects documents without it |
| New **`properties`** collection | A stable id for an address: de-duplicates repeat analyses, caches the geography lookup, and gives re-advertised listings something to link to |
| Evidence stays **embedded** in `analyses`, with fuller fields (`queryParameters`, `geographicScope`, `observationPeriod`, `generatedAt`) | Always read with its analysis, bounded in size, written atomically. Same shape as a standalone document, so it can be split out later |
| `areas` kept as one collection for all geography levels (not `census_areas`) | Small areas, electoral divisions, LEAs, counties and RTB zones share one shape and one polygon index; census statistics are embedded on small areas only |
| `area_stats` kept as one collection for vacancy and RTB disputes/terminations (not `vacancy`) | Same key (area x period), same queries, same indexes. `areaLevel` is a required field |
| JSON-Schema **validators** on the collections where mixing would corrupt statistics | `rental_observations`, `rental_indexes`, `property_sales`, `properties`, `analyses` |

---

## 1. Final collection architecture

### Ten collections: eight must-have, two should-have

| # | Collection | Rank | Holds | Datasets that share it |
|---|---|---|---|---|
| 1 | `sources` | MUST | one document per dataset release (organisation, URL, licence, versions) | n/a |
| 2 | `areas` | MUST | polygons for every geography level + Census 2022 on small areas | CSO boundaries, CSO SAPS, RTB zone polygons |
| 3 | `properties` | MUST | one document per physical address analysed | n/a |
| 4 | `rental_observations` | MUST | individual **advertised** (or registered) rents at a point | listings, any registered-rent record data |
| 5 | `rental_indexes` | MUST | official **area-level** rent index cells | RTB / ESRI Rent Index |
| 6 | `transport_stops` | MUST | stops with their routes and service frequency | NTA / TFI GTFS |
| 7 | `planning_applications` | MUST | planning applications | National Planning Applications |
| 8 | `analyses` | MUST | one document per user analysis, with results and embedded evidence | n/a |
| 9 | `property_sales` | SHOULD | PPR sale prices (price context, never rent) | Residential Property Price Register |
| 10 | `area_stats` | SHOULD | dated statistics per area | CSO vacancy, RTB disputes, RTB terminations |

### Why each exists, and when data shares a collection

| Collection | Why it exists | Why separate | Relations | Reference or embed |
|---|---|---|---|---|
| `sources` | Every number must trace to a dataset, publisher, URL and version | Reference data shared by thousands of records; changes rarely | Referenced by `src.sourceId` everywhere and `evidence[].sourceIds` | **Reference** (`_id` slug). Embedding would copy the same URL into millions of rows |
| `areas` | The only spatial join in the system: point to polygon to ids at every level | Large, static polygons; read by `$geoIntersects` only | Referenced by `areaId` everywhere; `parents.*` reference other areas | **Reference** by id. Census is **embedded** on the small area (1:1, always read together) |
| `properties` | Stable identity for an address; cached geography | Lifecycle differs from observations (created on demand, updated rarely) | Referenced by `analyses.propertyId`; optionally by `rental_observations.propertyId` | Geography ids **duplicated** deliberately (small, immutable between censuses) |
| `rental_observations` | Comparable engine input: one document per advertised rent | Volume, point geometry, daily freshness; different statistics to the index | `areaId` to `areas`; optional `propertyId` to `properties` | **Reference** by ids. No embedded neighbours |
| `rental_indexes` | Official benchmark and trend | Area grain, no point, quarterly cadence, carries standard error and sample size | `areaId` to `areas` (RTB zone) | **Reference** |
| `transport_stops` | "Within 500 m" and "nearest stop" | Point dataset with its own filter (mode) and volume | `areaId` to `areas` | Routes **embedded** (see section 4) |
| `planning_applications` | "Within 1 km", by status and date | Different filters and a text field | `areaId` | **Reference** |
| `property_sales` | Price context for the area | Must never be read by rent queries (section 7) | `areaId` | **Reference** |
| `area_stats` | Vacancy and RTB statistics at their native geography | Polygons stay out of the stats; stats are appended each period | `areaId` (any level) | **Reference** |
| `analyses` | The report's backing record: input, results, evidence, timestamps | Written at runtime, one per request | `propertyId`; `evidence[].refs` to any record | Evidence **embedded** |

**Rule used to decide:** datasets **share** a collection when they answer the same question with the same key and the same indexes (`area_stats`, `areas`). They stay **separate** when the geometry, the measurement or the query shape differs (the three point datasets, and above all rent observations vs rent indexes vs sales).

**Deliberately not collections:** `evidence` (embedded), `vacancy` (inside `area_stats`), `census_areas` (inside `areas`), transport routes (embedded in stops), GTFS `stop_times` (aggregated by Person 4 before loading).

**Time series:** not used. The RTB index is thousands of rows, not millions, and time-series collections are awkward to upsert and cannot be freely updated. `rental_indexes` with a compound index gives the same history queries. Reconsider only if `rental_observations` reaches tens of millions of rows.

### Conventions (all collections)

| Convention | Rule |
|---|---|
| `_id` | Natural string for reference data (`sources`, `areas`, `transport_stops`); `ObjectId` otherwise |
| GeoJSON | `[longitude, latitude]`, WGS84. Points: `{type:"Point", coordinates:[lng,lat]}` |
| Dates | BSON `Date`, UTC. Period data uses the first instant of the period |
| Money | `double`, EUR, whole units. Rents are **per month** (validator rejects other periods) |
| Provenance | Every loaded document has `src` (below) |
| Area link | `areaId` = `areas._id` |
| Unknown values | Omit the field. Never `""`, `0` or `"N/A"` |

**`src` subdocument**

| Field | Type | Req | Meaning |
|---|---|---|---|
| `sourceId` | string | R | `sources._id` |
| `recordId` | string | R | identifier of the row in the original dataset; with `sourceId` it is the idempotency key |
| `version` | string | R | dataset release, e.g. `2026Q3`, `gtfs-2026-09-30` |
| `retrievedAt` | date | R | when Person 4 pulled it |
| `geoMethod` | enum `source_coords`, `eircode`, `address_match`, `centroid`, `polygon` | O | how the location was derived (required when approximate) |
| `geoConfidence` | double 0-1 | O | feeds the engine's quality factor |

---

## 2. `properties`

**Purpose:** one document per physical address the system has analysed. Created by `getOrCreateProperty()` (upsert on `addressKey`) when an analysis starts.

| Field | Type | Req | Notes |
|---|---|---|---|
| `_id` | ObjectId | R | `propertyId` |
| `addressKey` | string | R | **unique**. Normalised: lowercase, no accents or punctuation, collapsed spaces, plus normalised Eircode if known. `"12, Example Rd. Ranelagh"` and `"12 Example Rd Ranelagh"` give the same key |
| `address.line` | string | R | address as first entered, for display |
| `address.eircode` | string | O | |
| `geo` | GeoJSON Point | R | the located point (Person 4's geocode, or a user pin) |
| `geoMethod` | enum `user_pin`, `geocoder`, `eircode`, `address_match` | O | |
| `geoConfidence` | double 0-1 | O | |
| `areaId` | string | O | small area, resolved once with `$geoIntersects` |
| `parents` | object `{electoral_division, lea, county, rtb_zone}` | O | cached from `areas.parents` |
| `attributes` | object `{bedrooms, propertyType, floorAreaM2}` | O | most recently declared by a user; the **analysis** keeps the exact input it ran with |
| `origin` | enum `user_input`, `listing`, `register` | R | how the property entered the system |
| `createdAt`, `updatedAt` | date | R / O | |

**Stored vs derived**

| Stored | Why | Derived when needed | Why not stored |
|---|---|---|---|
| address, Eircode, point, geocode method | the property's identity and location | county / LEA / ED **names** | `areas` is the source of truth; ids are cached, names are looked up |
| `areaId`, `parents` ids | resolved once, reused by every query | distance to stops, planning counts, rent statistics | change with data and with the question asked; belong to an analysis |
| declared `attributes` | pre-fills a repeat analysis | comparables, scores, transport score | derived per analysis and versioned by `scoringModel` |

**Example**
```json
{ "_id": {"$oid":"6650a1f2c3b4d5e6f7a8b9c0"},
  "addressKey": "12 example rd ranelagh dublin 6|d06x123",
  "address": { "line": "12 Example Rd, Ranelagh, Dublin 6", "eircode": "D06 X123" },
  "geo": { "type": "Point", "coordinates": [-6.2551, 53.3264] },
  "geoMethod": "geocoder", "geoConfidence": 0.93,
  "areaId": "sa:268001001",
  "parents": { "electoral_division": "ed:268001", "lea": "lea:dublin-city-south-east", "county": "county:dublin-city", "rtb_zone": "rtbzone:dublin-6" },
  "attributes": { "bedrooms": 2, "propertyType": "apartment", "floorAreaM2": 68 },
  "origin": "user_input", "createdAt": {"$date":"2026-10-03T12:00:00Z"}, "updatedAt": {"$date":"2026-10-03T12:00:00Z"} }
```
**Indexes:** `{addressKey:1}` unique (get-or-create), `{geo:"2dsphere"}`, `{areaId:1}`.
**GeoJSON:** `geo`. **Query:** `db.properties.findOne({ addressKey: "12 example rd ranelagh dublin 6|d06x123" })`.

---

## 3. Rental data: observations, indexes, and keeping them apart

### The four measurements in the system

| Measurement | Collection | Discriminator | Grain | Value field | Used for statistics with |
|---|---|---|---|---|---|
| **Advertised** (asking) rent | `rental_observations` | `measure:"advertised"` | one listing at a point | `rent.amount` | other advertised rents only |
| **Registered** rent | `rental_observations` | `measure:"registered"` | one tenancy record at a point | `rent.amount` | other registered rents only |
| **Rental index** (official average) | `rental_indexes` | `measure:"index_mean"` | geography x type x bedrooms x quarter | `avgRent` | the index series only |
| **Sale price** | `property_sales` | has `salePrice`, no `rent`/`measure` | one sale | `salePrice` | never rent |

### How accidental mixing is prevented (five layers)

1. **Separate collections** for points and area averages. A `$geoNear` on `rental_observations` cannot return an index cell.
2. **Different value field names**: `rent.amount` vs `avgRent` vs `salePrice`. A pipeline written for one reads `null` from another, not a plausible number.
3. **`measure` is required** on observations and indexes, validated to an enum, and **leads every rent index** (`measure` follows `geo` in the geo index and `areaId` in the series index).
4. **The engine hard-filters** `measure` (default `advertised`) before any scoring, and reports `measure` in `data`, in `warnings` and in evidence `context`. Advertised and registered are never pooled.
5. **Validators reject** the dangerous inserts. This is tested: an observation without `measure`, with `measure:"index_mean"`, or with a yearly period; an index cell carrying a point; a sale carrying a `rent` field. All return error 121.

The RTB index appears **beside** the comparables in the engine's output (`history.rtbIndex`, with its own evidence) and is explicitly labelled an area average. It is a cross-check, never an input to the comparable statistics.

### `rental_observations`

| Field | Type | Req | Notes |
|---|---|---|---|
| `_id` | ObjectId | R | |
| `measure` | enum `advertised`, `registered` | **R** | the measurement type |
| `rent.amount` | double > 0 | R | EUR |
| `rent.period` | enum `month` | R | monthly only; convert before loading |
| `bedrooms` | int 0-5 | R | 0 = studio, 5 = 5+ |
| `propertyType` | enum `apartment`, `house`, `detached`, `semi_detached`, `terraced`, `studio`, `all`, `unknown` | R | |
| `floorAreaM2` | double > 0 | O | |
| `geo` | GeoJSON Point | R | `$geoNear` key. Observations without a location are not loaded here |
| `areaId` | string | R | small area, assigned at load (point-in-polygon) |
| `observedAt` | date | R | listing date or tenancy registration date |
| `address` | string | O | display |
| `propertyId` | ObjectId | O | link to `properties` when matched: lets repeated adverts be collapsed |
| `description` | string | O | text for the embedding |
| `embedding` | array<double> | O | Vector Search (stretch) |
| `src` | `src` | R | `recordId` is the listing id |

**Examples**

*Advertised rent* (the common case):
```json
{ "measure": "advertised", "rent": { "amount": 2250, "period": "month" },
  "bedrooms": 2, "propertyType": "apartment", "floorAreaM2": 66,
  "geo": { "type": "Point", "coordinates": [-6.25465, 53.32674] }, "areaId": "sa:268001001",
  "observedAt": {"$date":"2026-09-28T12:33:49Z"}, "address": "4 Sample Ave, Ranelagh, Dublin 6",
  "src": { "sourceId": "listings", "recordId": "L-100", "version": "2026-09", "retrievedAt": {"$date":"2026-10-01T08:00:00Z"},
           "geoMethod": "address_match", "geoConfidence": 0.9 } }
```
*Advertised, matched to a property and embedded for similarity search:*
```json
{ "measure": "advertised", "rent": { "amount": 2300, "period": "month" },
  "bedrooms": 2, "propertyType": "apartment", "floorAreaM2": 65,
  "geo": { "type": "Point", "coordinates": [-6.2566, 53.3274] }, "areaId": "sa:268001001",
  "observedAt": {"$date":"2026-09-22T09:00:00Z"}, "address": "12 Example Rd, Ranelagh, Dublin 6",
  "propertyId": {"$oid":"6650a1f2c3b4d5e6f7a8b9c0"},
  "description": "Bright two-bed with balcony near the Luas", "embedding": [0.012, -0.044, "… 1024 values …"],
  "src": { "sourceId": "listings", "recordId": "L-101", "version": "2026-09", "retrievedAt": {"$date":"2026-10-01T08:00:00Z"},
           "geoMethod": "address_match", "geoConfidence": 0.9 } }
```
*Registered rent* (only if a tenancy-level dataset is obtained; kept apart by `measure`):
```json
{ "measure": "registered", "rent": { "amount": 1980, "period": "month" },
  "bedrooms": 2, "propertyType": "apartment",
  "geo": { "type": "Point", "coordinates": [-6.2580, 53.3290] }, "areaId": "sa:268001001",
  "observedAt": {"$date":"2025-11-01T00:00:00Z"},
  "src": { "sourceId": "rtb_registered", "recordId": "RTB-2025-884211", "version": "2025Q4", "retrievedAt": {"$date":"2026-09-30T10:00:00Z"},
           "geoMethod": "centroid", "geoConfidence": 0.4 } }
```
**Indexes**
```js
{ geo: "2dsphere", measure: 1, propertyType: 1, bedrooms: 1, observedAt: -1 }          // geo_comparables: the comparable engine's $geoNear
{ areaId: 1, measure: 1, propertyType: 1, bedrooms: 1, observedAt: -1 }                // area_series: non-geo area queries
{ "src.sourceId": 1, "src.recordId": 1 }  // unique, idempotent loads
{ propertyId: 1, observedAt: -1 }          // sparse: re-listing history
```
**GeoJSON:** `geo`. **Vector Search (stretch):** `embedding`, filters `measure`, `bedrooms`, `areaId`.

### `rental_indexes`

| Field | Type | Req | Notes |
|---|---|---|---|
| `areaId` | string | R | usually an RTB zone (`rtbzone:dublin-6`) |
| `areaLevel` | string | R | `rtb_zone`, `lea`, `county`, ... |
| `propertyType` | enum (as above) | R | `all` if the cell is not split by type |
| `bedrooms` | int 0-5 | O | omit when the cell covers all sizes |
| `measure` | enum `index_mean` | R | |
| `avgRent` | double > 0 | R | the standardised average. **Not** `rent.amount`, on purpose |
| `stdError`, `sampleSize` | double / int | O | |
| `periodStart`, `periodLabel` | date, string | R | quarter start, `2026Q3` |
| `src` | `src` | R | `recordId` = cell key |

No `geo`, no `rent` (validator forbids both). **Example**
```json
{ "areaId": "rtbzone:dublin-6", "areaLevel": "rtb_zone", "propertyType": "apartment", "bedrooms": 2,
  "measure": "index_mean", "avgRent": 2207, "stdError": 40, "sampleSize": 312,
  "periodStart": {"$date":"2026-07-01T00:00:00Z"}, "periodLabel": "2026Q3",
  "src": { "sourceId": "rtb_rent_index", "recordId": "rtbzone:dublin-6|apartment|2|2026Q3", "version": "2026Q3", "retrievedAt": {"$date":"2026-09-30T10:00:00Z"} } }
```
**Indexes:** `{areaId:1, measure:1, propertyType:1, bedrooms:1, periodStart:-1}` **unique** (latest cell, history, upsert key); `{areaLevel:1, propertyType:1, bedrooms:1, periodStart:-1}` (rank areas in one period).
**GeoJSON:** none (location comes from `areas`). **Time-series:** considered, not used.

---

## 4. `transport_stops`

**Purpose:** "How many stops within 500 m?", "Where is the nearest stop?", "What modes serve the area?"

| Field | Type | Req | Notes |
|---|---|---|---|
| `_id` | string | R | `${agency}:${stop_id}` |
| `stopId`, `name` | string | R | |
| `geo` | GeoJSON Point | R | |
| `modes` | array<enum `bus`, `luas`, `dart`, `rail`, `commuter_rail`, `other`> | R | |
| `routes` | array<{routeId, shortName, longName?, mode, agency, headsigns?}> | R | may be empty |
| `service` | `{weekdayPeakTripsPerHour, weekdayOffPeakTripsPerHour, weekendTripsPerHour, firstDeparture, lastDeparture}` | O | pre-aggregated by Person 4 from `stop_times` |
| `wheelchairAccessible` | bool | O | |
| `areaId` | string | R | small area, assigned at load |
| `src` | `src` | R | |

**Routes: embedded, not a separate collection.** The app only asks "what serves here", never "list every route". A stop has 1-20 routes (a few hundred bytes), so embedding makes the 500 m query a single indexed read with no `$lookup`. If route-level analysis is ever needed, `$unwind: "$routes"` already supports "stops per route". The cost is duplication of route names across stops, which is harmless.

**Example**
```json
{ "_id": "nta:8220DB000002", "stopId": "8220DB000002", "name": "Ranelagh, Luas",
  "geo": { "type": "Point", "coordinates": [-6.2524, 53.3266] }, "modes": ["luas"],
  "routes": [ { "routeId": "GREEN", "shortName": "Green", "mode": "luas", "agency": "Luas", "headsigns": ["Brides Glen", "Broombridge"] } ],
  "service": { "weekdayPeakTripsPerHour": 16, "weekdayOffPeakTripsPerHour": 8, "weekendTripsPerHour": 8, "firstDeparture": "05:30", "lastDeparture": "00:30" },
  "wheelchairAccessible": true, "areaId": "sa:268001001",
  "src": { "sourceId": "nta_gtfs", "recordId": "8220DB000002", "version": "gtfs-2026-09-30", "retrievedAt": {"$date":"2026-09-30T10:00:00Z"} } }
```
**Indexes:** `{geo:"2dsphere"}`, `{modes:1, geo:"2dsphere"}` (nearest stop of a given mode), `{areaId:1}`, `{"src.recordId":1}` unique.
**GeoJSON:** `geo`.
**Queries**
```js
// within 500 m, with distance, nearest first
db.transport_stops.aggregate([{ $geoNear: { near: pt, key: "geo", distanceField: "distM", maxDistance: 500, spherical: true } }])
// nearest stop
db.transport_stops.find({ geo: { $near: { $geometry: pt, $maxDistance: 5000 } } }).limit(1)
// modes serving the area
db.transport_stops.distinct("modes", { geo: { $geoWithin: { $centerSphere: [pt.coordinates, 500 / 6378100] } } })
```

---

## 5. `areas` (census areas and every other geography)

**Purpose:** associate a property with its geography, and carry census statistics. The one place polygons live.

| Field | Type | Req | Notes |
|---|---|---|---|
| `_id` | string | R | `${level}:${code}`, e.g. `sa:268001001` |
| `level` | enum `small_area`, `electoral_division`, `lea`, `county`, `rtb_zone` | R | |
| `code`, `name` | string | R | official code and name |
| `geometry` | GeoJSON Polygon **or MultiPolygon** | R | MultiPolygon for areas with islands or separate parts |
| `centroid` | GeoJSON Point | R | for "nearest zone" queries |
| `areaKm2` | double | R | density calculations |
| `parents` | `{electoral_division?, lea?, county?, rtb_zone?}` of area ids | R for `small_area` | `rtb_zone` is the key for rent indexes; Person 4 provides the mapping |
| `census` | object | O (small areas) | embedded, see below |
| `featureVector` | array<double> | O | stretch: for similar-area search |
| `src` | `src` | R | |

`census`: `year`, `population`, `households`, `avgHouseholdSize`, `dwellings`, `renterHouseholds`, `ownerOccupiedHouseholds`, `renterPct`, `vacantDwellings`, `ageBands {0_14, 15_24, 25_34, 35_64, 65_plus}`.

**Why census is embedded:** it is 1:1 with a small area, always read with it, and about 300 bytes. A separate collection would add a join to the most common lookup.
**Geometry types:** `Polygon` for a single ring (the usual small area); `MultiPolygon` when an area is split (islands, coastal LEAs). `$geoIntersects` handles both.

**Example**
```json
{ "_id": "sa:268001001", "level": "small_area", "code": "268001001", "name": "Ranelagh A",
  "geometry": { "type": "Polygon", "coordinates": [[[-6.2581,53.3244],[-6.2521,53.3244],[-6.2521,53.3284],[-6.2581,53.3284],[-6.2581,53.3244]]] },
  "centroid": { "type": "Point", "coordinates": [-6.2551, 53.3264] }, "areaKm2": 0.3,
  "parents": { "electoral_division": "ed:268001", "lea": "lea:dublin-city-south-east", "county": "county:dublin-city", "rtb_zone": "rtbzone:dublin-6" },
  "census": { "year": 2022, "population": 412, "households": 171, "avgHouseholdSize": 2.4, "dwellings": 188,
              "renterHouseholds": 99, "renterPct": 57.9, "vacantDwellings": 9,
              "ageBands": { "0_14": 48, "15_24": 55, "25_34": 129, "35_64": 140, "65_plus": 40 } },
  "src": { "sourceId": "cso_saps_2022", "recordId": "268001001", "version": "2022", "retrievedAt": {"$date":"2026-09-30T10:00:00Z"} } }
```
**Indexes:** `{geometry:"2dsphere", level:1}`, `{centroid:"2dsphere", level:1}`, `{level:1, code:1}` unique, `{"parents.lea":1}`, `{"parents.electoral_division":1}`. The last two serve the comparable engine's geographic-area factor.
**Containment query**
```js
db.areas.findOne({ level: "small_area", geometry: { $geoIntersects: { $geometry: pt } } },
                 { name: 1, parents: 1, census: 1 })
```

---

## 6. `planning_applications`

| Field | Type | Req | Notes |
|---|---|---|---|
| `_id` | ObjectId | R | |
| `reference` | string | R | application number |
| `authority` | string | R | local authority (planning authority) |
| `geo` | GeoJSON Point | R | applications without a location are not loaded |
| `address` | string | O | |
| `proposal` | string | R | development description |
| `applicationDate` | date | R | |
| `status` | enum `pending`, `granted`, `refused`, `withdrawn`, `invalid`, `appealed`, `unknown` | R | normalised |
| `decision` | `{outcome, date}` | O | absent while pending |
| `development` | `{type, residentialUnits?, floorAreaM2?}` | O | units only when stated in the data, never inferred |
| `areaId` | string | R | |
| `src` | `src` | R | |

**Example**
```json
{ "reference": "3456/24", "authority": "Dublin City Council",
  "geo": { "type": "Point", "coordinates": [-6.2535, 53.328] },
  "address": "Site at Cowper Rd, Ranelagh", "proposal": "Construction of 42 apartments over basement car park",
  "applicationDate": {"$date":"2025-06-10T00:00:00Z"}, "status": "granted",
  "decision": { "outcome": "Grant Permission", "date": {"$date":"2025-11-02T00:00:00Z"} },
  "development": { "type": "residential", "residentialUnits": 42 }, "areaId": "sa:268001001",
  "src": { "sourceId": "planning_national", "recordId": "DCC|3456/24", "version": "2026-09", "retrievedAt": {"$date":"2026-09-30T10:00:00Z"} } }
```
**Indexes:** `{geo:"2dsphere", applicationDate:-1, status:1}`, `{"src.recordId":1}` unique, `{areaId:1, applicationDate:-1}`.
**GeoJSON:** `geo`.
**Query:** `db.planning_applications.aggregate([{ $geoNear: { near: pt, key: "geo", distanceField: "distM", maxDistance: 1000, spherical: true, query: { applicationDate: { $gte: since } } } }])`

---

## 7. `property_sales`

**Rule: a sale price is never a rent.** Enforced by structure and by the validator.

| Field | Type | Req | Notes |
|---|---|---|---|
| `address` | string | R | |
| `eircode` | string | O | |
| `salePrice` | double > 0 | R | **named `salePrice`, never `rent`** |
| `saleDate` | date | R | |
| `fullMarketPrice` | bool | R | PPR "not full market price" flag, inverted |
| `vatExclusive`, `newDwelling` | bool | O | |
| `propertyType` | enum (as above) | O | |
| `geo` | GeoJSON Point | O | omit when geocoding failed (excluded from geo queries) |
| `areaId` | string | O | requires `geo` |
| `src` | `src` | R | |

The validator forbids `rent`, `measure` and `avgRent` on this collection.

**Example**
```json
{ "address": "1 Sale St, Ranelagh, Dublin 6", "salePrice": 545000, "saleDate": {"$date":"2026-08-14T00:00:00Z"},
  "fullMarketPrice": true, "newDwelling": false, "propertyType": "terraced",
  "geo": { "type": "Point", "coordinates": [-6.2548, 53.3266] }, "areaId": "sa:268001001",
  "src": { "sourceId": "ppr", "recordId": "ppr-2026-081423", "version": "2026-09", "retrievedAt": {"$date":"2026-09-30T10:00:00Z"},
           "geoMethod": "address_match", "geoConfidence": 0.88 } }
```
**Indexes:** `{geo:"2dsphere", saleDate:-1, fullMarketPrice:1}`, `{areaId:1, saleDate:-1}`, `{"src.recordId":1}` unique.
**GeoJSON:** `geo`.

**How RentCheck may use sales without treating them as rent**

| Allowed | How it is labelled |
|---|---|
| Local price level and price trend (median sale price, by year) | evidence type `recentSales`, unit `EUR`, warning *"Sale prices are not rents"* |
| Area character (owner-occupier market, price band) | context only, in the neighbourhood section |
| Gross-yield sanity check (stretch) | a separate evidence item, explicitly "indicative", never fed into comparable statistics |

Not allowed: sale prices in `rental_observations`, in any rent median, or compared directly with a monthly rent. The comparable engine reads only `rental_observations`.

---

## 8. `area_stats` (vacancy, disputes, terminations)

| Field | Type | Req | Notes |
|---|---|---|---|
| `_id` | ObjectId | R | |
| `areaId` | string | R | any level |
| `areaLevel` | enum (as `areas.level`) | **R** | the geographic resolution of the statistic. Vacancy may be LEA or county even when rents are small-area |
| `stat` | enum `vacancy`, `rtb_disputes`, `rtb_terminations` | R | |
| `dimension` | string | O | sub-series (dispute category, termination ground) |
| `periodStart`, `periodEnd`, `periodLabel` | date, date, string | R | |
| `values` | object | R | by `stat`: vacancy `{vacantDwellings, totalDwellings, vacancyRatePct}`; terminations `{notices, noticesPer1000Tenancies?}`; disputes `{cases, casesPer1000Tenancies?, outcomes?}` |
| `src` | `src` | R | |

Because the geography is recorded, a tool that wants vacancy picks the **finest level that has data** (small area, ED, LEA, county) and reports `areaLevel` and a warning, so a county figure is never presented as a street-level one.

**Example**
```json
{ "areaId": "lea:dublin-city-south-east", "areaLevel": "lea", "stat": "vacancy",
  "periodStart": {"$date":"2022-04-01T00:00:00Z"}, "periodEnd": {"$date":"2022-04-01T00:00:00Z"}, "periodLabel": "2022",
  "values": { "vacantDwellings": 900, "totalDwellings": 29000, "vacancyRatePct": 3.1 },
  "src": { "sourceId": "cso_vacancy", "recordId": "lea:dublin-city-south-east|2022", "version": "2022", "retrievedAt": {"$date":"2026-09-30T10:00:00Z"} } }
```
**Indexes:** `{areaId:1, stat:1, dimension:1, periodStart:-1}` unique, `{stat:1, areaLevel:1, periodStart:-1}`.
**GeoJSON:** none.

---

## 9. `sources`

One document per dataset **release**. Referenced by `src.sourceId` on every record and by `evidence[].sourceIds`.

| Field | Type | Req | Notes |
|---|---|---|---|
| `_id` | string | R | slug: `rtb_rent_index`, `cso_saps_2022`, `nta_gtfs`, `planning_national`, `ppr`, `cso_vacancy`, `rtb_terminations`, `listings` |
| `title` | string | R | dataset name |
| `organisation` | string | R | publisher |
| `url` | string | R | landing page |
| `downloadUrl` | string | O | |
| `licence` | string | R | |
| `version` | string | R | currently loaded release |
| `publishedAt` | date | O | publisher's release date |
| `retrievedAt` | date | R | |
| `recordIdField` | string | R | which source column becomes `src.recordId` |
| `geographyLevel` | string | O | `point`, `small_area`, `lea`, `rtb_zone`, ... |
| `coverage` | `{from, to}` dates | R for rent and stats sources | `to` drives the freshness check |
| `collections` | array<string> | O | collections this source feeds |
| `description`, `notes` | string | O | caveats, e.g. "area averages, not listings" |

**Example**
```json
{ "_id": "rtb_rent_index", "title": "RTB Rent Index", "organisation": "Residential Tenancies Board / ESRI",
  "url": "https://example.org/rtb_rent_index", "licence": "CC-BY-4.0", "version": "2026Q3",
  "publishedAt": {"$date":"2026-09-15T00:00:00Z"}, "retrievedAt": {"$date":"2026-09-30T10:00:00Z"},
  "recordIdField": "cell_key", "geographyLevel": "rtb_zone", "collections": ["rental_indexes"],
  "coverage": { "from": {"$date":"2007-01-01T00:00:00Z"}, "to": {"$date":"2026-06-30T00:00:00Z"} },
  "description": "Standardised average rents by area, property type and bedrooms.", "notes": "Area-level averages. Not individual listings." }
```
(URL illustrative; Person 4 supplies the real one.) **Indexes:** `_id` only. **How others reference it:** by `_id` string, e.g. `src.sourceId: "rtb_rent_index"`; the UI resolves citations with `$lookup`.

---

## 10. Evidence

Evidence items are **embedded in `analyses.evidence[]`**. Each has this shape:

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | string | R | `ev1`, `ev2`, ... unique within the analysis. This is what the AI cites |
| `evidenceType` | string | R | the producing tool, e.g. `rentalComparables`, `nearbyTransport` |
| `claim` | string | R | the statement the number supports |
| `value` | number \| string \| bool | R | the exact result (what `verifyClaims` checks) |
| `unit` | string | O | `EUR/month`, `m`, `count`, `pct`, `percentile`, `date`, ... |
| `queryParameters` | object | R | the exact parameters the tool was called with. Re-running the tool with these reproduces the result on unchanged data |
| `context` | object | O | method details: `model` (scoring version), `n`, `radiusM`, `windowDays`, `measure`, `formula`, ... |
| `geographicScope` | `{level, areaId?, radiusM?}` | O | `small_area`, `lea`, `rtb_zone`, `point` |
| `observationPeriod` | `{from?, to?, period?, windowDays?}` | O | the data period the result covers |
| `refs` | array<{collection, docId}> | R | the underlying records (`sourceRecordIds`) |
| `sourceIds` | array<string> | R | keys into `sources` |
| `generatedAt` | date | R | |

**Example**
```json
{ "id": "ev9", "evidenceType": "rentalComparables", "tool": "rentalComparables",
  "claim": "Median comparable asking rent", "value": 2262, "unit": "EUR/month",
  "queryParameters": { "latitude": 53.3264, "longitude": -6.2551, "bedrooms": 2, "propertyType": "apartment",
                       "monthlyRent": 2350, "floorArea": 68, "analysisDate": "2026-10-03T12:00:00.000Z" },
  "context": { "model": "comp-v1", "measure": "advertised", "n": 10, "radiusM": 1000, "windowDays": 90, "minScore": 50 },
  "geographicScope": { "level": "point", "radiusM": 1000 },
  "observationPeriod": { "windowDays": 90 },
  "refs": [ { "collection": "rental_observations", "docId": "6ac0f62f3dc3fff0c559d6f7" }, "… one per comparable …" ],
  "sourceIds": ["listings"], "generatedAt": {"$date":"2026-10-03T12:00:04Z"} }
```

### Tracing "37 comparable rental observations were found"
1. The report text cites `ev7`. `analyses.evidence` holds `ev7` with `value: 37`.
2. `ev7.queryParameters` + `context.model` + `analyses.dataVersions` identify exactly how it was computed.
3. `ev7.refs` lists the 37 `rental_observations` `_id`s. Each carries `src.sourceId`, `src.recordId` (the original listing id), `src.version` and `retrievedAt`.
4. `ev7.sourceIds` resolve to `sources` for organisation, URL and licence.
5. `verifyClaims` confirms the sentence's number equals `ev7.value`; re-running the tool with `queryParameters` reproduces it while the data is unchanged.

---

## 11. `analyses`

| Field | Type | Req | Notes |
|---|---|---|---|
| `_id` | ObjectId | R | `analysisId` |
| `propertyId` | ObjectId | R | to `properties` |
| `input` | object | R | the user's input **verbatim**: `{address, latitude, longitude, monthlyRent, bedrooms, propertyType, floorArea, analysisDate}` |
| `inputHash` | string | R | day-granular hash for the cache |
| `status` | enum `running`, `complete`, `failed` | R | |
| `resolved` | `{areaId, parents}` | O | |
| `results` | object | R | one key per tool, each the tool's `data` |
| `evidence` | array<evidence> | R | section 10 |
| `warnings` | array<string> | O | union of tool warnings |
| `dataVersions` | object `{sourceId: version}` | O | dataset versions used |
| `report` | object | O | opaque, owned by Person 2 |
| `createdAt`, `completedAt`, `durationMs` | date, date, int | R / O | |
| `error` | string | O | when `failed` |

**Example (abridged)**
```json
{ "_id": {"$oid":"6650b2a3d4e5f6a7b8c9d0e1"}, "propertyId": {"$oid":"6650a1f2c3b4d5e6f7a8b9c0"},
  "input": { "address": "12 Example Rd, Ranelagh, Dublin 6", "latitude": 53.3264, "longitude": -6.2551, "monthlyRent": 2350,
             "bedrooms": 2, "propertyType": "apartment", "floorArea": 68, "analysisDate": "2026-10-03T12:00:00Z" },
  "inputHash": "9c1f2a7b3d4e5f60", "status": "complete",
  "resolved": { "areaId": "sa:268001001", "parents": { "rtb_zone": "rtbzone:dublin-6", "lea": "lea:dublin-city-south-east" } },
  "results": { "rentalComparables": { "status": "sufficient", "comparableCount": 10, "medianRent": 2262, "percentageDifference": 3.9, "…": "…" },
               "nearbyTransport": { "total": { "stops": 5, "nearestM": 181, "score": 82 } } },
  "evidence": [ { "id": "ev1", "evidenceType": "rentalComparables", "claim": "Comparable listings used", "value": 10, "…": "…" } ],
  "warnings": ["Comparables are advertised (asking) rents, not agreed or registered rents. Distances are straight-line."],
  "dataVersions": { "listings": "2026-09", "rtb_rent_index": "2026Q3", "nta_gtfs": "gtfs-2026-09-30" },
  "createdAt": {"$date":"2026-10-03T12:00:00Z"}, "completedAt": {"$date":"2026-10-03T12:00:04Z"}, "durationMs": 4120 }
```

| Store | Do **not** store |
|---|---|
| the exact input, so the analysis is reproducible | raw dataset copies or polygons (reference by id) |
| each tool's computed `data` (comparables list included, so a report does not change when listings later expire) | AI prompts, intermediate reasoning or tool-call transcripts (Person 2's logs) |
| evidence with `queryParameters`, `refs`, `sourceIds` | personal data beyond the address the user typed |
| dataset versions and scoring model version | derived figures that can be recomputed cheaply and are not cited (full distance matrices) |
| warnings | |

**Indexes:** `{propertyId:1, createdAt:-1}` (history), `{inputHash:1, createdAt:-1}` (cache). Optional 30-day TTL on `createdAt` for demo databases.

---

## 12. Indexes

The complete idempotent script is in section 15.B. Index purposes:

| Collection | Index | Serves |
|---|---|---|
| `areas` | `{geometry:"2dsphere", level:1}` | point-in-polygon (`$geoIntersects`) |
| `areas` | `{centroid:"2dsphere", level:1}` | nearest RTB zones (`$geoNear`) |
| `areas` | `{level:1, code:1}` unique | idempotent load |
| `areas` | `{"parents.lea":1}`, `{"parents.electoral_division":1}` | **comparable engine**: area factor (which small areas share the property's LEA / ED) |
| `rental_observations` | `{geo:"2dsphere", measure:1, propertyType:1, bedrooms:1, observedAt:-1}` | **comparable engine**: the `$geoNear` with all hard filters inside the index scan (`GEO_NEAR_2DSPHERE`) |
| `rental_observations` | `{areaId:1, measure:1, propertyType:1, bedrooms:1, observedAt:-1}` | non-geo area queries, monthly history |
| `rental_observations` | `{"src.sourceId":1, "src.recordId":1}` unique | idempotent loads |
| `rental_observations` | `{propertyId:1, observedAt:-1}` sparse | de-duplicating re-listings |
| `rental_indexes` | `{areaId:1, measure:1, propertyType:1, bedrooms:1, periodStart:-1}` unique | **comparable engine** cross-check (latest cell, trend); idempotent load |
| `rental_indexes` | `{areaLevel:1, propertyType:1, bedrooms:1, periodStart:-1}` | ranking areas in one period |
| `transport_stops` | `{geo:"2dsphere"}`, `{modes:1, geo:"2dsphere"}`, `{areaId:1}`, `{"src.recordId":1}` unique | 500 m, nearest, per-mode nearest, neighbourhood profile |
| `planning_applications` | `{geo:"2dsphere", applicationDate:-1, status:1}` | 1 km with a date filter |
| `property_sales` | `{geo:"2dsphere", saleDate:-1, fullMarketPrice:1}`, `{areaId:1, saleDate:-1}` | nearby sales; area profile |
| `area_stats` | `{areaId:1, stat:1, dimension:1, periodStart:-1}` unique, `{stat:1, areaLevel:1, periodStart:-1}` | latest vacancy; ranking LEAs |
| `properties` | `{addressKey:1}` unique, `{geo:"2dsphere"}`, `{areaId:1}` | get-or-create; maps |
| `analyses` | `{propertyId:1, createdAt:-1}`, `{inputHash:1, createdAt:-1}` | history; cache |

**Index choices for the comparable engine:** the 2dsphere key comes first because `$geoNear` requires it; `measure` is the first filter so advertised and registered rents are separated *inside the index*; `propertyType` and `bedrooms` are equality filters; `observedAt` last supports the date range. All hard filters therefore run inside the index scan rather than after fetching documents. Verified with `explain`: the plan is `GEO_NEAR_2DSPHERE` using `geo_comparables`.

---

## 13. Final relationship model

```
sources <------------------ src.sourceId -------------- (every loaded document)
   ^
   |  evidence[].sourceIds
analyses -- propertyId --> properties -- areaId, parents.* --> areas
   |                          ^
   | evidence[].refs          | propertyId (optional)
   v                          |
 any record <---------- rental_observations -- areaId --> areas
                        rental_indexes ------- areaId --> areas (rtb_zone)
                        transport_stops ------ areaId --> areas
                        planning_applications- areaId --> areas
                        property_sales ------- areaId --> areas
                        area_stats ----------- areaId --> areas (any level)
areas.parents.* --> areas     (small_area -> electoral_division, lea, county, rtb_zone)
```

**What differs from the naive structure.** `properties` does **not** point at its observations, stops or planning applications; those relationships are *spatial and computed on demand* (`$geoNear` around `properties.geo`), not stored. The only stored link from a property to data is `rental_observations.propertyId` (optional, for re-listings). The common join key is `areaId`, and the only spatial join is **point to `areas`**.

---

## 14. Embedding vs referencing

| Relationship | Choice | Performance | Document size | Query complexity | Hackathon cost |
|---|---|---|---|---|---|
| census on a small area | **embed** | no join on the most common lookup | ~300 B | none | trivial: Person 4 writes it inside the area document |
| routes on a stop | **embed** | 500 m query is one indexed read | <2 KB | none | trivial |
| `src` on each record | **embed** (small) + **reference** sources | provenance is local | ~150 B | `$lookup` only when citing | one helper |
| observation to area | **reference** (`areaId`) | indexed equality | 1 field | none | one point-in-polygon at load |
| observation to property | **reference**, optional | only needed for de-duplication | 12 B | one `$group` | skip for the demo |
| property geography ids | **duplicate** `areaId` + `parents` | saves a polygon query per analysis | ~150 B | none | `getOrCreateProperty` does it |
| index cell to area | **reference** | indexed | 1 field | none | needs the RTB-zone mapping from Person 4 |
| evidence to analysis | **embed** | one read for a whole report; atomic `$push` | ~0.5 KB x 20-80 items | none | already built |
| evidence to records | **reference** (`refs`) | do not copy records | 40 ids x ~80 B | resolve on demand | built |
| comparables list on an analysis | **embed a snapshot** | report stable after listings expire | <40 rows | none | built |
| `area_stats` to polygons | **reference** | keeps 100 KB polygons out of stat reads | n/a | one `$lookup` if needed | trivial |
| sources | **reference** | one copy of each URL | tiny | `$lookup` when citing | trivial |

Rule used: **embed** what is read together, bounded and owned by one parent; **reference** what is shared, large, or has its own lifecycle; **duplicate** only small immutable ids that save a spatial query.

---

## 15. Final schema summary

| Collection | Purpose | Main fields | Important indexes | GeoJSON? | Time-series? | Vector Search? |
|---|---|---|---|---|---|---|
| `sources` | dataset registry | `_id`, title, organisation, url, licence, version, coverage | `_id` | no | no | no |
| `areas` | polygons for all levels + census | level, code, `geometry`, `centroid`, `parents`, `census` | `{geometry 2dsphere, level}`, `{centroid 2dsphere, level}`, `{level, code}` unique | **Polygon / MultiPolygon, Point** | no | stretch: `featureVector` |
| `properties` | one doc per address | `addressKey`, `address`, `geo`, `areaId`, `parents`, `attributes` | `addressKey` unique, `geo` 2dsphere | **Point** | no | no |
| `rental_observations` | advertised / registered rents | `measure`, `rent`, `bedrooms`, `propertyType`, `floorAreaM2`, `geo`, `areaId`, `observedAt` | `{geo 2dsphere, measure, propertyType, bedrooms, observedAt}` | **Point** | no | stretch: `embedding` |
| `rental_indexes` | official area averages | `areaId`, `measure`, `avgRent`, `propertyType`, `bedrooms`, `periodStart` | `{areaId, measure, propertyType, bedrooms, periodStart}` unique | no | not used (small) | no |
| `transport_stops` | stops, routes, frequency | `geo`, `modes`, `routes`, `service`, `areaId` | `geo` 2dsphere, `{modes, geo}` | **Point** | no | no |
| `planning_applications` | applications | `reference`, `geo`, `applicationDate`, `status`, `proposal`, `development` | `{geo 2dsphere, applicationDate, status}` | **Point** | no | no |
| `property_sales` | PPR sale prices | `salePrice`, `saleDate`, `fullMarketPrice`, `geo` | `{geo 2dsphere, saleDate, fullMarketPrice}` | **Point** | no | no |
| `area_stats` | vacancy, disputes, terminations | `areaId`, `areaLevel`, `stat`, `periodStart`, `values` | `{areaId, stat, dimension, periodStart}` unique | no | no | no |
| `analyses` | report record + evidence | `propertyId`, `input`, `status`, `results`, `evidence[]` | `{propertyId, createdAt}`, `{inputHash, createdAt}` | no (property holds the point) | no | no |

### A. Complete example document for every collection
Full examples are in: `sources` (section 9), `areas` (5), `properties` (2), `rental_observations` (3: advertised, advertised with embedding, registered), `rental_indexes` (3), `transport_stops` (4), `planning_applications` (6), `property_sales` (7), `area_stats` (8), `analyses` and embedded evidence (10, 11). Runnable seed data for all of them is generated by `db/scripts/seed.js`, and the validators accept it.

### B. Complete index creation script
Source: `db/scripts/createIndexes.js` (also applies the validators from `db/schemas/validators.js`). Run: `node db/scripts/createIndexes.js` (`MONGODB_URI`, `MONGODB_DB` override defaults).

```js
// Idempotent. Safe to run on every deploy.   node db/scripts/createIndexes.js
// Database: rentcheck. See docs/mongodb-schema.md for what each index serves.
export const DB_NAME = "rentcheck";

export const INDEXES = {
  sources: [],   // _id is the slug; the collection is tiny

  areas: [
    [{ geometry: "2dsphere", level: 1 }, { name: "geometry_level" }],                 // point-in-polygon ($geoIntersects)
    [{ centroid: "2dsphere", level: 1 }, { name: "centroid_level" }],                 // nearest zones ($geoNear)
    [{ level: 1, code: 1 }, { unique: true, name: "level_code" }],
    [{ "parents.lea": 1 }, { name: "parents_lea" }],                                  // comparable engine: same-LEA small areas
    [{ "parents.electoral_division": 1 }, { name: "parents_ed" }],                    // comparable engine: same-ED small areas
  ],

  // Advertised / registered rents at a point. The comparable engine's main collection.
  rental_observations: [
    [{ geo: "2dsphere", measure: 1, propertyType: 1, bedrooms: 1, observedAt: -1 }, { name: "geo_comparables" }], // $geoNear + query
    [{ areaId: 1, measure: 1, propertyType: 1, bedrooms: 1, observedAt: -1 }, { name: "area_series" }],            // non-geo area queries
    [{ "src.sourceId": 1, "src.recordId": 1 }, { unique: true, name: "source_record" }],                           // idempotent loads
    [{ propertyId: 1, observedAt: -1 }, { sparse: true, name: "property_history" }],                               // re-listing history
  ],

  // Official area-level rent index cells.
  rental_indexes: [
    [{ areaId: 1, measure: 1, propertyType: 1, bedrooms: 1, periodStart: -1 }, { unique: true, name: "series" }],  // latest cell + history
    [{ areaLevel: 1, propertyType: 1, bedrooms: 1, periodStart: -1 }, { name: "level_period" }],                   // rank areas in one period
  ],

  transport_stops: [
    [{ geo: "2dsphere" }, { name: "geo" }],
    [{ modes: 1, geo: "2dsphere" }, { name: "modes_geo" }],
    [{ areaId: 1 }, { name: "areaId" }],
    [{ "src.recordId": 1 }, { unique: true, name: "recordId" }],
  ],

  planning_applications: [
    [{ geo: "2dsphere", applicationDate: -1, status: 1 }, { name: "geo_date_status" }],
    [{ "src.recordId": 1 }, { unique: true, name: "recordId" }],
    [{ areaId: 1, applicationDate: -1 }, { name: "area_date" }],
  ],

  property_sales: [
    [{ geo: "2dsphere", saleDate: -1, fullMarketPrice: 1 }, { name: "geo_date" }],
    [{ areaId: 1, saleDate: -1 }, { name: "area_date" }],
    [{ "src.recordId": 1 }, { unique: true, name: "recordId" }],
  ],

  area_stats: [
    [{ areaId: 1, stat: 1, dimension: 1, periodStart: -1 }, { unique: true, name: "area_stat_period" }],
    [{ stat: 1, areaLevel: 1, periodStart: -1 }, { name: "stat_level_period" }],
  ],

  properties: [
    [{ addressKey: 1 }, { unique: true, name: "addressKey" }],       // get-or-create
    [{ geo: "2dsphere" }, { name: "geo" }],
    [{ areaId: 1 }, { name: "areaId" }],
  ],

  analyses: [
    [{ propertyId: 1, createdAt: -1 }, { name: "property_created" }],
    [{ inputHash: 1, createdAt: -1 }, { name: "input_created" }],    // cache lookup
    // Optional 30-day expiry for demo databases; remove if reports must be kept:
    // [{ createdAt: 1 }, { expireAfterSeconds: 2592000, name: "ttl" }],
  ],
};

export async function createIndexes(db) {
  for (const [coll, specs] of Object.entries(INDEXES)) {
    for (const [keys, opts] of specs) await db.collection(coll).createIndex(keys, opts);
  }
}
```

### C. Recommended database name
`rentcheck`

### D. Recommended collection names
`sources`, `areas`, `properties`, `rental_observations`, `rental_indexes`, `transport_stops`, `planning_applications`, `property_sales`, `area_stats`, `analyses`. Plural snake_case, one noun each; `rental_observations` vs `rental_indexes` are named for what they are so that the wrong one cannot be picked by accident.

### E. Must-have (8)
`sources`, `areas`, `properties`, `rental_observations`, `rental_indexes`, `transport_stops`, `planning_applications`, `analyses`. These run the full comparable engine, location, transport and planning, and traceable evidence.

### F. Should-have / optional (2) and stretch
- **Should:** `property_sales` (price context, Op 9), `area_stats` (vacancy and RTB risk, Ops 10-11).
- **Stretch (no new collections):** `rental_observations.embedding` and `areas.featureVector` with Atlas Vector Search; Atlas Search autocomplete on addresses; a standalone `evidence` collection if reports grow beyond a few hundred items.

### G. Minimum for the hackathon
**Eight** collections are what the code expects. The true floor is **seven**: if `properties` is dropped, store the address and geography directly in `analyses.input` and relax the `analyses` validator, losing de-duplication and re-listing links. Below that, the comparable engine cannot run (`areas`, `rental_observations`) and nothing can be traced (`sources`, `analyses`).

A demo that shows MongoDB doing real work needs only: `areas`, `rental_observations`, `rental_indexes`, `transport_stops`, `planning_applications`, `analyses`, `sources`, and `properties`.

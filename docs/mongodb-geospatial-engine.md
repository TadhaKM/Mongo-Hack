# RentCheck AI: MongoDB Geospatial Engine

> **Schema v2 (current): see [mongodb-schema.md](mongodb-schema.md).** The old `rents` collection was split into `rental_observations` (individual advertised or registered rents; `measure` is a required top-level field) and `rental_indexes` (official area averages; value field `avgRent`, period field `periodStart`). The code in `db/` is authoritative.


**Boundary:** Person 4 geocodes an address to `lng, lat`. From that point on MongoDB does all geographic work. Person 2's agents call tools and get structured evidence. Nothing in this layer needs an LLM.

**Status:** every query below is implemented in `db/tools/geo.js` and `db/tools/rent.js` and was run against a real `mongod` 7.0.14 with synthetic seed data (`npm run db:test`: 22 checks pass, including `explain` checks that each geo query plans with the 2dsphere index).

---

## 1. GeoJSON and operator primer

### Geometry types used

| Type | Shape | Where | Example |
|---|---|---|---|
| **Point** | one position | property, stops, planning, sales, listings, polygon centroids | `{type:"Point", coordinates:[-6.2551, 53.3264]}` |
| **Polygon** | one outer ring (+ optional holes) | a small area, ED or LEA that is a single piece | `{type:"Polygon", coordinates:[[[w,s],[e,s],[e,n],[w,n],[w,s]]]}` |
| **MultiPolygon** | several polygons in one document | an area with islands or disjoint parts (counties with islands, LEAs split by water) | `{type:"MultiPolygon", coordinates:[ [[ring]], [[ring]] ]}` |

Rules that cause 90% of geo bugs:
1. **Order is `[longitude, latitude]`.** Dublin is `[-6.26, 53.35]`, not `[53.35, -6.26]`. `point()` in `db/lib/geo.js` rejects anything outside Ireland's bounding box so swapped values fail loudly instead of returning nothing.
2. **Rings must close:** the first and last position are identical.
3. **Outer ring is counter-clockwise, holes clockwise** (RFC 7946). MongoDB tolerates winding for small polygons, but loaders should normalise it.
4. Coordinates are WGS84 (EPSG:4326). Irish Transverse Mercator (ITM) data from OSi/CSO must be reprojected by Person 4 before loading.
5. Distances in GeoJSON queries are **metres**; legacy `[x,y]` pairs use radians. We only use GeoJSON.

### The 2dsphere index

`createIndex({ geo: "2dsphere" })` indexes GeoJSON on a sphere, so distance and containment are great-circle correct (not planar degrees). Without it `$geoNear` and `$near` **fail**; `$geoWithin` and `$geoIntersects` still run but scan the whole collection. Documents that lack the field are simply not in the index (so listings with `geo` and index cells without share `rents`).

A **compound** 2dsphere index puts ordinary fields beside the geo field, e.g. `{geo:"2dsphere", measure:1, propertyType:1, bedrooms:1, observedAt:-1}`. The planner then applies those equality/range filters inside the index scan instead of fetching and discarding documents. Put the fields that your `query` filters on **after** the geo key.

### The four operators

| Operator | Question it answers | Sorted? | Returns distance? | Where it can run | Use here |
|---|---|---|---|---|---|
| **`$geoNear`** (aggregation stage) | "Everything within R metres, nearest first, with its distance" | yes, nearest first | **yes** (`distanceField`) | **must be the first stage** of an aggregation | Transport, planning, sales, listings, nearest zone centroid |
| **`$near`** (query operator) | Same, in a plain `find` | yes | no | `find` only (not `$match`, `$facet` or `countDocuments`) | Quick nearest-1 lookups without a pipeline |
| **`$geoWithin`** | "Is this document inside this shape?" (`$geometry` polygon, `$centerSphere`, `$box`) | no | no | `find`, `$match`, `countDocuments`, `$facet` | Counting inside a radius; listings inside an LEA polygon |
| **`$geoIntersects`** | "Does this document's geometry touch/contain this shape?" | no | no | `find`, `$match` | **Point-in-polygon**: which census area contains the property |

Why we default to `$geoNear`: it is the only one that gives distance **and** order **and** accepts an extra `query` filter, so the work happens in one index scan. Use `$near` only for tiny lookups, and `$geoWithin`+`$centerSphere` when you only need a count or can't have `$geoNear` first.

`$centerSphere` takes **radians**: `radiusM / 6378100`. Helper: `metresToRadians()`.

`$geoNear` caveats: exactly one per pipeline, as stage 1; if a collection has more than one geo index (`areas` has `geometry` and `centroid`) you **must** pass `key`. We always pass `key`.

---

## 2. Entry point and handoff contract

```text
Person 4:  address -> geocode -> { lng, lat, geoMethod, geoConfidence }
Person 1:  locateProperty({lng, lat}) -> areaId + parents   (everything below keys off this)
```
Person 4 must pass numbers (not strings) and the original geocode confidence. If `geoConfidence` is low, Person 2 should be told via `warnings` (the analysis stores `subject.geoMethod/geoConfidence`).

Every tool has the signature `tool(db, params, ledger) -> envelope`. In practice call it through `callTool(db, analysisId, name, params)`, which persists the result and evidence on the `analyses` document.

---

## 3. The six capabilities and the queries

All queries use `const pt = {type:"Point", coordinates:[-6.2551, 53.3264]}`.

### E. Census polygon containing the property (also covers vacancy-area identification)
**Index:** `areas {geometry:"2dsphere", level:1}`; verified by `explain` as `IXSCAN geometry_level`.
```js
db.areas.findOne(
  { level: "small_area", geometry: { $geoIntersects: { $geometry: pt } } },
  { name: 1, parents: 1, census: 1 })
```
`$geoIntersects` is correct for point-in-polygon Use `$geoIntersects`, not `$geoWithin`, when the stored value is the polygon and the query value is the point.
**Output (tool `locateProperty`):** `{ areaId:"sa:268001001", name:"Ranelagh A", parents:{ electoral_division, lea, county, rtb_zone }, census:{…} }`.
This is the one spatial join in the system. `parents` then supplies the id at every other level (RTB zone for rents, LEA for RTB stats).

**Vacancy-area identification** (`vacancyForLocation`): vacancy may exist only at LEA or county level. Resolve the small area, then pick the *finest* level that has data:
```js
db.area_stats.aggregate([
  { $match: { stat: "vacancy", areaId: { $in: [smallAreaId, ...Object.values(parents)] } } },
  { $set: { levelRank: { $indexOfArray: [["small_area","electoral_division","lea","county"], "$areaLevel"] } } },
  { $sort: { levelRank: 1, periodStart: -1 } }, { $limit: 1 }])
```
**Index:** `area_stats {areaId:1, stat:1, dimension:1, periodStart:-1}`. The result carries `areaLevel` so the AI cannot present an LEA figure as a street-level one.

### A. Transport within 500 m
**Index:** `transport_stops {geo:"2dsphere"}` (plan: `GEO_NEAR_2DSPHERE`).
```js
db.transport_stops.aggregate([
  { $geoNear: { near: pt, key: "geo", distanceField: "distM", maxDistance: 500, spherical: true } },
  { $facet: {
      total:  [{ $group: { _id: null, stops: { $sum: 1 }, nearestM: { $min: "$distM" },
                 peakTph: { $sum: { $ifNull: ["$service.weekdayPeakTripsPerHour", 0] } } } }],
      byMode: [{ $unwind: "$modes" }, { $group: { _id: "$modes", stops: { $sum: 1 }, nearestM: { $min: "$distM" } } }, { $sort: { nearestM: 1 } }],
      routes: [{ $unwind: "$routes" }, { $group: { _id: "$routes.shortName", mode: { $first: "$routes.mode" } } }] } }])
```
**Equivalent using `$geoWithin`** (count only, no distance, works in `countDocuments`):
```js
db.transport_stops.countDocuments({ geo: { $geoWithin: { $centerSphere: [pt.coordinates, 500 / 6378100] } } })
```
**Seed-data result:** 5 stops inside 500 m, nearest 181 m (Luas), score 82; the stop at ~800 m is excluded.

### D. Nearest transport stop (per mode)
**Index:** same `transport_stops {geo:"2dsphere"}`; with a mode filter use `{modes:1, geo:"2dsphere"}`.
```js
// Single nearest stop, plain find ($near sorts nearest-first; no distance returned)
db.transport_stops.find({ geo: { $near: { $geometry: pt, $maxDistance: 5000 } } }).limit(1)

// Nearest stop of EACH mode with distance (what the tool uses)
db.transport_stops.aggregate([
  { $geoNear: { near: pt, key: "geo", distanceField: "distM", maxDistance: 5000, spherical: true } },
  { $unwind: "$modes" },
  { $group: { _id: "$modes", stopId: { $first: "$_id" }, name: { $first: "$name" }, distM: { $first: "$distM" } } }, // input is nearest-first
  { $sort: { distM: 1 } }])
```
The cap is 5 km so a rural address still gets a nearest stop but never scans the country.

### B. Planning applications within 1 km
**Index:** `planning_applications {geo:"2dsphere", applicationDate:-1, status:1}` (the date range in `query` is applied inside the index scan).
```js
db.planning_applications.aggregate([
  { $geoNear: { near: pt, key: "geo", distanceField: "distM", maxDistance: 1000, spherical: true,
      query: { applicationDate: { $gte: ISODate("2022-10-01") } } } },
  { $facet: {
      total:  [{ $count: "n" }],
      byStatus: [{ $group: { _id: "$status", n: { $sum: 1 }, units: { $sum: { $ifNull: ["$development.residentialUnits", 0] } } } }],
      largest: [{ $match: { "development.residentialUnits": { $gt: 0 } } }, { $sort: { "development.residentialUnits": -1 } }, { $limit: 3 }] } },
  { $set: { total: { $ifNull: [{ $first: "$total.n" }, 0] } } },
  { $set: { densityPerKm2: { $round: [{ $divide: ["$total", Math.PI * 1 * 1] }, 1] } } }])  // radius 1 km
```
**Seed-data result:** 6 applications, 140 units granted or pending, density 1.9/km², largest scheme 80 units at 347 m. An application outside the date window and one 4 km away are excluded.

### C. Rental properties within 2 km
**Index:** `rental_observations {geo:"2dsphere", measure:1, propertyType:1, bedrooms:1, observedAt:-1}` (`geo_comparables`).
```js
db.rental_observations.aggregate([
  { $geoNear: { near: pt, key: "geo", distanceField: "distM", maxDistance: 2000, spherical: true,
      query: { measure: "advertised", propertyType: "apartment", bedrooms: 2, observedAt: { $gte: ISODate("2026-04-01") } } } }, 
  { $limit: 25 }])
```
Same-bedroom, same-type, recent. A 1-bed listing at 60 m is correctly excluded.

### G + H. Distance to every comparable, sorted by distance
`distanceField` **is** G: every document leaves `$geoNear` with its great-circle distance in metres. H is `$sort`; `$geoNear` is already nearest-first, so the explicit sort only adds a tie-break (`observedAt` newest first), and is cheap because the result is already ordered.
```js
db.rental_observations.aggregate([
  { $geoNear: { near: pt, key: "geo", distanceField: "distM", maxDistance: 2000, spherical: true,
      query: { measure: "advertised", propertyType: "apartment", bedrooms: 2, observedAt: { $gte: since } } } },
  { $sort: { distM: 1, observedAt: -1 } },
  { $limit: 25 },
  { $project: { address: 1, floorAreaM2: 1, observedAt: 1, rent: "$rent.amount",
      distM: { $round: ["$distM", 0] },
      deltaVsAskingPct: { $round: [{ $multiply: [{ $divide: [{ $subtract: ["$rent.amount", 2350] }, 2350] }, 100] }, 1] } } }])
```
**Output row:** `{ _id, address:"4 Sample Ave", rent:2250, floorAreaM2:66, distM:49, deltaVsAskingPct:-4.3 }`.
Tool: `comparableListings`. `listingMarket` runs the same `$geoNear` and adds median, quartiles, a `$bucket` histogram and the asking-rent percentile.

### F. All rental observations in the same relevant geographic area
Two complementary routes, both in tool `rentsInSameArea`:

1. **Official index cells, by hierarchy.** The RTB index is published per geography, not per point, so containment is resolved once via `parents` and the cells are read from their own collection:
```js
db.rental_indexes.aggregate([
  { $match: { areaId: { $in: ["sa:268001001","ed:268001","lea:dublin-city-south-east","county:dublin-city","rtbzone:dublin-6"] },
              propertyType: "apartment", bedrooms: 2 } },
  { $group: { _id: { areaId: "$areaId", level: "$areaLevel" }, n: { $sum: 1 }, latest: { $max: "$periodStart" }, avgRent: { $avg: "$avgRent" } } }])
```
**Index:** `rental_indexes {areaId:1, measure:1, propertyType:1, bedrooms:1, periodStart:-1}` (`series`).

2. **Advertised rents, by polygon.** Independent of how `areaId` was labelled at load time:
```js
const lea = db.areas.findOne({ _id: "lea:dublin-city-south-east" }, { geometry: 1 })
db.rental_observations.countDocuments({ measure: "advertised", propertyType: "apartment", bedrooms: 2,
                                        geo: { $geoWithin: { $geometry: lea.geometry } } })
```
**Index:** `rental_observations {geo:"2dsphere", …}` (the polygon is the query shape, the index covers the points).
The two results are returned **separately** (`indexCells` and `advertised`) because they are different measurements; they are never averaged together.

### The two radius patterns, side by side

| Need | Use | Why |
|---|---|---|
| list/aggregate nearby, with distance, sorted | `$geoNear` | one pass, distance + order + filter |
| just count inside a circle | `$geoWithin` + `$centerSphere` | works in `countDocuments`, no ordering cost |
| nearest 1 by simple `find` | `$near` | simplest syntax; not usable in `countDocuments`/`$match` |
| which polygon contains the point | `$geoIntersects` | indexed polygon lookup |
| which points are inside this polygon | `$geoWithin` + `$geometry` | polygon as the query shape |

---

## 4. Index summary (what each geo query needs)

| Query | Collection | Index | Verified plan |
|---|---|---|---|
| E, vacancy-area | `areas` | `{geometry:"2dsphere", level:1}` | `IXSCAN geometry_level` |
| nearest zones (zone comparables) | `areas` | `{centroid:"2dsphere", level:1}` | n/a (small collection) |
| A, D | `transport_stops` | `{geo:"2dsphere"}`, `{modes:1, geo:"2dsphere"}` | `GEO_NEAR_2DSPHERE` |
| B | `planning_applications` | `{geo:"2dsphere", applicationDate:-1, status:1}` | `GEO_NEAR_2DSPHERE` |
| sales | `property_sales` | `{geo:"2dsphere", saleDate:-1, fullMarketPrice:1}` | `GEO_NEAR_2DSPHERE` |
| C, G, H | `rental_observations` | `{geo:"2dsphere", measure:1, propertyType:1, bedrooms:1, observedAt:-1}` | `GEO_NEAR_2DSPHERE` |
| F (index cells) | `rental_indexes` | `{areaId:1, measure:1, propertyType:1, bedrooms:1, periodStart:-1}` | n/a |
| F (polygon) | `rental_observations` | geo index above | n/a |

All created by `db/scripts/createIndexes.js` (idempotent). Note `$geoNear` radius is always capped (`maxDistance`), so cost scales with the circle, not the collection.

### Pitfalls to remember
- `$geoNear` must be stage 1. To combine, put `$lookup`/`$facet` after it.
- `$vectorSearch` filters cannot use geo operators, so for Op 14 resolve nearby `areaId`s first.
- `$near` is not allowed inside `$match`, `$facet` or `countDocuments`.
- A polygon bigger than a hemisphere is interpreted inside-out. Not a concern for Irish areas.
- MultiPolygon areas: `$geoIntersects` handles them natively. Do not store islands as separate documents with the same code.

---

## 5. Returning structured evidence for Person 2

Every geospatial tool returns the same envelope, and every number in `data` has a matching evidence item with its provenance.

```jsonc
{
  "ok": true,
  "data": { "total": { "stops": 5, "nearestM": 180.9, "peakTph": 45, "score": 82 }, "byMode": [ … ], "routes": [ … ], "nearest": [ … ] },
  "evidence": [
    { "id": "ev6", "tool": "nearbyTransport", "claim": "Transport stops within 500 m", "value": 5, "unit": "count",
      "context": { "radiusM": 500, "distance": "straight-line (great-circle), not walking", "method": "$geoNear" },
      "refs": [ { "collection": "transport_stops", "docId": "nta:8220DB000002" } ], "sourceIds": ["nta_gtfs"] },
    { "id": "ev7", "tool": "nearbyTransport", "claim": "Distance to nearest transport stop", "value": 181, "unit": "m", "…": "…" },
    { "id": "ev8", "tool": "nearbyTransport", "claim": "Transport score (0-100: 50 proximity + 50 peak frequency)", "value": 82, "unit": "score",
      "context": { "formula": "50*(1-nearestM/radius) + min(50, 2.5*peakTripsPerHour)" }, "…": "…" }
  ],
  "coverage": { "geoMatch": "radius", "confidence": "high" },
  "warnings": [ "Distances are straight-line, not walking routes." ]
}
```

### Fields the agent can rely on

| Field | Meaning | How the agent should use it |
|---|---|---|
| `data` | the computed result | Read numbers only from here |
| `evidence[].id` | unique within the analysis (`ev1`, `ev2`, …) | Cite in the report text. Claims without an id are rejected |
| `evidence[].value` / `unit` | the exact number or label | Quote verbatim. No re-computation |
| `evidence[].context` | radius, period, geographic level, method, formula | Qualify statements ("within 500 m", "at LEA level") |
| `evidence[].context.areaLevel` | `small_area`, `lea`, `rtb_zone`, `point` | Never mix levels in one sentence |
| `evidence[].refs` | `{collection, docId}` of source records | Lets the UI show "view source" |
| `evidence[].sourceIds` | keys into `sources` (organisation, URL, licence) | Citation text |
| `coverage.confidence` | `none`/`low`/`medium`/`high` from sample size and match quality | Hedge or omit below `medium` |
| `coverage.geoMatch` | `small_area`, `lea`, `radius`, `hierarchy`, `none` | Explains how the location was matched |
| `warnings` | caveats generated by the database layer | Must be reflected in the report |

### Behavioural guarantees
- **No data is explicit**: `ok:true, data:null, coverage.confidence:"none", warnings:["No transport stops within 500 m."]`. A tool never returns a plausible empty result, and an empty radius is information, not an error.
- **Straight-line distance is labelled** in `context` and `warnings`. It is not walking distance.
- **Sales are labelled as not rents**; low-confidence geocodes are filtered by `src.geoConfidence` and the filter is stated in `context`.
- **Every claim in the final report can be checked** with `verifyClaims(analysisId, [{id, asserted, tol}])` (see Op 7), which returns `verified`, `mismatch` or `no_such_evidence`.

### Suggested agent tool descriptions (for Person 2)
| Tool | Description for the model |
|---|---|
| `locateProperty` | Find the census small area and parent areas that contain the coordinates. Call first. |
| `nearbyTransport` | Transport stops within a radius (default 500 m): counts, nearest distance, modes, routes, score. |
| `nearestStops` | The nearest stop of each transport mode, up to 5 km. |
| `nearbyPlanning` | Planning applications within a radius (default 1 km): counts by status/year, residential units, density, largest schemes. |
| `comparableListings` | Rental listings within a radius (default 2 km) with distance to each, nearest first. |
| `listingMarket` | Median, quartiles, histogram and asking-rent percentile of nearby listings. |
| `rentsInSameArea` | Rental observations across the property's area hierarchy and polygon. |
| `recentSales` | Recent property sales nearby (price context, not rent). |
| `vacancyForLocation` | Vacancy rate at the finest geographic level available. |

The model supplies only `lng`, `lat` and filters; the database layer owns radii defaults, caps and thresholds.

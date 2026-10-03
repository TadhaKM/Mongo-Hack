# RentCheck AI: What MongoDB Computes Before the AI Sees Anything

> **Schema v2 (current): see [mongodb-schema.md](mongodb-schema.md).** The old `rents` collection is now two: `rental_observations` (individual advertised or registered rents; required top-level `measure`) and `rental_indexes` (official area averages; value field `avgRent`, period field `periodStart`). The code in `db/` is authoritative.

Every operation returns the standard envelope `{ data, evidence[], coverage, warnings }`, and every number in `data` is paired with an evidence item that cites the source records.

**Implementation status:** Ops 1-12 (MUST and SHOULD) are implemented in `db/tools/` and pass `npm run db:test` against a real mongod 7.0.14 with synthetic seed data. Ops 13-15 (Atlas Search / Vector Search) are STRETCH and need an Atlas cluster, so they are design only. Tool names: 1 `locateProperty`, 2 `benchmarkRent`, 3 `zoneComparables`, 4 `rentTrend`, 5 `nearbyTransport`, 6 `nearbyPlanning`, 7 `verifyClaims`, 8 `listingMarket` (the full comparable engine is `rentalComparables`, see [mongodb-comparable-engine.md](mongodb-comparable-engine.md)), 9 `recentSales`, 10 `neighbourhoodProfile`, 11 `tenancyRisk`, 12 `evidenceFreshness`.

**The pitch in one line:** the AI never calculates, locates, ranks or counts. MongoDB does, from cited records, and the AI explains the result. A claim that doesn't match stored evidence is rejected by MongoDB (Op 7).

## Ranking

| # | Operation | Rank | MongoDB features |
|---|---|---|---|
| 1 | Locate property in census polygon | **MUST** | `2dsphere`, `$geoIntersects` |
| 2 | Benchmark asking rent vs RTB index | **MUST** | compound index, `$sort/$limit`, `$switch` |
| 3 | Neighbouring-zone rent comparisons | **MUST** | `$geoNear`, `$lookup` (sub-pipeline), `$median`, `$percentile`, `$stdDevPop` |
| 4 | Rental trend | **MUST** | `$setWindowFields` (`$shift`, moving `$avg`) |
| 5 | Transport within 500 m | **MUST** | `$geoNear`, `$facet` |
| 6 | Planning within 1 km + density + trend | **MUST** | `$geoNear` + `query`, `$facet` |
| 7 | Verify the AI's claims against evidence | **MUST** | `$filter`, `$switch` over the analysis document |
| 8 | Listing-level comparables, distribution | SHOULD | `$geoNear`, `$facet`, `$bucket`, `$percentile` |
| 9 | Recent property sales | SHOULD | `$geoNear`, `$facet`, `$median` |
| 10 | Neighbourhood profile (5 datasets, 1 query) | SHOULD | `$lookup` x 5 with pipelines |
| 11 | Tenancy-risk ranking vs every LEA | SHOULD | `$group`, `$setWindowFields` (`$rank`, `$count`) |
| 12 | Evidence freshness and geographic-level filter | SHOULD | `$unwind`, `$lookup`, `$dateDiff` |
| 13 | Address autocomplete | STRETCH | Atlas Search `autocomplete` + fuzzy |
| 14 | Similar listings (semantic) | STRETCH | Atlas Vector Search + filter |
| 15 | Areas like this one, but cheaper | STRETCH | Vector Search on computed numeric vectors + `$lookup` |

**MUST (7)** is the demo spine: location, benchmark, comparables, trend, transport, planning, verification.

Shared example property: `pt = {type:"Point", coordinates:[-6.2551, 53.3264]}` (12 Example Rd, Ranelagh, Dublin 6), 2-bed apartment, asking EUR 2,350/month.

---

## MUST BUILD

### Op 1. Which census polygon contains this property?
- **User question:** "Where exactly is this property, and what is the area like?"
- **Collections:** `areas`
- **Feature:** `2dsphere` index + `$geoIntersects` (point-in-polygon)
- **Query:**
```js
db.areas.findOne(
  { level:"small_area", geometry:{ $geoIntersects:{ $geometry: pt } } },
  { name:1, parents:1, "census.population":1, "census.renterPct":1, "census.avgHouseholdSize":1 })
```
- **Output:** `{ "_id":"sa:268001001","name":"Ranelagh A","parents":{"electoral_division":"ed:268001","lea":"lea:dublin-city-south-east","county":"county:dublin-city","rtb_zone":"rtbzone:dublin-6"},"census":{"population":412,"renterPct":57.9,"avgHouseholdSize":2.4} }`
- **Why MongoDB:** exact polygon geometry. An LLM guesses "Ranelagh is Dublin 6", which is wrong at small-area level and cannot be audited. This result is also the **key for every other operation** (`parents.rtb_zone`, `areaId`).
- **AI afterwards:** describes the area in words from the returned numbers.

### Op 2. Is the asking rent above the official average?
- **User question:** "Is EUR 2,350 a fair rent for a 2-bed apartment here?"
- **Collections:** `rental_indexes`
- **Feature:** compound index (equality x4, then sort), `$sort/$limit`, `$switch`
- **Pipeline:**
```js
db.rental_indexes.aggregate([
 { $match:{ areaId:"rtbzone:dublin-6", measure:"index_mean", propertyType:"apartment", bedrooms:2 } },
 { $sort:{ periodStart:-1 } }, { $limit:1 },
 { $project:{ periodLabel:1, mean:"$avgRent", n:"$sampleSize", se:"$stdError", src:1 } },
 { $set:{
     asking:2350,
     diffEur:{ $subtract:[2350,"$mean"] },
     diffPct:{ $round:[{ $multiply:[{ $divide:[{ $subtract:[2350,"$mean"] },"$mean"] },100] },1] },
     areaMeanCI95:[ { $subtract:["$mean",{ $multiply:[1.96,"$se"] }] }, { $add:["$mean",{ $multiply:[1.96,"$se"] }] } ] } },
 { $set:{ band:{ $switch:{ branches:[
     { case:{ $gt:["$diffPct",15] }, then:"well_above_average" },
     { case:{ $gt:["$diffPct",5] },  then:"above_average" },
     { case:{ $gte:["$diffPct",-5] },then:"in_line" } ], default:"below_average" } } } }
])
```
- **Output:** `{ "periodLabel":"2025Q2","mean":2214,"n":312,"asking":2350,"diffEur":136,"diffPct":6.1,"areaMeanCI95":[2133.6,2294.4],"band":"above_average" }`
- **Why MongoDB:** deterministic arithmetic and fixed thresholds. The same inputs always give the same band, and the band definition is in code, not in a prompt. The interval is for the *area mean*, not for any individual property (stated in `warnings`).
- **AI afterwards:** turns `band` + `diffPct` into a sentence and adds caveats. It does not change the number or the band.

### Op 3. How does this compare with the surrounding rental zones?
- **User question:** "Is the rent high compared with nearby areas?"
- **Collections:** `areas` (centroids of RTB zones) then `rental_indexes`
- **Feature:** `$geoNear` on `centroid`, `$lookup` with a sub-pipeline, `$median`, `$percentile`, `$stdDevPop`
- **Pipeline:**
```js
db.areas.aggregate([
 { $geoNear:{ near:pt, key:"centroid", distanceField:"distM", maxDistance:6000, spherical:true, query:{ level:"rtb_zone" } } },
 { $lookup:{ from:"rental_indexes", let:{ id:"$_id" }, as:"cell", pipeline:[
     { $match:{ $expr:{ $eq:["$areaId","$$id"] }, measure:"index_mean", propertyType:"apartment", bedrooms:2 } },
     { $sort:{ periodStart:-1 } }, { $limit:1 } ] } },
 { $unwind:"$cell" },
 { $group:{ _id:null,
     zones:{ $push:{ name:"$name", distKm:{ $round:[{ $divide:["$distM",1000] },1] }, rent:"$cell.avgRent", period:"$cell.periodLabel" } },
     mean:{ $avg:"$cell.avgRent" }, sd:{ $stdDevPop:"$cell.avgRent" },
     median:{ $median:{ input:"$cell.avgRent", method:"approximate" } },
     quartiles:{ $percentile:{ input:"$cell.avgRent", p:[0.25,0.75], method:"approximate" } },
     min:{ $min:"$cell.avgRent" }, max:{ $max:"$cell.avgRent" }, n:{ $sum:1 } } },
 { $set:{
     zScore:{ $cond:[{ $gt:["$sd",0] },{ $round:[{ $divide:[{ $subtract:[2350,"$mean"] },"$sd"] },2] },null] },
     zonesCheaper:{ $size:{ $filter:{ input:"$zones", cond:{ $lt:["$$this.rent",2350] } } } } } }
])
```
- **Output:** `{ "n":7,"mean":2105.4,"median":2090,"quartiles":[1950,2214],"min":1780,"max":2480,"sd":228.7,"zScore":1.07,"zonesCheaper":6,"zones":[{"name":"Dublin 6","distKm":0.6,"rent":2214,"period":"2025Q2"}, …] }`
- **Why MongoDB:** a spatial join (nearest zones) and a distribution calculation in one round trip. The model would otherwise receive seven raw numbers and estimate a median and z-score.
- **AI afterwards:** "Cheaper than 6 of the 7 surrounding zones but 1.1 SD above their mean", plus zone context.

### Op 4. Which way is rent moving?
- **User question:** "Are rents here going up, and how fast?"
- **Collections:** `rental_indexes`
- **Feature:** `$setWindowFields` with `$shift` (look-back) and a moving `$avg`
- **Pipeline:**
```js
db.rental_indexes.aggregate([
 { $match:{ areaId:"rtbzone:dublin-6", measure:"index_mean", propertyType:"apartment", bedrooms:2, periodStart:{ $gte:ISODate("2022-04-01") } } },
 { $setWindowFields:{ sortBy:{ periodStart:1 }, output:{
     prevQ:{ $shift:{ output:"$avgRent", by:-1 } },
     prevY:{ $shift:{ output:"$avgRent", by:-4 } },
     ma4:{ $avg:"$avgRent", window:{ documents:[-3,0] } } } } },
 { $set:{
     qoqPct:{ $cond:[{ $gt:["$prevQ",0] },{ $round:[{ $multiply:[{ $divide:[{ $subtract:["$avgRent","$prevQ"] },"$prevQ"] },100] },1] },null] },
     yoyPct:{ $cond:[{ $gt:["$prevY",0] },{ $round:[{ $multiply:[{ $divide:[{ $subtract:["$avgRent","$prevY"] },"$prevY"] },100] },1] },null] } } },
 { $sort:{ periodStart:1 } },
 { $group:{ _id:null,
     series:{ $push:{ period:"$periodLabel", rent:"$avgRent", ma4:{ $round:["$ma4",0] }, yoyPct:"$yoyPct" } },
     first:{ $first:"$avgRent" }, latest:{ $last:"$avgRent" }, latestYoY:{ $last:"$yoyPct" },
     avgQoQ:{ $avg:"$qoqPct" }, peak:{ $max:"$avgRent" }, n:{ $sum:1 } } },
 { $set:{ totalChangePct:{ $round:[{ $multiply:[{ $divide:[{ $subtract:["$latest","$first"] },"$first"] },100] },1] },
          direction:{ $switch:{ branches:[{ case:{ $eq:["$avgQoQ",null] }, then:"unknown" },{ case:{ $gt:["$avgQoQ",0.5] }, then:"rising" },{ case:{ $lt:["$avgQoQ",-0.5] }, then:"falling" }], default:"flat" } } } }
])
```
- **Output:** `{ "n":13,"first":1890,"latest":2214,"totalChangePct":17.1,"latestYoY":5.8,"avgQoQ":1.3,"peak":2214,"direction":"rising","series":[{"period":"2022Q2","rent":1890,"ma4":null,"yoyPct":null}, …] }`
- **Why MongoDB:** window functions compute YoY and moving averages in place, ordered by time, and the same output is the chart series.
- **AI afterwards:** narrates the trend and notes the data period.

### Op 5. What public transport is within 500 m?
- **User question:** "How good is transport from here?"
- **Collections:** `transport_stops`
- **Feature:** `$geoNear` + `$facet` (several sub-aggregations over one geo scan)
- **Pipeline:**
```js
db.transport_stops.aggregate([
 { $geoNear:{ near:pt, key:"geo", distanceField:"distM", maxDistance:500, spherical:true } },
 { $facet:{
     total:[{ $group:{ _id:null, stops:{ $sum:1 }, nearestM:{ $min:"$distM" }, peakTph:{ $sum:{ $ifNull:["$service.weekdayPeakTripsPerHour",0] } } } }],
     byMode:[{ $unwind:"$modes" }, { $group:{ _id:"$modes", stops:{ $sum:1 }, nearestM:{ $min:"$distM" }, peakTph:{ $sum:{ $ifNull:["$service.weekdayPeakTripsPerHour",0] } } } }, { $sort:{ nearestM:1 } }],
     routes:[{ $unwind:"$routes" }, { $group:{ _id:"$routes.shortName", mode:{ $first:"$routes.mode" } } }, { $sort:{ _id:1 } }],
     nearest:[{ $sort:{ distM:1 } }, { $limit:3 }, { $project:{ name:1, modes:1, distM:{ $round:["$distM",0] } } }] } },
 { $set:{ total:{ $first:"$total" } } },
 { $set:{ "total.score":{ $round:[{ $add:[
     { $multiply:[50,{ $max:[0,{ $subtract:[1,{ $divide:["$total.nearestM",500] }] }] }] },
     { $min:[50,{ $multiply:["$total.peakTph",2.5] }] } ] },0] } } }
])
```
Score = up to 50 for proximity + up to 50 for peak frequency; the formula is stored in the evidence `context`.
- **Output:** `{ "total":{"stops":5,"nearestM":181,"peakTph":45,"score":82}, "byMode":[…], "routes":[…], "nearest":[…] }`
- **Why MongoDB:** distance on a sphere, radius filtering and per-mode counting are database work. The model cannot compute distance between coordinates.
- **AI afterwards:** summarises and picks route names to mention. It does not re-score. Distance is straight-line, not walking, and the output says so.

### Op 6. What is being built nearby?
- **User question:** "Is there a lot of development around here? Anything big coming?"
- **Collections:** `planning_applications`
- **Feature:** `$geoNear` with a pre-filter, `$facet`, computed density
- **Pipeline:**
```js
db.planning_applications.aggregate([
 { $geoNear:{ near:pt, key:"geo", distanceField:"distM", maxDistance:1000, spherical:true, query:{ applicationDate:{ $gte:ISODate("2022-10-01") } } } },
 { $facet:{
     total:[{ $count:"n" }],
     byStatus:[{ $group:{ _id:"$status", n:{ $sum:1 }, units:{ $sum:{ $ifNull:["$development.residentialUnits",0] } } } }],
     byYear:[{ $group:{ _id:{ $year:"$applicationDate" }, n:{ $sum:1 }, units:{ $sum:{ $ifNull:["$development.residentialUnits",0] } } } }, { $sort:{ _id:1 } }],
     largest:[{ $match:{ "development.residentialUnits":{ $gt:0 } } }, { $sort:{ "development.residentialUnits":-1 } }, { $limit:3 },
              { $project:{ reference:1, proposal:1, status:1, "development.residentialUnits":1, distM:{ $round:["$distM",0] } } }] } },
 { $set:{ total:{ $ifNull:[{ $first:"$total.n" },0] } } },
 { $set:{ densityPerKm2:{ $round:[{ $divide:["$total", Math.PI * 1 * 1] },1] } } }   // radius 1 km
])
```
- **Output:** `{ "total":6,"densityPerKm2":1.9,"byStatus":[…],"byYear":[…],"largest":[{"reference":"2020/25","status":"pending","development":{"residentialUnits":80},"distM":347}] }`
- **Why MongoDB:** radius filter, grouping by status and year, and unit totals in one pass. "Units" are only those present in the data. The pipeline never guesses from text.
- **AI afterwards:** interprets what pending/granted supply means for rent pressure. `densityPerKm2` is a raw rate; the AI should not call it "high" without a baseline.

### Op 7. Did the report state numbers that don't match the data?
- **User question:** (implicit) "Can I trust this report?"
- **Collections:** `analyses`
- **Feature:** `$filter`, `$switch` over the embedded `evidence` array
- **Pipeline:**
```js
db.analyses.aggregate([
 { $match:{ _id:analysisId } }, { $project:{ evidence:1 } },
 { $set:{ claims:{ $literal:[ { id:"ev1", asserted:2214, tol:1 }, { id:"ev3", asserted:7, tol:0 }, { id:"ev9", asserted:50, tol:0 } ] } } },
 { $unwind:"$claims" },
 { $set:{ ev:{ $first:{ $filter:{ input:"$evidence", cond:{ $eq:["$$this.id","$claims.id"] } } } } } },
 { $project:{ _id:0, id:"$claims.id", asserted:"$claims.asserted", stored:"$ev.value",
     status:{ $switch:{ branches:[
        { case:{ $eq:[{ $type:"$ev" },"missing"] }, then:"no_such_evidence" },
        { case:{ $not:[{ $and:[{ $isNumber:"$ev.value" },{ $isNumber:"$claims.asserted" }] }] }, then:{ $cond:[{ $eq:["$ev.value","$claims.asserted"] },"verified","mismatch"] } },
        { case:{ $lte:[{ $abs:{ $subtract:["$claims.asserted","$ev.value"] } },"$claims.tol"] }, then:"verified" } ],
        default:"mismatch" } } } }
])
```
- **Output:** `[{"id":"ev1","asserted":2214,"stored":2214,"status":"verified"},{"id":"ev3","asserted":7,"stored":6,"status":"mismatch"},{"id":"ev9","asserted":50,"status":"no_such_evidence"}]`
- **Why MongoDB:** the evidence is the source of truth and lives in the same document as the results. The check is a deterministic database query, not another model's opinion.
- **AI afterwards:** regenerates any sentence flagged `mismatch` or `no_such_evidence`, or removes it. Only `verified` claims go to the report.

---

## SHOULD BUILD

### Op 8. Advertised listings near the property (needs a listings source)
- **User question:** "What are similar flats nearby actually asking?"
- **Collections:** `rental_observations` (`measure:"advertised"`)
- **Feature:** `$geoNear`, `$facet`, `$bucket`, `$percentile`
- **Pipeline:**
```js
db.rental_observations.aggregate([
 { $geoNear:{ near:pt, key:"geo", distanceField:"distM", maxDistance:1500, spherical:true,
     query:{ measure:"advertised", propertyType:"apartment", bedrooms:2, observedAt:{ $gte:ISODate("2026-04-01") } } } },
 { $facet:{
     stats:[{ $group:{ _id:null, n:{ $sum:1 }, mean:{ $avg:"$rent.amount" },
         median:{ $median:{ input:"$rent.amount", method:"approximate" } },
         quartiles:{ $percentile:{ input:"$rent.amount", p:[0.25,0.75], method:"approximate" } },
         medianPerM2:{ $median:{ input:{ $cond:[{ $gt:["$floorAreaM2",0] },{ $divide:["$rent.amount","$floorAreaM2"] },null] }, method:"approximate" } } } }],
     distribution:[{ $bucket:{ groupBy:"$rent.amount", boundaries:[0,1800,2100,2400,2700,3000], default:"3000+", output:{ n:{ $sum:1 } } } }],
     askingRank:[{ $group:{ _id:null, n:{ $sum:1 }, atOrBelow:{ $sum:{ $cond:[{ $lte:["$rent.amount",2350] },1,0] } } } }],
     nearest:[{ $sort:{ distM:1 } }, { $limit:5 }, { $project:{ address:1, "rent.amount":1, floorAreaM2:1, distM:{ $round:["$distM",0] } } }] } }
])
```
- **Output:** `{ "stats":[{"n":23,"mean":2288,"median":2250,"quartiles":[2100,2450],"medianPerM2":33.1}], "distribution":[{"_id":1800,"n":2}, …], "askingRank":[{"n":23,"atOrBelow":14}], "nearest":[…] }`
- **Why MongoDB:** distances, median, quartiles, histogram and percentile rank in one query. `distribution` is the chart data.
- **AI afterwards:** explains the position ("61st percentile of 23 nearby listings"). If `n<8`, confidence is `low` and the AI says so. The scored, ranked version of this is `rentalComparables`.

### Op 9. What have homes nearby sold for?
- **User question:** "What do properties here sell for?"
- **Collections:** `property_sales`
- **Feature:** `$geoNear` with quality filters, `$facet`, `$median`
- **Pipeline:**
```js
db.property_sales.aggregate([
 { $geoNear:{ near:pt, key:"geo", distanceField:"distM", maxDistance:1000, spherical:true,
     query:{ saleDate:{ $gte:ISODate("2023-10-01") }, fullMarketPrice:true, "src.geoConfidence":{ $gte:0.5 } } } },
 { $facet:{
     overall:[{ $group:{ _id:null, n:{ $sum:1 }, median:{ $median:{ input:"$salePrice", method:"approximate" } }, quartiles:{ $percentile:{ input:"$salePrice", p:[0.25,0.75], method:"approximate" } } } }],
     byYear:[{ $group:{ _id:{ $year:"$saleDate" }, n:{ $sum:1 }, median:{ $median:{ input:"$salePrice", method:"approximate" } } } }, { $sort:{ _id:1 } }],
     recent:[{ $sort:{ saleDate:-1 } }, { $limit:5 }, { $project:{ address:1, salePrice:1, saleDate:1, distM:{ $round:["$distM",0] } } }] } }
])
```
- **Output:** `{ "overall":[{"n":64,"median":520000,"quartiles":[430000,610000]}], "byYear":[…], "recent":[…] }`
- **Why MongoDB:** geographic and date filtering, quality filtering and statistics. Excluded low-confidence rows are counted in `coverage`.
- **AI afterwards:** price context only. Sale prices are not rents and the warning is mandatory.

### Op 10. Neighbourhood profile from five datasets in one query
- **User question:** "What's the area like: who lives here, how many empty homes, are tenants being evicted, what's being built?"
- **Collections:** `areas` then `area_stats` (x2), `planning_applications`, `transport_stops`, `property_sales`
- **Feature:** `$lookup` with sub-pipelines (joined on `areaId`, no application-side joins; needs MongoDB 5.0+)
- **Pipeline:**
```js
db.areas.aggregate([
 { $match:{ _id:"sa:268001001" } },
 { $lookup:{ from:"area_stats", let:{ lea:"$parents.lea" }, as:"vacancy", pipeline:[
     { $match:{ $expr:{ $eq:["$areaId","$$lea"] }, stat:"vacancy" } }, { $sort:{ periodStart:-1 } }, { $limit:1 },
     { $project:{ periodLabel:1, areaId:1, areaLevel:1, "values.vacancyRatePct":1 } } ] } },
 { $lookup:{ from:"area_stats", let:{ lea:"$parents.lea" }, as:"terminations", pipeline:[
     { $match:{ $expr:{ $eq:["$areaId","$$lea"] }, stat:"rtb_terminations", periodStart:{ $gte:ISODate("2024-10-01") } } },
     { $group:{ _id:"$dimension", notices:{ $sum:"$values.notices" } } }, { $sort:{ notices:-1 } } ] } },
 { $lookup:{ from:"planning_applications", localField:"_id", foreignField:"areaId", as:"planning", pipeline:[
     { $match:{ applicationDate:{ $gte:ISODate("2022-10-01") } } }, { $group:{ _id:"$status", n:{ $sum:1 } } } ] } },
 { $lookup:{ from:"transport_stops", localField:"_id", foreignField:"areaId", as:"stops", pipeline:[{ $count:"n" }] } },
 { $lookup:{ from:"property_sales", localField:"_id", foreignField:"areaId", as:"sales", pipeline:[
     { $match:{ saleDate:{ $gte:ISODate("2023-10-01") }, fullMarketPrice:true } },
     { $group:{ _id:null, n:{ $sum:1 }, median:{ $median:{ input:"$salePrice", method:"approximate" } } } } ] } },
 { $project:{ name:1, census:1, vacancy:{ $first:"$vacancy" }, terminations:1, planning:1, stops:{ $ifNull:[{ $first:"$stops.n" },0] }, sales:{ $first:"$sales" } } }
])
```
- **Output:** one document: `{ name, census:{population:412, renterPct:57.9,…}, vacancy:{periodLabel:"2022", values:{vacancyRatePct:3.1}}, terminations:[{_id:"sale_of_property", notices:84}, …], planning:[{_id:"granted",n:21},…], stops:7, sales:{n:31, median:518000} }`
- **Why MongoDB:** the "combine multiple datasets" moment. Five datasets with different schemas, one `areaId` key, one round trip. Mixed levels (small-area census, LEA-level RTB) are joined through `areas.parents`.
- **AI afterwards:** writes the neighbourhood section. It must not mix geographic levels in a sentence: each figure's `areaLevel` is in the evidence.

### Op 11. How does this area rank for tenancy risk?
- **User question:** "Is it riskier to rent here than elsewhere (terminations, disputes)?"
- **Collections:** `area_stats`
- **Feature:** two-stage `$group`, `$setWindowFields` with `$rank` and a whole-partition `$count`
- **Pipeline:**
```js
db.area_stats.aggregate([
 { $match:{ stat:"rtb_terminations", areaLevel:"lea", periodStart:{ $gte:ISODate("2025-07-01") } } },
 { $group:{ _id:{ a:"$areaId", p:"$periodStart" }, notices:{ $sum:"$values.notices" }, rate:{ $sum:"$values.noticesPer1000Tenancies" } } },
 { $group:{ _id:"$_id.a", notices:{ $sum:"$notices" }, ratePer1000:{ $avg:"$rate" } } },
 { $setWindowFields:{ sortBy:{ ratePer1000:-1 }, output:{ rank:{ $rank:{} }, of:{ $count:{}, window:{ documents:["unbounded","unbounded"] } } } } },
 { $match:{ _id:"lea:dublin-city-south-east" } },
 { $set:{ percentile:{ $round:[{ $multiply:[{ $divide:[{ $subtract:["$of","$rank"] },{ $max:[1,{ $subtract:["$of",1] }] }] },100] },0] } } }
])
```
Rank 1 = highest termination rate. `percentile` = share of LEAs with a lower rate.
- **Output:** `{ "_id":"lea:dublin-city-south-east","notices":311,"ratePer1000":6.4,"rank":2,"of":4,"percentile":67 }`
- **Why MongoDB:** the ranking needs every LEA in the same calculation. The model cannot rank against data it did not receive.
- **AI afterwards:** "higher termination rate than 67% of local-authority electoral areas." No causation.

### Op 12. How current and how local is each piece of evidence?
- **User question:** "How recent is this data, and at what geographic level?"
- **Collections:** `analyses` then `sources`
- **Feature:** `$unwind`, `$lookup`, `$dateDiff`, filters on evidence context
- **Pipeline:**
```js
db.analyses.aggregate([
 { $match:{ _id:analysisId } }, { $unwind:"$evidence" },
 { $match:{ "evidence.context.areaLevel":{ $in:["small_area","lea","rtb_zone"] } } },        // geographic-level filter
 { $unwind:"$evidence.sourceIds" },
 { $lookup:{ from:"sources", localField:"evidence.sourceIds", foreignField:"_id", as:"s" } }, { $unwind:"$s" },
 { $set:{ ageMonths:{ $dateDiff:{ startDate:"$s.coverage.to", endDate:"$$NOW", unit:"month" } } } },
 { $group:{ _id:"$evidence.id", claim:{ $first:"$evidence.claim" }, areaLevel:{ $first:"$evidence.context.areaLevel" },
            oldestSourceMonths:{ $max:"$ageMonths" }, sources:{ $addToSet:"$s.title" } } },
 { $set:{ freshness:{ $switch:{ branches:[{ case:{ $eq:["$oldestSourceMonths",null] }, then:"unknown" },
                                          { case:{ $lte:["$oldestSourceMonths",6] }, then:"current" },
                                          { case:{ $lte:["$oldestSourceMonths",18] }, then:"recent" } ], default:"dated" } } } },
 { $sort:{ _id:1 } }
])
```
- **Output:** `[{"_id":"ev1","claim":"Latest RTB mean rent…","areaLevel":"rtb_zone","oldestSourceMonths":3,"sources":["RTB Rent Index"],"freshness":"current"}, {"_id":"ev6","claim":"Vacancy rate","areaLevel":"lea","oldestSourceMonths":46,"freshness":"dated"}]`
- **Why MongoDB:** metadata joins and date arithmetic against the registry of record.
- **AI afterwards:** adds a "data freshness" caveat, e.g. "vacancy figures are from 2022 and at LEA level".

---

## STRETCH (design only; need Atlas)

### Op 13. Address autocomplete and typo-tolerant lookup
- **Collections:** `property_sales` (and `rental_observations`) addresses
- **Feature:** Atlas Search `autocomplete` with fuzzy matching
- **Index (`address_ac`):** `{ "mappings":{ "dynamic":false, "fields":{ "address":[{ "type":"autocomplete","tokenization":"edgeGram","minGrams":2,"maxGrams":15,"foldDiacritics":true }] } } }`
- **Pipeline:**
```js
db.property_sales.aggregate([
 { $search:{ index:"address_ac", autocomplete:{ query:"12 exampl rd rane", path:"address", fuzzy:{ maxEdits:1 } } } },
 { $limit:5 }, { $project:{ _id:0, address:1, geo:1, areaId:1, score:{ $meta:"searchScore" } } } ])
```
- **Why MongoDB:** search runs next to the data with no separate service. It only finds addresses that exist in the loaded data, so it is a suggestion helper, not a geocoder.
- **AI afterwards:** nothing. This runs before the analysis.

### Op 14. Listings semantically similar to this one
- **Collections:** `rental_observations` (advertised; needs optional `description` and `embedding`)
- **Feature:** Atlas Vector Search with pre-filter
- **Index (`obs_vec`):** `{ "fields":[ {"type":"vector","path":"embedding","numDimensions":1024,"similarity":"cosine"}, {"type":"filter","path":"measure"}, {"type":"filter","path":"bedrooms"}, {"type":"filter","path":"areaId"} ] }`
- **Pipeline:**
```js
db.rental_observations.aggregate([
 { $vectorSearch:{ index:"obs_vec", path:"embedding", queryVector:subjectEmbedding, numCandidates:200, limit:10,
     filter:{ measure:"advertised", bedrooms:2, areaId:{ $in:nearbySmallAreaIds } } } },
 { $project:{ address:1, description:1, "rent.amount":1, floorAreaM2:1, score:{ $meta:"vectorSearchScore" } } } ])
```
`nearbySmallAreaIds` comes from a prior `areas` query (`$vectorSearch` filters cannot use geo operators).
- **Dependency:** whoever owns the embedding call creates the embeddings at load time and for the query; the model must be fixed before the index is created.

### Op 15. Areas like this one, but cheaper
- **Collections:** `areas` (with computed `featureVector`) then `rental_indexes`
- **Feature:** `$setWindowFields` z-scoring (build), Vector Search (`euclidean`), `$lookup`
- **Build (once, after census load):**
```js
db.areas.aggregate([
 { $match:{ level:"small_area", "census.population":{ $gt:50 } } },
 { $set:{ f1:"$census.renterPct", f2:"$census.avgHouseholdSize",
          f3:{ $divide:["$census.ageBands.25_34","$census.population"] }, f4:{ $divide:["$census.population","$areaKm2"] } } },
 { $setWindowFields:{ output:{
     m1:{ $avg:"$f1", window:{ documents:["unbounded","unbounded"] } }, s1:{ $stdDevPop:"$f1", window:{ documents:["unbounded","unbounded"] } } /* repeat for f2..f4 */ } } },
 { $set:{ featureVector:[ { $divide:[{ $subtract:["$f1","$m1"] },"$s1"] } /* … f2..f4 */ ] } },
 { $project:{ featureVector:1 } },
 { $merge:{ into:"areas", on:"_id", whenMatched:"merge", whenNotMatched:"discard" } } ])
```
- **Index (`areas_vec`):** vector on `featureVector`, 4 dims, `euclidean`; filter on `level`, `parents.county`.
- **Query:** `$vectorSearch` with the target area's vector, then `$lookup` the latest `rental_indexes` cell for each result's `parents.rtb_zone` and `$match` where it is lower than the subject's zone.
- **Why MongoDB:** the vectors are *computed in the database from census data*, not by a language model. Similarity is explainable (renter share, household size, age mix, density).
- **AI afterwards:** explains why the alternatives resemble this area. It never invents the similarity.

---

## Notes

- `$percentRank` and `$derivative` with unit `quarter` do not exist or are invalid. Rankings use `$rank` plus a whole-partition `$count`, and trends use `$shift`.
- The schema additions this document needed (`sources.coverage.to`, `evidence[].context.areaLevel`, `rental_observations.description/embedding`, `areas.featureVector`) are applied in [mongodb-schema.md](mongodb-schema.md).

## Demo script (what the judge sees)

1. **Op 1:** a pin on the map snaps to a census polygon.
2. **Ops 2-4:** "EUR 2,350 is 6.1% above the RTB mean, 1.07 SD above neighbouring zones, in a market rising 1.3%/quarter." Each figure shows its `evidenceId` and source.
3. **Ops 5-6:** counts and distances from `$geoNear`, with the query visible.
4. **Op 7:** deliberately corrupt one number in the AI draft and show MongoDB flag it `mismatch`.
5. Stretch: **Op 15** "areas like this but cheaper", where the vectors come from census data and not from an LLM.

*"The model never sees raw tables. It receives the output of these pipelines, and every sentence it writes is checked back against them."*

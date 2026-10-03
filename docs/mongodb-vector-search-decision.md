# Should RentCheck AI Use MongoDB Vector Search?

**Short answer: not for the core product. Nothing here is a MUST USE.** Comparables, trends, geography, transport, planning and verification are all structured, numeric or spatial problems that MongoDB already solves exactly and explainably. Vector Search earns a place in only one narrow case (retrieving authoritative tenant-guidance text), and even there a deterministic lookup should come first.

Status of the claims below: the exact in-pipeline similarity pipeline (Architecture A) was run on a real `mongod` 7.0.14 and matched an independent JS calculation. Architecture B (`$vectorSearch`) needs an Atlas cluster, which was not available here, so it is design only; check the operator and filter details against the current Atlas documentation before building.

## Verdicts

| # | Use case | Genuinely useful? | Effort | Hackathon verdict |
|---|---|---|---|---|
| 1 | Similar rental listings | Only if listing text exists, and then only as a re-rank | Medium | **OPTIONAL** (conditional) |
| 2 | Similar property descriptions | No. It is the input half of #1; the user's form has no description field | n/a | **DO NOT USE** (as a separate feature) |
| 3 | Similar planning applications | No. A category field at ingest does it better | Low-medium | **DO NOT USE** |
| 4 | Similar previous analyses | No. Tens of documents; exact-input cache already exists | Low | **DO NOT USE** |
| 5 | Semantic evidence retrieval | Yes, for tenant-rights and methodology text | Medium (mostly content work) | **OPTIONAL** (the best candidate) |
| 6 | Similar properties | No. It would replace the explainable comparable score with an opaque one | Medium | **DO NOT USE** |
| + | Similar *areas* by census profile (not in your list) | Yes, but needs no vector index | Low | **OPTIONAL** (exact arithmetic, see section 5) |

## 1. A reality check on the data

Vector Search needs text (or another high-dimensional signal) to embed. Look at what the official datasets contain:

| Dataset | Free text? |
|---|---|
| RTB / ESRI Rent Index, RTB disputes and terminations | none |
| CSO census, vacancy | none |
| NTA / TFI GTFS | stop and route names only |
| Residential Property Price Register | an address |
| National Planning Applications | **yes: `proposal`** (hundreds of thousands of rows) |
| Listings (the source of `rental_observations`) | **descriptions exist only on commercial portals, which Person 4 may not be able to legally scrape or redistribute** |

So the only large *official* text corpus is planning proposals, and listing descriptions are the data we are least sure of getting. Any listing-text feature carries a data risk the other features do not.

## 2. The six use cases

### 1. Similar rental listings
- **Genuinely useful?** Marginally. The comparable engine already scores distance, recency, floor area, type, area and geocode quality. Text can add what structure cannot capture (finish, balcony, new-build, furnished). But embedding similarity is not rent comparability, it is hard to explain to a user, and it conflicts with the project's rule that every number is deterministic and traceable.
- **What is embedded?** `description` (plus title) of an advertised listing, one vector per `rental_observations` document, stored in `embedding`, L2-normalised.
- **Normal fields:** `measure`, `bedrooms`, `propertyType`, `geo`, `areaId`, `observedAt`, `rent`, `floorAreaM2`, `src`.
- **Query:** hybrid, see section 3.
- **What the AI gets:** a short list of "most similar listings" each with rent, distance, similarity score and a link to the record, as **illustration**, not as the basis of the median.
- **Difficulty:** medium. Embedding every listing at ingest, an embedding call at query time (and a fallback when it fails), and about 13 KB per document for a 1,024-dimension array of doubles (measured), unless stored as compact binary vectors.
- **Worth it?** Only if a listings source with descriptions is secured **and** the core is finished. If used, it may add a small, labelled factor or a re-rank, **never** change `medianRent`.

### 2. Similar property descriptions
- **Useful?** Not as its own feature. The submitted form is `{address, latitude, longitude, monthlyRent, bedrooms, propertyType, floorArea, analysisDate}`: there is no description to embed. It only exists if the user pastes a listing, which is use case 1.
- **Verdict:** DO NOT USE separately. Fold it into #1 if a description is ever supplied.

### 3. Similar planning applications
- **Useful?** No. The questions RentCheck asks are "how much housing is coming nearby, in what state?". That is answered exactly by `status`, `development.residentialUnits` and `applicationDate`. The one thing a model adds is categorising free-text proposals ("student accommodation", "build-to-rent", "demolition", "co-living").
- **What is embedded?** `proposal`.
- **Better approach:** classify once at ingest with keyword rules (or one LLM pass) into a normal field `development.category`. It is deterministic, filterable, countable, explainable, free at query time, and needs no index. If free-text search is wanted, Atlas Search (keyword) is the proportionate tool.
- **Difficulty / worth it:** vector index on a large collection for no extra answer. **DO NOT USE.**

### 4. Similar previous analyses
- **Useful?** No. The demo database will hold tens of analyses. Exact repeats are served by `inputHash`, and a "similar" past report has no valid use: each report is computed from current data. Embedding results also stores derived, possibly personal, address data for nothing.
- **DO NOT USE.**

### 5. Semantic evidence retrieval
- **Genuinely useful?** Yes, in one specific sense: **retrieving authoritative guidance text** (tenant rights, notice periods, deposit rules, rent-pressure-zone rules, what an RTB dispute is, how the RTB index is built, dataset caveats). The AI must not recite Irish tenancy law from memory, and this text is unstructured. This is not "rental data evidence"; it is a citable knowledge base.
- **What is embedded?** Each chunk's `title` + `text` (200-400 tokens), taken verbatim from official sources (RTB, Citizens Information, legislation, our own method notes).
- **Normal fields:** `topic`, `jurisdiction: "IE"`, `sourceId`, `url`, `sectionRef`, `effectiveFrom`, `supersededBy`, `appliesToLeaIds` (for area-specific rules), `language`, `version`.
- **Query:** `$vectorSearch` pre-filtered by `topic`, `jurisdiction`, and `supersededBy: null` (section 4).
- **What the AI gets:** the verbatim passage, its source id, URL and effective date as an evidence item, so a statement like "your landlord must give X days' notice" is quoted and cited, not generated.
- **Difficulty:** low in MongoDB, **medium overall because the work is curating accurate chunks** (30-100 of them). One index, one tool.
- **Caveat that changes the answer:** with a few dozen chunks and topics known in advance (deposit, notice, RPZ, HAP, disputes), a **tag lookup is more reliable than similarity**, and rules that depend on location (is this LEA a rent pressure zone?) must be a deterministic join on `areaId`, not retrieved by meaning. Vector Search adds value only for free-form questions. It is a thin layer behind the deterministic lookup.
- **Worth it?** The only use case I would build, and only after the core is done.

### 6. Similar properties
- **Useful?** No. "Similar property" is already defined, transparently, by the comparable score (bedrooms and type as hard filters; distance, recency, size, area, quality as weighted factors). Embedding `{bedrooms, type, floor area, location}` into a vector would throw away that explainability, make bedrooms a fuzzy match, and make results hard to verify.
- **DO NOT USE.**

### Not in your list: similar areas
"Which areas are like this one but cheaper?" is a real product feature. The signal is numeric census data (renter share, household size, age mix, density), so no language model is involved, and similarity is explainable ("similar renter share and age profile"). Rank small areas in the same county by Euclidean distance between z-scored feature vectors. That is plain arithmetic in one aggregation over a few thousand areas, so **no vector index is needed**. OPTIONAL.

## 3. Hybrid retrieval: geo + filters + vector

Your example: *2-bedroom apartments within 2 km that are semantically similar to the submitted listing.*

### The constraint that shapes the design
Atlas `$vectorSearch` pre-filters only on **fields indexed as `filter`** with simple comparison and logical operators. **It has no geospatial operators**, and `$geoNear` must be the first stage of a pipeline, so the two cannot be combined directly in either order. Geography therefore has to be handled by (a) a coarse indexed field before the vector search plus an exact radius check after, or (b) doing the geographic filtering first and computing similarity on the survivors.

### Architecture A (recommended): geo and filters first, exact similarity second. No Atlas vector index.
Runs on any MongoDB. **Verified** on 7.0.14 against 3,000 synthetic 1,024-dimension listings: identical top-5 and scores to an independent JS calculation, in about 120 ms.

```js
// qv = the submitted listing's embedding, L2-normalised (so cosine similarity = dot product)
db.rental_observations.aggregate([

 // 1. geospatial + normal MongoDB filtering, in one index scan (GEO_NEAR_2DSPHERE)
 { $geoNear: { near: pt, key: "geo", distanceField: "distM", maxDistance: 2000, spherical: true,
     query: { measure: "advertised", bedrooms: 2, propertyType: { $in: ["apartment", "studio"] },
              observedAt: { $gte: ISODate("2026-04-01") }, embedding: { $exists: true } } } },
 { $limit: 200 },                                    // nearest 200 candidates: the candidate set is small by construction

 // 2. exact cosine similarity on the survivors
 { $set: { sim: { $reduce: { input: { $zip: { inputs: ["$embedding", { $literal: qv }] } }, initialValue: 0,
     in: { $add: ["$$value", { $multiply: [{ $arrayElemAt: ["$$this", 0] }, { $arrayElemAt: ["$$this", 1] }] }] } } } } },

 // 3. rank deterministically, keep the best, drop the heavy array
 { $sort: { sim: -1, _id: 1 } }, { $limit: 10 },
 { $project: { address: 1, rent: "$rent.amount", floorAreaM2: 1, observedAt: 1,
               distM: { $round: ["$distM", 0] }, similarity: { $round: ["$sim", 4] } } }
])
```
- **Why it fits:** the geo and structured filters already shrink millions of rows to tens or hundreds; exact similarity over that set is cheap and **deterministic**, with no approximate-nearest-neighbour error and no new index.
- **Limits:** it cannot answer "most similar listing anywhere in Ireland" (it only looks at the nearest 200 that pass the filters), and it stores the embedding in every document.

### Architecture B: Atlas Vector Search (needed only for large, unlocated corpora)
```
 Person 4 (ingest)            MongoDB Atlas                                     Backend / Person 2 (query)
 ─────────────────            ─────────────────────────────────────────────     ──────────────────────────
 listing text ──embed──►  rental_observations.embedding  ◄── vector index         submitted text ──embed──► qv
                                                           (obs_vec)                                         │
                                          ┌────────────────────────────────────────────────────────────────┘
                                          ▼
   1. areas $geoWithin → nearby small-area ids   (normal MongoDB, 2dsphere, coarse)
   2. $vectorSearch with filter {measure, bedrooms, propertyType, areaId ∈ ids, observedAt}   (ANN)
   3. $match geo $geoWithin $centerSphere r          (exact radius, applied after)
   4. $set distance, similarity → envelope with evidence
```
Index definition (`obs_vec`):
```json
{ "fields": [
  { "type": "vector", "path": "embedding", "numDimensions": 1024, "similarity": "cosine" },
  { "type": "filter", "path": "measure" },
  { "type": "filter", "path": "bedrooms" },
  { "type": "filter", "path": "propertyType" },
  { "type": "filter", "path": "areaId" },
  { "type": "filter", "path": "observedAt" } ] }
```
Query:
```js
const nearAreaIds = await db.collection("areas").find(
  { level: "small_area", centroid: { $geoWithin: { $centerSphere: [pt.coordinates, (2000 + 600) / 6378100] } } }, { projection: { _id: 1 } }).map((a) => a._id).toArray();

db.rental_observations.aggregate([
 { $vectorSearch: { index: "obs_vec", path: "embedding", queryVector: qv, numCandidates: 400, limit: 100,
     filter: { measure: "advertised", bedrooms: 2, propertyType: { $in: ["apartment", "studio"] },
               areaId: { $in: nearAreaIds }, observedAt: { $gte: ISODate("2026-04-01") } } } },
 { $set: { similarity: { $meta: "vectorSearchScore" } } },
 { $match: { geo: { $geoWithin: { $centerSphere: [pt.coordinates, 2000 / 6378100] } } } },   // exact 2 km
 { $limit: 10 },
 { $project: { address: 1, rent: "$rent.amount", similarity: 1 } } ])
```
Caveats: (1) the exact radius is applied *after* the ANN search, so over-fetch (`limit: 100`) or fewer than 10 survive; (2) the `areaId` pre-filter is a coarse geographic proxy that must over-cover the radius (hence `+ 600` m); (3) results are approximate and the index is eventually consistent after writes; (4) the embedding model is fixed when the index is created.

### Choosing
| Situation | Use |
|---|---|
| Candidates are narrowed by location/type/bedrooms to a few hundred (listings, planning near a point) | **A** |
| The corpus is large, has no location filter and needs fast ANN (guidance text, a national planning-text search) | **B** |
| Fewer than ~100 chunks | skip embeddings: tags, or load them all |

## 4. If you build the one optional feature: semantic guidance retrieval

Collection `knowledge_chunks` (tiny, regular collection):
```json
{ "_id": "rtb-notice-periods-001",
  "title": "Minimum notice a landlord must give to end a tenancy",
  "text": "<verbatim passage from the official source>",
  "topic": "termination", "jurisdiction": "IE",
  "sourceId": "citizens_information", "url": "https://example.org/...", "sectionRef": "Notice periods",
  "effectiveFrom": {"$date":"2022-06-04T00:00:00Z"}, "supersededBy": null, "appliesToLeaIds": [],
  "embedding": [ "…1024 numbers…" ] }
```
Index `guidance_vec`: vector on `embedding`; filters `topic`, `jurisdiction`, `supersededBy`.
```js
db.knowledge_chunks.aggregate([
 { $vectorSearch: { index: "guidance_vec", path: "embedding", queryVector: qv, numCandidates: 50, limit: 4,
     filter: { jurisdiction: "IE", supersededBy: null, topic: { $in: ["termination", "deposits"] } } } },
 { $project: { title: 1, text: 1, sourceId: 1, url: 1, effectiveFrom: 1, score: { $meta: "vectorSearchScore" } } } ])
```
Returned to the AI as evidence items: `claim` = chunk title, `value` = the verbatim text, `refs` = `{knowledge_chunks, _id}`, `sourceIds`, `observationPeriod.from` = `effectiveFrom`.

Rules that keep it safe:
1. Location-dependent rules (rent pressure zones, caps) come from a **deterministic join on `areaId`**, never from similarity.
2. The AI quotes the passage and the source; it does not paraphrase legal text into new claims.
3. A similarity threshold: below it, return nothing and say the guidance is not covered.
4. Every chunk carries a source and an effective date; superseded chunks are filtered out.

Time estimate: curating 30-60 accurate chunks (2-3 h), embed script (30 min), index (10 min), tool (45 min), a 10-question retrieval check (30 min). Most of it is content, not MongoDB.

## 5. Similar areas without a vector index (optional)

```js
// target = the property's small-area feature vector [renterPct, avgHouseholdSize, share25to34, density], z-scored
db.areas.aggregate([
 { $match: { level: "small_area", "parents.county": "county:dublin-city", _id: { $ne: targetId }, featureVector: { $exists: true } } },
 { $set: { dist: { $sqrt: { $reduce: { input: { $zip: { inputs: ["$featureVector", { $literal: targetVec }] } }, initialValue: 0,
     in: { $add: ["$$value", { $pow: [{ $subtract: [{ $arrayElemAt: ["$$this", 0] }, { $arrayElemAt: ["$$this", 1] }] }, 2] }] } } } } } },
 { $sort: { dist: 1 } }, { $limit: 20 },
 { $lookup: { from: "rental_indexes", /* latest cell for the area's rtb_zone, cheaper than the subject's zone */ } } ])
```
Explainable (the AI can be given the per-feature differences), deterministic, and a few thousand areas is trivial. Vector Search would add an index and approximation for no gain. The vectors are computed from census data inside MongoDB, so no embedding model is involved.

## 6. Recommendation

### MUST USE
**None.** The core product does not need Vector Search, and adding it would make results less deterministic and harder to verify.

### OPTIONAL (in this order, only after the core and tests are done)
1. **Semantic guidance retrieval (#5)**: the only place where unstructured authoritative text is genuinely the answer. Build behind a deterministic topic/area lookup, with Architecture B on a small `knowledge_chunks` collection.
2. **Similar areas** (section 5): a real feature, exact arithmetic, no vector index.
3. **Similar listings re-rank (#1)**: only if Person 4 secures listing descriptions legitimately. Use Architecture A. Show as "most similar listings", **never** use similarity to change the median.

### DO NOT USE
- Similar property descriptions (#2): no input to embed.
- Similar planning applications (#3): classify at ingest instead.
- Similar previous analyses (#4): no corpus, no valid use.
- Similar properties via embeddings (#6): the comparable score already defines similarity transparently.

### Principle
Vector similarity may **rank or illustrate**; it must not **produce a number the report states**. Every stated figure keeps coming from deterministic aggregation, with evidence ids that `verifyClaims` can check.

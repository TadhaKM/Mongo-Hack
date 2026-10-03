# mend.ai — Agent layer design (Person 2)

Code: `agents/` (Python package `rentcheck_agents`). Run: `cd agents && uv sync && uv run python scripts/demo.py`.

## A. Agent architecture

Seven LLM agents would add latency, quota use and hallucination risk without adding insight. The design has
**one orchestrator, three deterministic investigators and one LLM writer, guarded by a deterministic verifier.**
The LLM never queries data and never computes numbers.

```
PropertyInput ─► Orchestrator (rules) ─ POST /property → plan with a reason per step
                    │                └ Listing extractor (Gemini, only if listing text pasted)
                    ▼
       ┌──────────── Investigators (no LLM, run concurrently) ────────────┐
       │ Rent: getRentalComparables + getRentalHistory → benchmark, Δ%, trend │
       │ Location: getNearbyTransport + getNeighbourhoodData                 │
       │ Development: getNearbyPlanning + getPropertySales                   │
       └──────────────── Evidence ledger (facts + provenance) ───────────────┘
                    ▼
       Report writer (Gemini structured output, sees only the ledger)
                    ▼
       Verifier (no LLM) → drops ungrounded claims; template fallback if the LLM fails
                    ▼
       Report JSON + agent trace → `analyses` collection; progress → SSE
```

| Component | LLM? | Tools | Receives | Returns |
|---|---|---|---|---|
| Orchestrator (`planner.py`) | no | createProperty, getProperty | user input | property doc, precision, plan steps + reasons |
| Listing extractor (`writer.extract_listing`) | Gemini | none | pasted listing text | `ListingFacts` (red flags kept only if verbatim) |
| Rent investigator | no | getRentalComparables, getRentalHistory | property_id, input | benchmark, position, spread, trend, trend-adjusted estimate |
| Location investigator | no | getNearbyTransport, getNeighbourhoodData | property_id | nearest stop per mode, counts 400/800 m, census + vacancy |
| Development investigator | no | getNearbyPlanning, getPropertySales | property_id | recent applications, large-scheme flags, sales context |
| Report writer (`writer.llm_report`) | Gemini | none | ledger only | claims citing evidence ids |
| Verifier (`verifier.py`) | no | none | claims + ledger | kept claims, dropped claims + reasons |

**Never an LLM job:** geocoding, geospatial queries, medians and percentages, date filtering, confidence scoring,
planning categorisation, deciding which steps run.

## B. Prompts
`rentcheck_agents/prompts.py` (versioned `PROMPT_VERSION`). The writer's rules:
- cite evidence ids on every fact;
- use only numbers present in the cited evidence or the renter's inputs;
- no verdict words;
- never call RTB averages "comparable properties";
- report planning status only as recorded;
- label estimates as estimates.

The extractor copies only what the listing explicitly says; any red flag it reports must appear verbatim in the text.

## C. Tool definitions (Person 4's backend; agents never touch MongoDB)
| ToolClient method | Backend endpoint | Used for |
|---|---|---|
| `create_property(payload)` | `POST /property` | geocode (or take a map point), resolve boundaries |
| `get_property(id)` | `GET /agent/getProperty/{id}` | reuse an existing property |
| `rental_comparables(id, bedrooms, property_type, period)` | `GET /agent/getRentalComparables/{id}` | benchmark row(s) + `match` metadata |
| `rental_history(id, years)` | `GET /agent/getRentalHistory/{id}` | trend (filtered client-side to the same beds/type) |
| `nearby_transport(id, radius_m)` | `GET /agent/getNearbyTransport/{id}` | GTFS stops within 800 m |
| `neighbourhood(id)` | `GET /agent/getNeighbourhoodData/{id}` | Census 2022 SAPS + CSO vacancy for the small area |
| `nearby_planning(id, radius_m)` | `GET /agent/getNearbyPlanning/{id}` | applications within 1 km |
| `property_sales(id, radius_m, years)` | `GET /agent/getPropertySales/{id}` | PPR context (never treated as rent) |

There are three interchangeable clients: `http` (default, over the network), `inprocess` (when mounted inside
Person 4's app) and `mock` (fixture shaped exactly like Person 4's responses). Set the client with `TOOL_CLIENT`.

## D. Data flow
1. The orchestrator builds `PropertyInput` from one of: a map click (lat/lng), an Eircode/address, or an existing `property_id`.
2. It calls `POST /property`. For an Eircode/address the backend geocodes it.
   - If geocoding fails, the orchestrator uses the Eircode routing-key centroid (e.g. D08) and labels the result `precision=routing_area`.
3. `getProperty` geography feeds the plan. Example: an unresolved `rtb_area` produces "will report limited local data" rather than using another area.
4. The investigators run concurrently. Each writes Evidence + a Finding to the ledger, and each step emits an SSE event.
5. The writer turns the ledger into a report, the verifier filters it, and the template fills any gaps.
6. The result is persisted to `analyses` with `report` and `agent` (plan, events, tool_calls with timings, evidence, findings, dropped claims, model, prompt version).

## E. Evidence architecture
```
Conclusion (Claim.text) ─► evidence_ids ─► Evidence{statement, values[], source{organisation, dataset, source_url,
                                             retrieved_at, dataset_date}, period, geography, tool{name, params},
                                             match_method, derived, confidence, confidence_reasons[], caveats[]}
```
Example claim: "Asking €2,200 is 9.5% above the RTB average of €2,010". It cites:
- `ev_rent_benchmark` (RTB, 2025 Q4, Rialto, exact match, getRentalComparables{bedrooms:2, property_type:apartment});
- `ev_rent_position`, derived from the benchmark.

Confidence is rule-based:
- **high**: exact match, ≤2 quarters old.
- **medium**: one relaxation, or 3–6 quarters old.
- **low**: bedroom relaxation, >6 quarters old, or a projection.

The RTB data is aggregate: there are no individual listings and no tenancy counts. So we never say "37 comparable
properties". We say "the RTB average for new 2-bed apartment tenancies in X". If the backend later adds
`rent.n_tenancies`, a weighted median is computed automatically.

## F. Hallucination prevention
1. Numbers come from Python (`stats.py`), never from the LLM.
2. The writer sees only the ledger: no raw data, no web.
3. The writer uses Gemini structured output (flat schema, temperature 0.2).
4. The verifier drops a claim that cites an unknown id, a fact with no evidence, any number absent from the cited evidence or user input, or verdict words. Every drop is logged in `agent.dropped_claims`.
5. If the LLM fails (429, timeout, invalid JSON), a template report built from evidence statements is used. The demo works with no API key.
6. Rent guard: with an unresolved RTB area the backend query has no location filter. The agent refuses to benchmark and says so.
7. Empty sections are explicit (`status: limited|unavailable` + limitations).
8. There is no good/bad verdict field anywhere.

Covered by tests: `tests/test_verifier.py`, `tests/test_pipeline_mock.py::test_llm_hallucinations_are_dropped`.

## G. Report structure (`analyses.report`, also the final SSE event)
`{analysis_id, property, summary[], sections[], questions_to_ask[], sources[], limitations[], evidence[], generated_by, model, disclaimer}`

Sections, each `{id, title, status, confidence, claims[], metrics[], items[], evidence_ids[], limitations[]}`:
`overview, rent_analysis, rent_trend, transport, neighbourhood, developments, considerations`.

`items` carries rows for tables and maps:
- RTB quarters
- stops with GeoJSON
- planning applications with GeoJSON, categories and units

Questions come from finding flags, e.g. above benchmark → "Can you confirm the rent previously registered with the RTB…".

## H. Hackathon demo flow (2–3 min)
1. **0:00** Problem: "Is €2,200 for a 2-bed in Dublin 8 fair? Renters sign blind."
2. **0:20** Click the map in Dublin 8 and enter €2,200, 2-bed apartment. The plan appears, with a reason per step.
3. **0:40** Live steps tick:
   - property identified (small area, local authority);
   - RTB benchmark and difference;
   - Luas distance;
   - planning applications nearby.
4. **1:20** The report renders. Click an evidence chip: it shows dataset, quarter, area, the tool call and confidence.
5. **1:50** Hard case: a rural 5-bed. "Not enough local RTB data to benchmark", low confidence, nothing invented.
6. **2:20** MongoDB and the agents: geospatial `$near` for stops and planning, `$geoIntersects` for boundaries,
   every analysis stored with its full evidence trail, and a verifier that removes unsupported claims.

Backup: `uv run python scripts/demo.py` (terminal) works offline on the mock data.

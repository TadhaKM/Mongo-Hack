# Person 2 → team: what the agent layer needs and provides

## For Person 4 (backend). Two lines to mount the agents in your app
```python
# app/main.py
from rentcheck_agents.api import router as ai_router
app.include_router(ai_router)          # env: TOOL_CLIENT=inprocess  (uses your services + `analyses` collection)
```
Install: `pip install -e ../agents` (or `uv pip install -e ../agents`). Alternatively run it standalone:
`cd agents && TOOL_CLIENT=http RENTCHECK_API_URL=http://localhost:8000 uv run uvicorn rentcheck_agents.api:app --port 8001`.

### Issues found reading the backend (please fix; my code already guards against each)
1. **`app/api/analysis.py` router has no `prefix="/analysis"`.** The routes are `/{analysis_id}/report` etc., so
   the documented `GET /analysis/{id}/report` 404s and `tests/test_api_contract.py` fails.
   Fix: `APIRouter(prefix="/analysis", tags=["analysis"])`. Then move `POST /analyse` to its own router, or define it with an absolute path.
2. **`rtb_area` is never resolved** (`app/geo/boundaries.py` only does small area, ED, LEA, LA and county). So
   `rental_comparables` runs with **no area filter** and returns rents from other areas. The agent refuses to
   benchmark in that case, which means **no rent benchmark at all in the demo until this is fixed.**
   Suggested fix, using CSO RIQ02 (below): store each RIQ02 location with an exact code, and map the property to it.
   For the demo, an explicit lookup table from small area / LEA code to RIQ02 location code is fine. Never match on names.
3. `rental_history` ignores bedrooms/type and is capped at `years*4` rows across *all* profiles, so it only covers about 1 year.
   Please add `property.bedrooms` / `property.type` filters. (I filter client-side and merge in the comparables series.)
4. `planning_applications.application_date` is a raw string, and ArcGIS returns epoch ms. Store it as a Date.
   It would also help to return `num_residential_units` (the `NumResidentialUnits` field) and `decision_date`. I parse dates defensively.
5. Census values are raw CSV columns. I read these canonical keys: `population_total`, `households_total`,
   `private_rented_pct`, `car_available_pct`, and from vacancy `vacancy_rate_pct`. Please emit those names.
6. **`scripts/seed_demo.py` crashes** (`KeyError: '_record_key'`): the `properties` doc has no `_record_key`, so `make seed`
   fails before seeding anything. Add `"_record_key": "property:demo"` to the property dict.
7. Because of issue 1, **`GET /health` returns `{"detail": "Analysis not found"}`**: the prefix-less `/{analysis_id}`
   route is registered before `/health` and swallows it.

8. **Planning ingestion crashes**: `app/ingestion/planning.py` calls `ImportResult(...)` but never imports it, so it raises `NameError`
   (add `ImportResult` to the `from app.ingestion.base import ...` line).
9. `app/ingestion/utils.first()` canonicalises the candidate names but not the row keys. CamelCase ArcGIS fields
   (`ApplicationNumber`, `ReceivedDate`, `DevelopmentDescription`, `Decision`) never match, so applications would be
   stored without ref/date/proposal. Fix: canonicalise `row` keys inside `first()`, and add those ArcGIS names as aliases.
10. `nearby_planning` returns the 100 nearest applications **of any year**, and `nearby_transport` returns at most 50 stops.
    Please add an `application_date >= since` filter (or a `since` query param) so recent schemes farther out aren't cut off.
    Until then the agent words these counts as minimums ("at least…").

Verified today: I ran your API unchanged (with the seed patched in a scratch copy) on a local MongoDB 8. My agents
(`TOOL_CLIENT=http` and `inprocess`) produce a full report for `property_demo`. A new map-click property gets "limited"
rent analysis until issue 2 is fixed.

## For Person 1 (MongoDB). Facts about the rent data (verified today)
- **Use CSO PxStat RIQ02** ("RTB Average Monthly Rent Report"):
  `https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadDataset/RIQ02/JSON-stat/2.0/en`.
  - Dimensions: quarter (2007Q4–**2025Q4**) × bedrooms (All, One, Two, Three, Four plus, …) × property type
    (All, Detached, Semi-detached, Terrace, Apartment, Other flats) × **446 locations**, including Dublin neighbourhoods like
    "Rialto, Dublin 8".
  - Values are averages with **no tenancy counts**, and 83% of cells are null in the latest quarter.
  - The "Dublin 8"-style district rows stop at 2021; use the neighbourhood rows.
  - Watch the label quirks: "Kilmainham , Dublin 8" has a stray space before the comma.
- The RTB/ESRI Rent Index PDF (Q1 2026) is standardised by LEA but **not split by bedrooms/type**, and has no counts.
- There is no tenancy-level open data. The RTB Rent Register web tool is search-only, so don't scrape it.
  The app can only point users to it.
- So "comparables" are **aggregate cells**. The agents word it that way.

## For Person 3 (frontend). Contract
- `POST /ai/analyse` (body below) returns **SSE**. Each message is `event: <type>` + `data: <Event JSON>`:
  `{type: "step"|"plan"|"report"|"error", analysis_id, step, status: "running"|"done"|"skipped"|"failed", label, detail, data, ts}`.
  - Show `label`/`detail` per `step`.
  - `plan.data.steps[]` = `{step, label, reason}`.
  - The final `report` event's `data` is the full report.
- `POST /ai/analyse/sync` returns `{analysis_id, report, events}` (no streaming).
- `GET /ai/analysis/{id}` returns the stored doc (`report`, `agent.tool_calls`, `agent.evidence`, …).
- Body:
  ```json
  {"latitude": 53.3392, "longitude": -6.2905, "address": "optional", "eircode": "D08 XXXX (optional)",
   "monthly_rent": 2200, "bedrooms": 2, "property_type": "apartment", "floor_area_m2": null,
   "furnished": null, "listing_text": null}
  ```
  It needs lat/lng (map click), **or** an eircode/address.
- Report shape: `docs/agent-design.md` §G. Each claim has `evidence_ids`; look them up in `report.evidence[]` for
  the evidence popover (statement, source.dataset/organisation/source_url, period, geography, confidence, caveats, tool).
- Map layers: `sections[id=transport].items[].location` (stops) and `sections[id=developments].items[].location`
  (applications), plus `report.property.location`.
- Chart: `sections[id=rent_trend].items[] = {period, average_rent_eur}`.
- A sample report JSON can be generated offline: `cd agents && uv run python scripts/demo.py --no-llm --json sample_report.json`.

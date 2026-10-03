# Agent A: App Shell, Data Layer and Report

You are **Agent A** on the RentCheck AI frontend. Another coding agent, **Agent B**, is building the map and browse experience in the same repo at the same time. Their brief is `docs/agents/AGENT_B_MAP.md`.

**Your job:** the project scaffold, the typed data layer (mock API, composables, SSE), and everything that appears *inside* the side panel: the property card, the property form, the live agent progress, and the evidence-backed report, plus the printable report page.

**You start first.** Agent B is blocked on your scaffold for about 30 minutes (they spike the map on a dev page meanwhile). Get task A0 committed fast.

Section 1 is shared with Agent B word for word. Section 2 is yours alone.

## 1. Shared context (identical in both agent files)

### 1.0 The team and where we fit

RentCheck AI is a 4-person hackathon project. **It is one product, not four separate projects.** We are Person 3, the frontend. Both agents work for Person 3.

```text
                 ┌───────────────────┐
                 │   PERSON 3        │
                 │   FRONTEND (us)   │
                 └─────────┬─────────┘
                           │  HTTP + SSE (contract in 1.4 / 1.5)
                           ↓
                 ┌───────────────────┐
                 │   PERSON 4        │
                 │   BACKEND / API   │
                 └─────────┬─────────┘
                           │
             ┌─────────────┴─────────────┐
             ↓                           ↓
   ┌──────────────────┐        ┌──────────────────┐
   │   PERSON 2        │        │   PERSON 1        │
   │   AI AGENTS       │◄──────►│   MONGODB         │
   │                   │        │   DATA LAYER      │
   └──────────────────┘        └────────┬───────────┘
                                       │
                                       ↓
                              ┌─────────────────┐
                              │ REAL IRISH DATA │
                              │ RTB             │
                              │ CSO             │
                              │ NTA             │
                              │ Planning        │
                              │ PPR             │
                              └─────────────────┘
```

What this means for us:

- **The frontend talks only to Person 4's API.** Never to MongoDB, never to the agents directly. Everything goes through the endpoints in 1.5.
- **The contract in 1.4 / 1.5 is the thing to agree with Person 4.** Our mock routes implement it exactly, so the switch to the real backend is one environment variable. If Person 4's shapes differ, Agent A adapts them inside the composables; components never change.
- **Data sources we display** (in `Source.name` / `publisher`): RTB Rent Index (Residential Tenancies Board), CSO Census (Central Statistics Office), NTA GTFS (National Transport Authority), planning applications (local authority / national planning data), PPR (Property Price Register, sale prices, useful as area context). All data must be legitimate. Listings shown as pins that are not from a real source are labelled "Sample listing".
- **Agent stages map to the backend pipeline:** Person 1's geospatial and data queries feed `geocode`, `market`, `comparables`, `transport`, `area`, `planning`; Person 2's agents produce `claims`, the summary and the `report` stage.

### 1.1 The product

RentCheck AI checks an Irish rental against real rental, transport, census and planning data stored in MongoDB. AI agents on the backend produce an evidence-backed "Know Before You Rent" report. **We build only the frontend.** The backend is built by two other people; until it is ready we run against mock server routes with the exact same contract (section 1.5).

The experience is **map-first, like Google/Apple Maps**:

1. A full-screen 3D map of Dublin shows rental listings as **price pins** (`€2,200`), coloured by how the rent compares with the local median.
2. Clicking a pin flies the camera in (pitch 60°), highlights the building in 3D, and opens a **property card** in the side panel (bottom sheet on mobile).
3. "Run full check" starts the backend agents. The panel shows **live agent stages** while the map orbits slowly and fills with comparables, transport stops and planning applications.
4. The panel turns into the **report**: verdict, numbers, evidence, charts, comparables, location, area, planning, sources. Every AI claim has an Evidence button.
5. "Open full report" goes to a printable page.
6. Unlisted property: search an address (or right-click / long-press the map) to drop a pin, fill a short form, run the same check.

Principle: **numbers first, conclusion second, evidence one click away.** RentCheck is a decision-support tool, not a guarantee. Say so in the UI.

### 1.2 Stack (already decided, do not change)

| Concern | Package |
|---|---|
| Framework | Nuxt 4 (`app/` directory), TypeScript, Vue 3 `<script setup>` |
| UI | shadcn-vue + shadcn-nuxt (on reka-ui), Tailwind CSS v4 (`@tailwindcss/vite`), tailwindcss-animate, class-variance-authority, tailwind-merge, clsx, @lucide/vue |
| Map | maplibre-gl, style from OpenFreeMap: `https://tiles.openfreemap.org/styles/liberty` (3D buildings in layer `building-3d`, heights in `render_height` / `render_min_height`). Fallback style: `https://tiles.openfreemap.org/styles/positron` |
| Server state | @tanstack/vue-query |
| Forms | vee-validate + @vee-validate/zod + zod |
| Tables | @tanstack/vue-table |
| Charts | @unovis/vue |
| Drawers / sheets | vaul-vue (mobile bottom sheet), shadcn `Sheet` (desktop) |
| Toasts | vue-sonner (non-blocking only) |
| Utilities | @vueuse/core (`useEventSource`, `useMediaQuery`, `useDebounceFn`) |
| Animation (optional) | gsap |

No other dependencies without writing it in `docs/agents/HANDOFF.md` first. **Agent A owns `package.json`**; Agent B asks A to add anything.

### 1.3 Ownership (who may edit what)

Never edit a file the other agent owns. Ask in `docs/agents/HANDOFF.md` instead.

| Path | Owner |
|---|---|
| `package.json`, `nuxt.config.ts`, `app/app.vue`, `app/assets/css/main.css`, `app/components/ui/**` (shadcn) | **A** |
| `app/types/api.ts`, `app/lib/schemas.ts`, `app/lib/format.ts` | **A** |
| `app/composables/api/**` (all data fetching, SSE) | **A** |
| `server/**` (mock API + fixtures) | **A** |
| `app/components/property/**`, `app/components/analysis/**`, `app/components/report/**`, `app/components/evidence/**`, `app/components/charts/**` | **A** |
| `app/pages/analysis/[id]/report.vue` | **A** |
| `app/composables/useMapSelection.ts` | **B** |
| `app/lib/map/**` (map config, helpers) | **B** |
| `app/components/map/**`, `app/components/shell/**`, `app/components/search/**` | **B** |
| `app/pages/index.vue`, `app/pages/dev/map.vue` | **B** |
| `docs/agents/HANDOFF.md` | both (append only) |

### 1.4 Types: `app/types/api.ts` (A writes this verbatim at the start; both code against it)

```ts
export type Verdict = 'below_market' | 'in_line' | 'above_market'
export type ConfidenceLevel = 'high' | 'medium' | 'low'
export type PropertyType = 'apartment' | 'house' | 'duplex' | 'shared_room'
export type Furnished = 'furnished' | 'unfurnished' | 'unknown'
export interface LngLat { lng: number; lat: number }

export interface Source { id: string; name: string; publisher: string; url: string; data_period: string; retrieved_at: string }
export interface Evidence { id: string; label: string; value: string | number; scope: string; source_id: string; observations?: number }
export interface Claim { id: string; text: string; evidence_ids: string[] }
export interface Confidence { level: ConfidenceLevel; reasons: string[] }

// Map browsing
export interface ListingSummary {
  id: string; rent: number; bedrooms: number; property_type: PropertyType; area: string
  location: LngLat; verdict: Verdict; diff_pct: number; is_sample: boolean
}
export interface ListingsResponse { items: ListingSummary[] }
export interface Listing extends ListingSummary {
  address: string; floor_area_m2: number | null; furnished: Furnished; listing_url: string | null
  area_median: number; nearest_stop: { name: string; mode: TransportMode; walk_min: number } | null
}
export interface GeocodeResult { place_id: string; label: string; location: LngLat; area: string }
export interface GeocodeResponse { results: GeocodeResult[] }

// Analysis
export type StageKey = 'geocode' | 'market' | 'comparables' | 'transport' | 'area' | 'planning' | 'report'
export type StageStatus = 'pending' | 'running' | 'done' | 'failed'
export interface Stage { stage: StageKey; status: StageStatus; label: string; detail?: string; counts?: Record<string, number> }
export type AnalysisEvent =
  | ({ type: 'stage'; at: string } & Stage)
  | { type: 'complete' }
  | { type: 'failed'; error: ApiError['error'] }

export interface AnalyseRequest {
  property_id?: string            // when started from a listing pin
  address?: string; place_id?: string
  location?: LngLat               // dropped pin with no geocoded address
  monthly_rent?: number; bedrooms?: number; property_type?: PropertyType
  floor_area_m2?: number; furnished?: Furnished; listing_url?: string
}
export interface AnalyseResponse { id: string; status: 'running'; events_url: string }

export interface Analysis {
  id: string; status: 'running' | 'complete' | 'failed'; created_at: string
  input: Required<Pick<AnalyseRequest, 'monthly_rent' | 'bedrooms' | 'property_type'>> & AnalyseRequest & { address: string }
  property: { location: LngLat; area: string; eircode: string | null }
  stages: Stage[]
  summary: null | {
    verdict: Verdict; asking: number; median: number; p10: number; p90: number
    difference_eur: number; difference_pct: number; percentile: number
    observations: number; period: { from: string; to: string }; radius_m: number
    confidence: Confidence; claims: Claim[]
  }
  trend: null | { series: { period: string; median: number }[]; source_id: string; change_12m_pct: number }
  area: null | { stats: { key: string; label: string; value: number; unit: 'pct' | 'count' | 'eur'; national: number | null; geography: string; year: number; source_id: string }[]; claims: Claim[] }
  evidence: Evidence[]; sources: Source[]; limitations: string[]
  error: ApiError['error'] | null
}

export interface Comparable {
  id: string; rent: number; bedrooms: number; property_type: PropertyType; floor_area_m2: number | null
  date: string; distance_m: number; similarity: number; location: LngLat; source_id: string
}
export interface ComparablesResponse { items: Comparable[]; stats: { count: number; median: number; p10: number; p90: number } }

export type TransportMode = 'luas' | 'dart' | 'rail' | 'bus'
export interface TransportStop { id: string; name: string; mode: TransportMode; distance_m: number; walk_min: number; routes: string[]; location: LngLat }
export interface Amenity { id: string; category: 'supermarket' | 'gp' | 'pharmacy' | 'school' | 'park'; name: string; distance_m: number; location: LngLat }
export interface LocationResponse { transport: TransportStop[]; amenities: Amenity[]; claims: Claim[]; source_ids: string[] }

export type PlanningStatus = 'granted' | 'pending' | 'refused' | 'appealed'
export interface PlanningApplication {
  id: string; reference: string; distance_m: number; status: PlanningStatus
  received_date: string; decision_date: string | null; summary: string; relevance: string; url: string; location: LngLat
}
export interface PlanningResponse { items: PlanningApplication[]; claims: Claim[]; source_ids: string[] }

export interface ReportResponse {
  analysis: Analysis; comparables: ComparablesResponse; location: LocationResponse; planning: PlanningResponse
  generated_at: string; disclaimer: string
}

export interface ApiError { error: { code: string; message: string; details?: Record<string, unknown> } }
```

Changing this file: A edits it, then appends a HANDOFF entry describing the change. B never edits it.

### 1.5 API endpoints

Base URL: `useRuntimeConfig().public.apiBase`, default `/api` (the Nuxt mock routes). Set `NUXT_PUBLIC_API_BASE` to the real backend when ready.

| Method & path | Returns | Notes |
|---|---|---|
| `GET /listings?bbox=minLng,minLat,maxLng,maxLat&bedrooms=&max_rent=&type=` | `ListingsResponse` | Backend uses MongoDB `$geoWithin`. Max 300 items. |
| `GET /listings/{id}` | `Listing` | |
| `GET /geocode?q=` | `GeocodeResponse` | Address or Eircode, Ireland only |
| `POST /analyse` | `AnalyseResponse` (202) | Body `AnalyseRequest`. Either `property_id`, or `address` + `monthly_rent` + `bedrooms` + `property_type` |
| `GET /analysis/{id}/events` | SSE stream of `AnalysisEvent` | Ends with `complete` or `failed` |
| `GET /analysis/{id}` | `Analysis` | Polling fallback and source of truth |
| `GET /analysis/{id}/comparables` | `ComparablesResponse` | Available once stage `comparables` is `done` |
| `GET /analysis/{id}/location` | `LocationResponse` | Once stage `transport` is `done` |
| `GET /analysis/{id}/planning` | `PlanningResponse` | Once stage `planning` is `done` |
| `GET /analysis/{id}/report` | `ReportResponse` | Once `complete` |

Errors are always `ApiError` with an HTTP 4xx/5xx status. Known codes: `ADDRESS_NOT_FOUND`, `ADDRESS_AMBIGUOUS` (details.candidates: GeocodeResult[]), `OUT_OF_COVERAGE`, `ANALYSIS_FAILED`, `NOT_READY`.

### 1.6 Shared composables (the seam between A and B)

**Owned by A** in `app/composables/api/`. B imports these and never calls `$fetch` directly:

```ts
useListings(bbox: Ref<[number, number, number, number] | null>, filters: Ref<{ bedrooms?: number; max_rent?: number; type?: PropertyType }>)
  // -> vue-query result of ListingsResponse; keepPreviousData so pins don't flash on pan
useListing(id: Ref<string | null>)            // -> Listing
useGeocode(q: Ref<string>)                     // -> GeocodeResponse, debounced 250ms, enabled when q.length >= 3
useCreateAnalysis()                            // -> mutation(AnalyseRequest) => AnalyseResponse
useAnalysis(id: Ref<string | null>)            // -> Analysis, kept live by SSE (falls back to 1.5s polling)
useStageDone(id: Ref<string | null>, stage: StageKey) // -> ComputedRef<boolean>
useComparables(id) / useLocationData(id) / usePlanning(id) // enabled only when their stage is done
useReport(id)
```

**Owned by B** in `app/composables/useMapSelection.ts` (global state via Nuxt `useState`). A imports it to sync tables and cards with the map:

```ts
export type FeatureId = `listing:${string}` | `cmp:${string}` | `stop:${string}` | `plan:${string}` | `amenity:${string}`
export interface DroppedPin { location: LngLat; address?: string; place_id?: string }

useMapSelection(): {
  selectedListingId: Ref<string | null>
  activeAnalysisId: Ref<string | null>
  droppedPin: Ref<DroppedPin | null>
  hoveredFeature: Ref<FeatureId | null>
  selectListing(id: string | null): void      // map flies in, panel shows PropertyCard
  startAnalysis(id: string): void             // panel shows AnalysisPanel, map shows analysis layers
  dropPin(pin: DroppedPin | null): void       // panel shows PropertyForm prefilled
  hover(id: FeatureId | null): void           // pin/row highlight both ways
  focusFeature(id: FeatureId): void           // map flies to that feature
  reset(): void                               // back to browse
}
```

### 1.7 Components that cross the seam

**A builds, B renders inside the shell's side panel:**

| Component | Props / emits | Shown when |
|---|---|---|
| `<PropertyCard :listing-id>` | Calls `useCreateAnalysis`, then `useMapSelection().startAnalysis(id)` | `selectedListingId` set, no active analysis |
| `<PropertyForm :initial="DroppedPin">` | Same: creates the analysis, then `startAnalysis(id)` | `droppedPin` set |
| `<AnalysisPanel :analysis-id>` | Progress stages, then report sections, "Open full report" link | `activeAnalysisId` set |

**B builds, A renders:**

| Component | Props | Used in |
|---|---|---|
| `<MiniMap :center="LngLat" :points="{ id: FeatureId; location: LngLat }[]">` | Static, non-interactive, flat (pitch 0) | Printable report page |

**B builds and renders itself:** `MapShell`, `AnalysisMap`, `ListingList` (the browse list of visible listings), `SearchBar`, `MapFilters`.

Panel routing in the shell, in priority order: `activeAnalysisId` → `AnalysisPanel`; `selectedListingId` → `PropertyCard`; `droppedPin` → `PropertyForm`; else `ListingList`. A back arrow calls `reset()` (or steps back one level).

### 1.8 Design tokens (A defines in `main.css`; B uses the CSS variables, never hard-coded hex)

| Token | Meaning |
|---|---|
| `--verdict-below` (green), `--verdict-inline` (slate), `--verdict-above` (amber) | Price pins, verdict card, comparable dots (relative to asking rent) |
| `--planning-granted` (green), `--planning-pending` (blue), `--planning-refused` (red), `--planning-appealed` (purple) | Planning badges and map squares |
| `--brand` (blue, `#2563eb`) | Selected pin, selected building extrusion, primary buttons. (Not `--accent`: shadcn already uses that for its grey hover surface.) |
| `--transport-luas` (purple), `--transport-dart` (green), `--transport-rail` (dark green), `--transport-bus` (yellow) | Transport icons |

Formatting helpers live in `app/lib/format.ts` (A): `eur(2200) → "€2,200"`, `metres(350) → "350 m"`, `pct(11.1, { sign: true }) → "+11%"`, `period('2025-01','2026-09') → "Jan 2025 to Sep 2026"`.

### 1.9 How we work together

- **Same repo, same branch (`main`)**. Edit only your own paths (1.3). Pull/rebase before every commit; small commits with clear messages.
- **`docs/agents/HANDOFF.md`** is the message board. Append entries, never rewrite others':
  `- [A→B] 13:40 useListings ready, returns keepPreviousData. Fixture has 60 listings around Dublin 8.`
  Types of entry: `READY` (something the other side can now use), `ASK` (a request), `CHANGE` (a contract change), `BLOCKED`.
- Read HANDOFF.md at the start of every task.
- If the contract above does not cover something, prefer adding to your own side over changing the shared one. If a shared change is unavoidable, A makes it and logs a `CHANGE`.
- Mock first, real backend later. Nothing in components should know whether the API is mocked.
- No secrets in the repo. `.env` is gitignored; `.env.example` lists names only.

### 1.10 Checkpoints (T = when both agents start)

| Time | A has | B has | Check together |
|---|---|---|---|
| T+0:30 | Scaffold, deps, shadcn, tokens, `api.ts`, HANDOFF.md committed | `/dev/map` page: Liberty map, 3D buildings, pitch/fly-to working | `npm run dev` works for both |
| T+1:15 | Mock routes + fixtures, all API composables, `PropertyCard` | Price pins from `useListings`, click → select → fly-in + building highlight, `MapShell` panel routing | Click a pin → PropertyCard shows real fixture data |
| T+2:15 | `AnalysisPanel` with live stages + verdict card + evidence drawer + distribution chart | Analysis layers (radius, comparables, transport, planning), orbit while running, hover sync | **Full happy path:** pin → card → Run full check → stages + map fills → report |
| T+3:00 | Remaining report sections, printable report, error states | Search + drop pin, filters, ListingList, 2D/3D toggle, mobile sheet | Run on a phone-sized viewport |
| T+3:30 | **Feature freeze.** Only bug fixes and polish. | | Rehearse the demo twice |

### 1.11 Demo we are building towards (2 minutes)

1. Map of Dublin 8 in 3D with price pins. "RentCheck checks any Irish rental against real data."
2. Click an amber `€2,200` pin. Camera swoops in, building lights up blue, property card shows "+11% vs area median".
3. "Run full check." Stages tick (`✓ 42 comparable properties found`…) while the camera orbits and comparables, Luas stops and planning sites appear.
4. Report: "Above market by 11%. 37 comparables, median €1,980, higher than 78% of them." Click Evidence: source, period, observation count.
5. Hover a comparables row, its dot pulses on the map. Point at a planning site: "120-unit scheme approved nearby."
6. "Open full report." Printable, with sources and the disclaimer.

**Never cut:** price pins + fly-in, live stages, verdict card with numbers, evidence drawer.

### 1.12 Original frontend brief (source requirements)

This is the brief Person 3 was given. Everything above implements it. One deliberate change: the brief's "landing page → enter property" flow became **map-first** (browse pins, or search / drop a pin to enter a property). The form, stages, report, evidence, map, charts, trust signals and API contract it asks for are all still covered. The screenshot/PDF upload was cut for time.

> I am building the frontend for a 4-person hackathon project called *RentCheck AI*.
>
> RentCheck AI analyses a rental property using legitimate Irish rental, property, transport, census and planning data stored in MongoDB, with AI agents producing an evidence-backed "Know Before You Rent" report.
>
> You are responsible ONLY for the frontend and user experience.
>
> The frontend needs to make a technically complex backend feel extremely simple.
>
> **1. Product flow.** Design the complete user journey: Landing page → Enter property → Analyse → Agent progress → Results → Detailed evidence → Comparable properties → Location map → Final report. Explain every screen.
>
> **2. Property input.** Design a clean form allowing the user to enter: address, monthly rent, bedrooms, property type, floor area, furnished/unfurnished, optional listing URL, optional screenshot/PDF. Explain validation and what should be mandatory vs optional.
>
> **3. Analysis experience.** While the agents are running, don't show a generic loading spinner. Show meaningful stages such as:
> ✓ Property identified · ✓ Rental market data retrieved · ✓ 42 comparable properties found · ✓ Transport analysed · ✓ Local planning data analysed · ● Generating report.
> Explain how this should be implemented using backend events/status updates.
>
> **4. Main report.** Design the final report UI. Sections should include:
> - PROPERTY SUMMARY: €2,200/month, 2 bedrooms, Dublin 8
> - RENTAL ANALYSIS: comparable range, median comparable rent, historical trend, current asking rent, difference
> - COMPARABLE PROPERTIES: distance, rent, bedrooms, property type, date, similarity
> - LOCATION: nearby transport, distance to stops, relevant amenities, map
> - AREA: population/housing context, vacancy information, relevant statistics
> - PLANNING: nearby applications, distance, status, date, summary
> - EVIDENCE: every major AI claim should have a source/evidence button.
>
> **5. Map.** Design how MongoDB geospatial results should be displayed. Show: user property, comparable properties, transport stops, relevant planning applications. Explain markers, filters and interactions.
>
> **6. Explainability.** We don't want the AI to simply say "Your rent is expensive." Instead show "€2,200 asking rent", "Comparable median: €1,980", "37 comparable observations", "Comparable period: 2025-2026". Then explain the conclusion. Design a UI that makes the evidence easy to understand.
>
> **7. Visualisations.** Determine which charts would actually be useful. Potential charts: historical rent trend, comparable rent distribution, rent vs local median, distance to transport, property comparison. Avoid unnecessary charts.
>
> **8. User trust.** Design ways to show: data source, data date, number of observations, confidence, limitations. The user should understand that RentCheck is a decision-support tool, not a guarantee.
>
> **9. Backend API contract.** Define the JSON responses the frontend expects. For example: `POST /analyse`, `GET /analysis/{id}`, `GET /analysis/{id}/comparables`, `GET /analysis/{id}/location`, `GET /analysis/{id}/planning`, `GET /analysis/{id}/report`. Define the request and response structures.
>
> **10. Tech stack.** Recommend a realistic frontend stack for a hackathon. We want: fast development, good map support, good charts, responsive design, clean UI, easy backend integration.
>
> **11. Hackathon demo.** Design the ideal 2-minute frontend demo. It should feel like: "Enter an address → watch RentCheck investigate it → receive a professional report."
>
> Finally provide: A. Screen-by-screen design · B. Component structure · C. API contracts · D. State management · E. Map architecture · F. Chart recommendations · G. Loading/agent progress UI · H. Error states · I. Mobile/desktop considerations · J. Exact MVP features to build first.
>
> Prioritise polish and a compelling demo over implementing every possible feature.

Where each brief item lives in this document: flow and screens → 1.1, 1.7, 1.11; input → A5; stages → A2, A6, B7; report → A7 to A10; map → B4 to B9; explainability and evidence → A7; charts → A8; trust → A7, A10; API → 1.4, 1.5; stack → 1.2; demo → 1.11; state → 1.6; errors → A12; mobile/desktop → B3, B11; MVP order → task order in section 2.

---

## 2. Agent A tasks (in order)

Tick boxes as you go. After each task: commit, then append a `READY` line to HANDOFF.md if B can use it.

### A0. Scaffold (target: 30 min, B is waiting)
- [ ] `npx nuxi@latest init` (Nuxt 4, `app/` dir). TypeScript strict.
- [ ] Install every package in 1.2 (including `maplibre-gl` for B) and `@nuxtjs/...` modules needed: `shadcn-nuxt`. Tailwind v4 via `@tailwindcss/vite` in `nuxt.config.ts`.
- [ ] `npx shadcn-vue@latest init`, then add: `button card badge input label select tabs sheet popover tooltip skeleton separator table toggle-group scroll-area alert sonner`.
- [ ] `app/assets/css/main.css`: shadcn theme variables plus every token in 1.8 (light and dark).
- [ ] Vue Query plugin (`app/plugins/vue-query.ts`), `runtimeConfig.public.apiBase = '/api'`.
- [ ] `app/types/api.ts` verbatim from 1.4. Empty stubs for `app/lib/format.ts`, `app/lib/schemas.ts`.
- [ ] `app/app.vue` with `<NuxtPage />` and `<Toaster />`.
- [ ] `docs/agents/HANDOFF.md` with a header, and copy both agent briefs into `docs/agents/`.
- [ ] `.gitignore` includes `.env`; `.env.example` has `NUXT_PUBLIC_API_BASE=`.
- [ ] Commit. HANDOFF: `[A→B] READY scaffold`.

### A1. Formatting and schemas
- [ ] `format.ts`: `eur`, `metres`, `walk`, `pct`, `period`, `relativeDate`. Use `Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })`.
- [ ] `schemas.ts`: zod `propertyFormSchema` for the form (see A5 rules). Export `type PropertyFormValues = z.infer<...>`.

### A2. Mock API (`server/api/**`) and fixtures (`server/fixtures/**`)
Make the mocks feel real: they are what we demo if the backend is late.
- [ ] `listings.json`: **60 sample listings** within about 2 km of Dublin 8 (centre roughly `-6.283, 53.338`). Realistic rents for 1 to 3 beds (about €1,500 to €3,000), mixed types, `is_sample: true`, verdicts consistent with `diff_pct` (below -5 / within ±5 / above +5). Make sure **one 2-bed apartment at €2,200, +11%, above_market** sits on a real building (this is the demo pin; id `lst_demo`).
- [ ] `GET /api/listings` filters by bbox and filters; `GET /api/listings/[id]`.
- [ ] `GET /api/geocode` returns matches from a small fixture of Dublin addresses (include the demo address); `ADDRESS_NOT_FOUND` for unknowns.
- [ ] `POST /api/analyse` returns `{ id: 'an_demo', ... }` (any input; keep a map of id → input so the report echoes the right rent).
- [ ] `GET /api/analysis/[id]/events`: SSE via h3 `createEventStream`. Replay the 7 stages with realistic timing (each `running` then `done`, about 0.8 to 2 s apart, total about 10 s), then `complete`. Labels exactly as in the table below.
- [ ] `GET /api/analysis/[id]` returns the `Analysis` reflecting elapsed time (stages done so far), so polling also works.
- [ ] `comparables`, `location`, `planning`, `report` routes return `NOT_READY` (409) until their stage is done, then fixtures: **37 comparables** (median €1,980, p10 €1,750, p90 €2,250), 6 transport stops (Luas Red line stops near James's / Fatima / Rialto, a few bus stops), 5 amenities, 3 planning applications (one granted 120-unit build-to-rent).

| Stage | Running label | Done label |
|---|---|---|
| geocode | Locating property… | Property identified: Dublin 8 |
| market | Retrieving rental market data… | Rental market data retrieved (RTB Q2 2026) |
| comparables | Finding comparable properties… | 42 comparable properties found |
| transport | Analysing transport… | 6 stops within 800 m |
| area | Reading census data… | Area profile built |
| planning | Checking planning applications… | 3 nearby applications |
| report | Generating report… | Report ready |

(42 found, 37 used after filtering: the evidence drawer explains the difference. That honesty is a feature.)

### A3. Data composables (`app/composables/api/**`)
Implement every signature in 1.6 exactly.
- [ ] One `apiFetch<T>()` wrapper over `$fetch` using `apiBase`; throws typed `ApiError`.
- [ ] `useAnalysis(id)`: `useQuery` for `GET /analysis/{id}` + `useEventSource` on `/events`. On each `stage` event, patch `stages` in the query cache. On `complete`/`failed`, invalidate to refetch the full analysis. If the stream errors twice, enable `refetchInterval: 1500` until status is not `running`.
- [ ] `useStageDone`, then `useComparables` / `useLocationData` / `usePlanning` with `enabled: useStageDone(...)`.
- [ ] HANDOFF: `[A→B] READY composables`, listing anything B should know (e.g. listings `keepPreviousData`).

### A4. `PropertyCard` (`app/components/property/PropertyCard.vue`)
- [ ] Image placeholder (gradient + building icon), `eur(rent)/month`, beds · type · area, furnished, floor area.
- [ ] Quick verdict chip: `+11% vs area median (€1,980)` coloured by verdict token.
- [ ] Nearest stop line: `Luas Red · James's · 5 min walk`.
- [ ] `is_sample` → small "Sample listing" badge with tooltip "Demo data based on RTB medians".
- [ ] Primary button **Run full check** → `useCreateAnalysis` with `{ property_id }` → `useMapSelection().startAnalysis(id)`. Loading state on the button.
- [ ] Skeleton while `useListing` loads.

### A5. `PropertyForm` (`app/components/property/PropertyForm.vue`)
- [ ] Prop `initial: DroppedPin`. Address pre-filled (read-only display with "change" link) when the pin has one.
- [ ] Mandatory: address (resolved to place_id or pin location), monthly rent (300 to 15,000; soft confirm above 6,000: "Is this monthly?"), bedrooms (segmented: Studio(0), 1, 2, 3, 4, 5+), property type (segmented).
- [ ] Optional: floor area (15 to 500 m², helper "Improves comparable matching"), furnished (Furnished / Unfurnished / Not sure, default Not sure), listing URL. Skip file upload (cut).
- [ ] Validate on blur; submit always enabled; scroll to first error. Submit → create analysis → `startAnalysis(id)`.
- [ ] Map `ADDRESS_NOT_FOUND`, `ADDRESS_AMBIGUOUS` (candidate list), `OUT_OF_COVERAGE` to inline field errors.

### A6. `AnalysisPanel` (`app/components/analysis/AnalysisPanel.vue`)
- [ ] While `running`: `AgentProgress` = list of `StageRow`s. States: pending (grey dot), running (pulsing accent dot + running label), done (check + done label + detail in muted text), failed (warning + "Skipped: reason").
- [ ] **Each stage stays visible for at least 400 ms** in `running` before showing `done` (queue updates), so fast stages still read as work.
- [ ] Counts in labels tick up (gsap or a simple rAF tween).
- [ ] On `complete`: wait 600 ms, cross-fade to the report sections (A7 to A10) inside the panel.
- [ ] Sticky panel header: back arrow (`reset()`), address, and when complete, **Open full report** → `/analysis/{id}/report`.

### A7. Verdict and evidence (the heart of the demo)
- [ ] `VerdictCard`: verdict label (Below market / In line with market / Above market) + `pct(difference_pct)` vs comparable median; `ConfidencePill`.
- [ ] `StatRow`: asking · median · p10 to p90 range · difference (€ and %).
- [ ] Context line: `37 comparable observations · Jan 2025 to Sep 2026 · within 1.5 km`.
- [ ] Explanation built from `summary.claims` via `ClaimText`, each followed by an `[ⓘ Evidence]` chip.
- [ ] **Guard: a claim with empty `evidence_ids` is not rendered.** Log a console warning instead.
- [ ] `ConfidencePill` popover shows the rule: High = 30+ observations within 18 months and 1.5 km; Medium = 10 to 29 or radius widened; Low = fewer than 10. Plus `confidence.reasons`.
- [ ] `EvidenceDrawer`: shadcn `Sheet` (desktop, right) or vaul-vue (mobile, bottom). For each evidence item: label, value (formatted), scope, observations, and its source (name, publisher, data period, retrieved date, link). Global `openEvidence(ids: string[])` via `provide`/`inject` from `AnalysisPanel`.

### A8. Charts (`app/components/charts/**`, @unovis/vue)
- [ ] `RentDistributionChart`: histogram of the 37 comparable rents (€100 bins). Vertical line + label for **asking rent** (accent), dashed line for **median**. Caption: `37 observations · RTB Q2 2026`. Axis labels in €.
- [ ] `RentTrendChart`: line of `trend.series` (quarterly medians) with a horizontal reference line at asking rent. Caption with `change_12m_pct`.
- [ ] No other charts. Rent vs median is the StatRow; transport is a list.

### A9. `ComparablesTable` (@tanstack/vue-table)
- [ ] Columns: distance · rent · beds · type · date · similarity (bar + %). Default sort similarity desc. Rent cell tinted by comparison to asking.
- [ ] Row hover → `useMapSelection().hover('cmp:' + id)`; row click → `focusFeature`. When `hoveredFeature` is this row (hover came from the map), highlight and `scrollIntoView({ block: 'nearest' })`.
- [ ] Mobile: rows become compact cards.

### A10. Remaining report sections
- [ ] `TransportList` grouped by mode with lucide icons and mode colour tokens: name · `metres` · `walk_min` min · routes. Hover/click sync like A9 (`stop:` ids).
- [ ] `AreaSection`: 4 `StatTile`s (value, national comparison, geography, census year) + claims.
- [ ] `PlanningSection`: `PlanningCard` (status badge, reference, distance, dates, summary, "Why it matters: relevance", link). Sync with map (`plan:` ids).
- [ ] `SourcesSection` + `LimitationsBox` + disclaimer: "RentCheck is a decision-support tool, not a valuation or legal advice."
- [ ] Every section footer: `Source · data period · n observations · retrieved date`.
- [ ] A section whose stage failed renders "Planning data unavailable for this area" with the reason. Never disappears.

### A11. Printable report (`app/pages/analysis/[id]/report.vue`)
- [ ] All sections expanded (no tabs), B's `<MiniMap>` at the top, sources appendix, disclaimer in header and footer.
- [ ] "Download PDF" → `window.print()`. Print CSS: hide buttons, avoid breaking cards across pages, A4 margins.

### A12. Error and empty states
- [ ] Analysis failed: card with what failed, **Retry** (re-POST same input) and **Edit details**.
- [ ] SSE dropped: silent polling; "Reconnecting…" text only after 5 s.
- [ ] Fewer than 10 comparables: amber banner + Low confidence; show widened radius.
- [ ] Any 5xx from listings: toast "Couldn't load listings, retrying".

### Definition of done (A)
- Fresh clone → `npm i && npm run dev` → the full happy path in 1.11 works on mocks with no console errors.
- Switching `NUXT_PUBLIC_API_BASE` to the real backend requires no component changes.
- No claim renders without evidence. Every number in the report has a source footer.
- Works at 375 px wide and at 1440 px.

### Do not
- Edit anything B owns (map, shell, search, `useMapSelection`, `pages/index.vue`).
- Call `$fetch` from components. Everything goes through the composables.
- Add a global store library. Vue Query + `useMapSelection` + local state are enough.
- Show a generic spinner for the analysis. The stages are the loading UI.

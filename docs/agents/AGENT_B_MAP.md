# Agent B: Map, Browse Experience and App Shell

You are **Agent B** on the RentCheck AI frontend. Another coding agent, **Agent A**, is building the scaffold, data layer and report panel in the same repo at the same time. Their brief is `docs/agents/AGENT_A_SHELL_REPORT.md`.

**Your job:** the Google/Apple-Maps-style experience. That means the full-screen 3D map (MapLibre + OpenFreeMap Liberty), price pins, the fly-in and building highlight, the analysis map layers and camera orbit, search and drop-pin, filters, and the shell that hosts A's panel components (side panel on desktop, bottom sheet on mobile).

**Agent A starts first** with the scaffold (about 30 minutes). Until `[A→B] READY scaffold` appears in `docs/agents/HANDOFF.md`, work in a throwaway Vite or Nuxt sandbox outside the repo (task B0), then move the code in.

Section 1 is shared with Agent A word for word. Section 2 is yours alone.

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

## 2. Agent B tasks (in order)

Tick boxes as you go. After each task: commit, then append a `READY` line to HANDOFF.md if A can use it.

### Facts about the Liberty style (verified against the live style JSON)
- Sources: `openmaptiles` (vector) and `ne2_shaded`.
- Layer `building` (type `fill`, zoom 13 to 14) and layer **`building-3d`** (type `fill-extrusion`, source-layer `building`, minzoom 14) with `fill-extrusion-height: ["get","render_height"]`, `fill-extrusion-base: ["get","render_min_height"]`. So 3D buildings only appear at zoom 14 and above.
- Building heights come from OpenStreetMap. City centre is good; some buildings have no height and render low. Pick the demo pin on a building that highlights well.

### B0. Map spike (while A scaffolds)
- [ ] In a sandbox: MapLibre map, Liberty style, centre `[-6.283, 53.338]`, zoom 14, pitch 45. Confirm 3D buildings render.
- [ ] Prototype: HTML price-pill `Marker`, `flyTo` to pitch 60 / zoom 17 / bearing -20, building highlight (below), orbit (below).
- [ ] When A posts `READY scaffold`: move it into `app/pages/dev/map.vue` + `app/lib/map/**`. Import `maplibre-gl/dist/maplibre-gl.css`. MapLibre is client-only: use `<ClientOnly>` and create the map in `onMounted`; `map.remove()` in `onBeforeUnmount`.

### B1. Map config and core (`app/lib/map/**`, `app/components/map/AnalysisMap.vue`)
- [ ] `config.ts`: `MAP_STYLE` (Liberty), `MAP_STYLE_FALLBACK` (Positron), `DUBLIN_CENTER`, zoom/pitch presets (`browse`, `selected`, `mobileBrowse` with pitch 0). One place to swap the style if the venue Wi-Fi struggles.
- [ ] On load: soften default buildings so the highlight pops:
  ```ts
  map.setPaintProperty('building-3d', 'fill-extrusion-color', '#e7e5e4')
  map.setPaintProperty('building-3d', 'fill-extrusion-opacity', 0.85)
  ```
- [ ] Expose the map instance via `provide` so layer components (B5) can add/remove their sources and layers.
- [ ] Guard every layer add with `map.isStyleLoaded()` / `map.once('load')`; remove layers and sources on unmount.

### B2. `useMapSelection` (`app/composables/useMapSelection.ts`)
- [ ] Implement exactly the API in 1.6 with Nuxt `useState` keys (`sel:listing`, `sel:analysis`, `sel:pin`, `sel:hover`).
- [ ] `selectListing` clears `droppedPin`; `startAnalysis` keeps `selectedListingId` (so back returns to the card); `reset` clears all.
- [ ] Mirror `selectedListingId` and `activeAnalysisId` into the URL query (`?listing=lst_demo&analysis=an_demo`) so a refresh or shared link restores state.
- [ ] Commit early and post `[B→A] READY useMapSelection` (A needs it for PropertyCard).

### B3. Shell (`app/components/shell/MapShell.vue`, `app/pages/index.vue`)
- [ ] Full-viewport map behind everything.
- [ ] **Desktop (≥1024 px):** floating left panel, 400 px wide, rounded, shadow, scrollable (`ScrollArea`), top 72 px below the search bar. **Mobile:** vaul-vue drawer with snap points `['148px', 0.5, 1]`, not dismissible, map interactive behind it at the peek height.
- [ ] Panel routing per 1.7: `AnalysisPanel` > `PropertyCard` > `PropertyForm` > `ListingList`. Until A's components exist, render placeholder cards with the same props.
- [ ] Panel content transitions: slide/fade (`<Transition mode="out-in">`).
- [ ] Map controls bottom-right: zoom, **2D/3D toggle** (pitch 0 ↔ 60 with `easeTo`), recentre.

### B4. Price pins and browsing
- [ ] Track the viewport: on `moveend` (debounced 300 ms) set `bbox` from `map.getBounds()`; pass `bbox` + filters to `useListings`.
- [ ] Put listings in a GeoJSON source with `cluster: true, clusterRadius: 50, clusterMaxZoom: 14`. Cluster layer: circle + count label (accent-tinted).
- [ ] Unclustered listings render as **HTML price pills** (`new maplibregl.Marker({ element, anchor: 'bottom' })`). Sync markers on the map `render`/`sourcedata` event from `map.querySourceFeatures('listings')` filtered to non-clusters: add new, keep existing, remove missing (keyed by id). Never recreate all markers on every move.
- [ ] Pill: `€2,200`, background by verdict token, white text, small tail. States: default, hovered (scale 1.1, raised z-index), selected (accent background, larger, always on top), visited (slightly muted).
- [ ] Hover pin ↔ `hover('listing:id')`; click → `selectListing(id)`.
- [ ] Pins animate in (fade + rise 8 px) when first added. Keep it subtle.

### B5. Selection: fly-in and building highlight
- [ ] Watch `selectedListingId` → `flyTo({ center, zoom: 17, pitch: 60, bearing: -20, duration: 1500 })` (pitch 0 if 2D mode or mobile default). Offset the centre so the pin is not hidden under the desktop panel: use `padding: { left: 420 }`.
- [ ] After `moveend`, highlight the building:
  ```ts
  const [hit] = map.queryRenderedFeatures(map.project([lng, lat]), { layers: ['building-3d'] })
  // source 'selected-building' + layer 'selected-building-3d' (fill-extrusion, color var(--brand) resolved to hex,
  // height/base from render_height/render_min_height, opacity 0.95)
  setData(hit ? featureCollection([{ type: 'Feature', geometry: hit.geometry, properties: hit.properties }]) : EMPTY)
  ```
  If nothing is hit (no building polygon or zoom < 14), skip the highlight; the selected pin is enough.
- [ ] `reset()` → clear highlight, `flyTo` back to the previous browse camera.

### B6. Analysis layers (`app/components/map/layers/**`)
Watch `activeAnalysisId`. Use A's composables; each layer appears when its data arrives (they are enabled only after their stage is done), which is what makes the map "fill in" live.
- [ ] `RadiusLayer`: dashed circle of `summary.radius_m` (default 1500) around the property. Generate a 64-point polygon yourself (no turf dependency).
- [ ] `ComparablesLayer` (from `useComparables`): circles, colour = rent vs **asking** (`below` < -5%, `inline` ±5%, `above` > +5%, verdict tokens), radius 4 to 9 px by `similarity`. Entrance: animate `circle-opacity` 0 → 1 over 600 ms.
- [ ] `TransportLayer` (from `useLocationData`): HTML markers with lucide icons in mode colours (Luas, DART, rail, bus); optional thin line from property to the nearest stop of each mode.
- [ ] `PlanningLayer` (from `usePlanning`): rounded squares coloured by planning status token. Stretch: translucent `fill-extrusion` column (radius about 15 m, height 40 m) on granted sites.
- [ ] Hover tooltips (small card: rent · beds · distance, or stop name · walk time, or reference · status · summary).
- [ ] Two-way hover sync: map hover → `hover('cmp:id')` etc.; when `hoveredFeature` changes from A's tables, pulse that feature (`setFeatureState({ hover: true })` with a paint expression on feature-state, or bump the marker).
- [ ] `focusFeature(id)` → `easeTo` that feature, keep pitch.
- [ ] Hide listing price pins (other than the selected one) while an analysis is active, so the analysis layers read clearly. Restore on `reset()`.

### B7. Camera orbit while the agents run
- [ ] While `useAnalysis(activeAnalysisId).status === 'running'`: slow orbit around the property.
  ```ts
  function startOrbit() {
    let stopped = false
    const spin = () => { if (stopped) return
      map.rotateTo(map.getBearing() + 30, { duration: 4000, easing: t => t }); map.once('moveend', spin) }
    spin(); return () => { stopped = true; map.stop() }
  }
  ```
- [ ] Stop on `complete`/`failed`, or immediately when the user drags/zooms (`dragstart`, `wheel`, `touchstart`). Then `fitBounds` to all analysis features with panel padding.

### B8. Search, drop pin, browse list
- [ ] `SearchBar` (top-left, floating, 400 px on desktop / full width on mobile): input → `useGeocode(q)` → dropdown of results (keyboard navigable). Selecting a result: if a listing exists at that location, `selectListing`; otherwise `dropPin({ location, address, place_id })` and fly there.
- [ ] Right-click (desktop) or long-press 500 ms (mobile) on the map → `dropPin({ location })` with a distinct "Check a property here" pin (accent outline, pulsing).
- [ ] `ListingList` (panel default view): header "38 rentals in this area", sort by price / difference, rows = rent · beds · type · verdict chip. Row hover ↔ pin highlight; click → `selectListing`. Empty: "No rentals in view. Zoom out or move the map."

### B9. Filters (`MapFilters`)
- [ ] Chip row under the search bar: Beds (Any / 1 / 2 / 3+), Max rent (slider or presets €1,500 / €2,000 / €2,500 / €3,000+), Type. Writes the `filters` ref passed to `useListings`.
- [ ] During an analysis, swap to layer toggles: Comparables · Transport · Planning · Radius, plus "Same bedrooms only" (client-side filter of the comparables source).

### B10. `MiniMap` for A's printable report
- [ ] `<MiniMap :center :points>`: non-interactive (`interactive: false`), Positron style (prints cleaner), pitch 0, fits to points, property pin + small dots. Post `[B→A] READY MiniMap`.

### B11. Mobile and polish
- [ ] Mobile default pitch 0 (3D is heavy on low-end phones); the 2D/3D toggle opts in.
- [ ] Tap targets ≥ 44 px; search bar never covered by the sheet.
- [ ] If the style fails to load within 8 s, switch to `MAP_STYLE_FALLBACK` and toast "Using simplified map".
- [ ] Projector check: pins readable from the back of the room (pill font ≥ 13 px, bold).

### Definition of done (B)
- Pan/zoom over Dublin 8 shows clustered + pill pins from the mocks without flicker.
- Click the demo pin `lst_demo` → camera swoops in, building lights up in the accent colour, PropertyCard appears.
- Run full check → orbit starts, radius + comparables + stops + planning appear as their stages finish, orbit stops and frames everything on complete.
- Hovering a row in A's comparables table pulses the matching dot, and the reverse.
- Works at 375 px (bottom sheet) and 1440 px (side panel). No console errors, no leaked markers after `reset()`.

### Do not
- Edit anything A owns (`package.json`, types, composables under `api/`, `server/`, panel/report components). Ask in HANDOFF.md.
- Call `$fetch` directly. Use A's composables.
- Hard-code colours. Read the CSS variables (resolve once with `getComputedStyle(document.documentElement)` for MapLibre paint properties, which need concrete colours).
- Recreate all markers on every map move.

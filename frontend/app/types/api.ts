// Shared API contract. Owned by Agent A. Source: docs/agents section 1.4.
// Change only with a CHANGE entry in docs/agents/HANDOFF.md.

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

// Commute (served by the Nuxt server itself at /api/commute, not Person 4's API: it calls
// free OSM routing and geocoding, so it works with the mocks and with the real backend alike).
export type CommuteMode = 'walk' | 'cycle' | 'transit' | 'drive'
export interface CommuteOption {
  mode: CommuteMode
  distance_m: number
  duration_s: number
  /** 'route' = real OSM route; 'estimate' = public transport estimated from the route (no free timetable routing). */
  basis: 'route' | 'estimate'
}
export interface CommuteResponse {
  from: LngLat
  to: { location: LngLat; label: string }
  options: CommuteOption[]
  attribution: string
}

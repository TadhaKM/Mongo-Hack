import type { LngLat } from '~/types/api'

export type FeatureId = `listing:${string}` | `cmp:${string}` | `stop:${string}` | `plan:${string}` | `amenity:${string}`
export interface DroppedPin { location: LngLat; address?: string; place_id?: string }

/** A request for the map to fly to a feature; `n` makes repeat requests for the same id observable. */
export interface FocusRequest { id: FeatureId; n: number }

/**
 * Global map/panel selection (Nuxt useState). Panel routing, in priority order:
 * activeAnalysisId → AnalysisPanel, selectedListingId → PropertyCard,
 * droppedPin → PropertyForm, else ListingList.
 */
export function useMapSelection() {
  const selectedListingId = useState<string | null>('sel:listing', () => null)
  const activeAnalysisId = useState<string | null>('sel:analysis', () => null)
  const droppedPin = useState<DroppedPin | null>('sel:pin', () => null)
  const hoveredFeature = useState<FeatureId | null>('sel:hover', () => null)
  const focusRequest = useState<FocusRequest | null>('sel:focus', () => null)

  function selectListing(id: string | null) {
    selectedListingId.value = id
    activeAnalysisId.value = null
    if (id) droppedPin.value = null
  }

  /** Keeps selectedListingId / droppedPin so "back" returns to the card or form. */
  function startAnalysis(id: string) {
    activeAnalysisId.value = id
  }

  function dropPin(pin: DroppedPin | null) {
    droppedPin.value = pin
    if (pin) {
      selectedListingId.value = null
      activeAnalysisId.value = null
    }
  }

  function hover(id: FeatureId | null) {
    if (hoveredFeature.value !== id) hoveredFeature.value = id
  }

  function focusFeature(id: FeatureId) {
    focusRequest.value = { id, n: (focusRequest.value?.n ?? 0) + 1 }
  }

  function reset() {
    selectedListingId.value = null
    activeAnalysisId.value = null
    droppedPin.value = null
    hoveredFeature.value = null
  }

  /** Step back one level: analysis → card/form → browse. */
  function back() {
    if (activeAnalysisId.value) activeAnalysisId.value = null
    else reset()
  }

  return {
    selectedListingId,
    activeAnalysisId,
    droppedPin,
    hoveredFeature,
    focusRequest,
    selectListing,
    startAnalysis,
    dropPin,
    hover,
    focusFeature,
    reset,
    back,
  }
}

/** Parse a FeatureId into its kind and raw id. */
export function parseFeatureId(id: FeatureId): { kind: 'listing' | 'cmp' | 'stop' | 'plan' | 'amenity'; id: string } {
  const i = id.indexOf(':')
  return { kind: id.slice(0, i) as never, id: id.slice(i + 1) }
}

/**
 * Mirror selection into the URL (?listing=…&analysis=…) and restore it on load.
 * Call once, from the page that hosts the map.
 */
export function useMapSelectionUrlSync() {
  const route = useRoute()
  const router = useRouter()
  const { selectedListingId, activeAnalysisId } = useMapSelection()

  const q = (v: unknown) => (typeof v === 'string' && v ? v : null)
  if (!selectedListingId.value && !activeAnalysisId.value) {
    selectedListingId.value = q(route.query.listing)
    activeAnalysisId.value = q(route.query.analysis)
  }

  watch([selectedListingId, activeAnalysisId], ([listing, analysis]) => {
    const query = { ...route.query }
    if (listing) query.listing = listing
    else delete query.listing
    if (analysis) query.analysis = analysis
    else delete query.analysis
    if (query.listing === route.query.listing && query.analysis === route.query.analysis) return
    router.replace({ query })
  })
}

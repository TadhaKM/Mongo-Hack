// Mock data for the frontend. Owned by Agent A.
// Deterministic (seeded) so every reload shows the same pins and the same demo report.
// Everything here is SAMPLE data shaped like the real backend contract (docs/agents section 1.4).
import type {
  Amenity, Claim, Comparable, Evidence, GeocodeResult, Listing, LngLat, PlanningApplication,
  PropertyType, Source, TransportStop, Verdict,
} from '../../app/types/api'

// ---------- helpers ----------

function seeded(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6D2B79F5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const EARTH_M_PER_DEG_LAT = 111_320
function offset(from: LngLat, northM: number, eastM: number): LngLat {
  return {
    lat: from.lat + northM / EARTH_M_PER_DEG_LAT,
    lng: from.lng + eastM / (EARTH_M_PER_DEG_LAT * Math.cos((from.lat * Math.PI) / 180)),
  }
}

export function distanceM(a: LngLat, b: LngLat): number {
  const r = 6_371_000
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * r * Math.asin(Math.sqrt(h)))
}

function round(value: number, step: number) {
  return Math.round(value / step) * step
}

export function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo)
}

export function verdictFor(diffPct: number): Verdict {
  if (diffPct < -5) return 'below_market'
  if (diffPct > 5) return 'above_market'
  return 'in_line'
}

function areaFor(p: LngLat): string {
  if (p.lat > 53.3465) return 'Dublin 7'
  if (p.lng > -6.2685) return 'Dublin 2'
  return 'Dublin 8'
}

// ---------- market model ----------

/** 2-bed median for the area; other sizes scale from it. */
const BASE_2BED_MEDIAN = 1980
const BED_FACTOR: Record<number, number> = { 0: 0.62, 1: 0.78, 2: 1, 3: 1.25, 4: 1.5, 5: 1.7 }
const TYPE_FACTOR: Record<PropertyType, number> = { apartment: 1, house: 1.08, duplex: 1.04, shared_room: 0.42 }

/** 2-bed median for an area (sample values). Dublin areas use the Dublin 8 figure. */
export function areaBase(area: string): number {
  return COUNTY_TOWNS.find(t => t.area === area)?.median ?? BASE_2BED_MEDIAN
}

export function areaMedian(bedrooms: number, type: PropertyType, base = BASE_2BED_MEDIAN): number {
  return round(base * (BED_FACTOR[bedrooms] ?? 1) * TYPE_FACTOR[type], 10)
}

// ---------- county towns (sample data outside Dublin) ----------

/** One main town per county outside Dublin, with a rough sample 2-bed median. Positions are approximate. */
export const COUNTY_TOWNS: { county: string; area: string; lng: number; lat: number; median: number }[] = [
  { county: 'Carlow', area: 'Carlow', lng: -6.926, lat: 52.836, median: 1300 },
  { county: 'Cavan', area: 'Cavan', lng: -7.360, lat: 53.990, median: 1100 },
  { county: 'Clare', area: 'Ennis', lng: -8.983, lat: 52.844, median: 1250 },
  { county: 'Cork', area: 'Cork City', lng: -8.470, lat: 51.898, median: 1700 },
  { county: 'Donegal', area: 'Letterkenny', lng: -7.734, lat: 54.950, median: 1000 },
  { county: 'Galway', area: 'Galway City', lng: -9.057, lat: 53.271, median: 1650 },
  { county: 'Kerry', area: 'Tralee', lng: -9.702, lat: 52.270, median: 1200 },
  { county: 'Kildare', area: 'Naas', lng: -6.667, lat: 53.216, median: 1750 },
  { county: 'Kilkenny', area: 'Kilkenny', lng: -7.255, lat: 52.654, median: 1350 },
  { county: 'Laois', area: 'Portlaoise', lng: -7.300, lat: 53.034, median: 1250 },
  { county: 'Leitrim', area: 'Carrick-on-Shannon', lng: -8.090, lat: 53.947, median: 950 },
  { county: 'Limerick', area: 'Limerick City', lng: -8.630, lat: 52.664, median: 1500 },
  { county: 'Longford', area: 'Longford', lng: -7.799, lat: 53.727, median: 1000 },
  { county: 'Louth', area: 'Dundalk', lng: -6.405, lat: 54.000, median: 1400 },
  { county: 'Mayo', area: 'Castlebar', lng: -9.299, lat: 53.856, median: 1050 },
  { county: 'Meath', area: 'Navan', lng: -6.682, lat: 53.653, median: 1550 },
  { county: 'Monaghan', area: 'Monaghan', lng: -6.968, lat: 54.249, median: 1050 },
  { county: 'Offaly', area: 'Tullamore', lng: -7.493, lat: 53.274, median: 1150 },
  { county: 'Roscommon', area: 'Roscommon', lng: -8.190, lat: 53.633, median: 1000 },
  { county: 'Sligo', area: 'Sligo', lng: -8.476, lat: 54.271, median: 1150 },
  { county: 'Tipperary', area: 'Clonmel', lng: -7.704, lat: 52.355, median: 1100 },
  { county: 'Waterford', area: 'Waterford City', lng: -7.110, lat: 52.259, median: 1300 },
  { county: 'Westmeath', area: 'Athlone', lng: -7.940, lat: 53.423, median: 1250 },
  { county: 'Wexford', area: 'Wexford', lng: -6.459, lat: 52.336, median: 1250 },
  { county: 'Wicklow', area: 'Bray', lng: -6.098, lat: 53.203, median: 1800 },
]
const TOWN_STREETS = ['Main Street', 'Church Street', 'Bridge Street', 'Castle Street', 'Market Square', 'Mill Road', 'John Street', 'Abbey Street', 'New Road', 'Parnell Street']
const LISTINGS_PER_TOWN = 8

function buildCountyListings(): Listing[] {
  const items: Listing[] = []
  COUNTY_TOWNS.forEach((town, t) => {
    const rand = seeded(100 + t)
    const slug = town.county.toLowerCase()
    for (let i = 1; i <= LISTINGS_PER_TOWN; i++) {
      const type = TYPES[Math.floor(rand() * TYPES.length)]!
      const bedrooms = type === 'shared_room' ? 1 : [1, 2, 2, 2, 3, 3, 4][Math.floor(rand() * 7)]!
      const angle = rand() * Math.PI * 2
      const radius = 200 + Math.sqrt(rand()) * 1800
      const location = offset({ lng: town.lng, lat: town.lat }, Math.sin(angle) * radius, Math.cos(angle) * radius)
      const median = areaMedian(bedrooms, type, town.median)
      const rent = round(median * (0.84 + rand() * 0.34), 25)
      const diff = ((rent - median) / median) * 100
      items.push({
        id: `lst_${slug}_${String(i).padStart(2, '0')}`,
        rent, bedrooms, property_type: type, area: town.area, location,
        verdict: verdictFor(diff), diff_pct: Math.round(diff * 10) / 10, is_sample: true,
        address: `${type === 'house' ? '' : `Apt ${1 + Math.floor(rand() * 20)}, `}${1 + Math.floor(rand() * 80)} ${TOWN_STREETS[Math.floor(rand() * TOWN_STREETS.length)]}, ${town.area}, Co. ${town.county}`,
        floor_area_m2: type === 'shared_room' ? null : round(30 + bedrooms * 24 + rand() * 20, 1),
        furnished: FURNISHED[Math.floor(rand() * FURNISHED.length)]!,
        listing_url: null,
        area_median: median,
        nearest_stop: null, // our transport sample covers Dublin 8 only
      })
    }
  })
  return items
}

export const DUBLIN_8_CENTER: LngLat = { lng: -6.283, lat: 53.338 }

// ---------- sources ----------

export const SOURCES: Source[] = [
  { id: 'rtb', name: 'RTB Rent Index', publisher: 'Residential Tenancies Board', url: 'https://www.rtb.ie/data-hub', data_period: 'Q2 2026', retrieved_at: '2026-10-03' },
  { id: 'cso', name: 'Census of Population 2022', publisher: 'Central Statistics Office', url: 'https://www.cso.ie/en/census/census2022/', data_period: '2022', retrieved_at: '2026-10-03' },
  { id: 'nta_gtfs', name: 'GTFS public transport timetables', publisher: 'National Transport Authority', url: 'https://www.transportforireland.ie/transitData/PT_Data.html', data_period: 'Sep 2026', retrieved_at: '2026-10-03' },
  { id: 'planning', name: 'National Planning Applications', publisher: 'Department of Housing, Local Government and Heritage', url: 'https://data.gov.ie/', data_period: 'Jan 2024 to Sep 2026', retrieved_at: '2026-10-03' },
  { id: 'ppr', name: 'Residential Property Price Register', publisher: 'Property Services Regulatory Authority', url: 'https://www.propertypriceregister.ie/', data_period: '2025 to 2026', retrieved_at: '2026-10-03' },
  { id: 'osm', name: 'OpenStreetMap amenities', publisher: 'OpenStreetMap contributors', url: 'https://www.openstreetmap.org/', data_period: 'Sep 2026', retrieved_at: '2026-10-03' },
]

// ---------- listings ----------

const STREETS = [
  'Marrowbone Lane', 'Cork Street', 'Thomas Street', 'Meath Street', 'Francis Street', 'Patrick Street',
  'South Circular Road', 'Donore Avenue', 'Basin Street', 'James\'s Street', 'Oliver Bond Street',
  'Clanbrassil Street', 'Blackpitts', 'The Coombe', 'Pimlico', 'Bridgefoot Street', 'Ushers Quay',
  'Rialto Street', 'Dolphin\'s Barn', 'Herberton Road',
]
const TYPES: PropertyType[] = ['apartment', 'apartment', 'apartment', 'apartment', 'house', 'duplex', 'house', 'shared_room']
const FURNISHED: Listing['furnished'][] = ['furnished', 'furnished', 'unfurnished', 'unknown']

/** The demo pin. Sits on Marrowbone Lane, Dublin 8. */
export const DEMO_LISTING_ID = 'lst_demo'
const DEMO_LOCATION: LngLat = { lng: -6.28350, lat: 53.33985 }

function buildListings(): Listing[] {
  const rand = seeded(8)
  const items: Listing[] = []
  for (let i = 1; i <= 59; i++) {
    const type = TYPES[Math.floor(rand() * TYPES.length)]!
    const bedrooms = type === 'shared_room' ? 1 : [1, 1, 2, 2, 2, 3, 3, 4][Math.floor(rand() * 8)]!
    const angle = rand() * Math.PI * 2
    const radius = 150 + Math.sqrt(rand()) * 1850
    const location = offset(DUBLIN_8_CENTER, Math.sin(angle) * radius, Math.cos(angle) * radius * 1.3)
    const median = areaMedian(bedrooms, type)
    const rent = round(median * (0.84 + rand() * 0.34), 25)
    const diff = ((rent - median) / median) * 100
    items.push({
      id: `lst_${String(i).padStart(3, '0')}`,
      rent, bedrooms, property_type: type, area: areaFor(location), location,
      verdict: verdictFor(diff), diff_pct: Math.round(diff * 10) / 10, is_sample: true,
      address: `${type === 'house' ? '' : `Apt ${1 + Math.floor(rand() * 40)}, `}${1 + Math.floor(rand() * 120)} ${STREETS[Math.floor(rand() * STREETS.length)]}, ${areaFor(location)}`,
      floor_area_m2: type === 'shared_room' ? null : round(28 + bedrooms * 22 + rand() * 18, 1),
      furnished: FURNISHED[Math.floor(rand() * FURNISHED.length)]!,
      listing_url: null,
      area_median: median,
      nearest_stop: null,
    })
  }
  const demoMedian = areaMedian(2, 'apartment')
  items.unshift({
    id: DEMO_LISTING_ID,
    rent: 2200, bedrooms: 2, property_type: 'apartment', area: 'Dublin 8', location: DEMO_LOCATION,
    verdict: 'above_market', diff_pct: Math.round(((2200 - demoMedian) / demoMedian) * 1000) / 10, is_sample: true,
    address: 'Apt 12, 31 Marrowbone Lane, Dublin 8',
    floor_area_m2: 68, furnished: 'furnished', listing_url: null,
    area_median: demoMedian, nearest_stop: null,
  })
  for (const l of items) {
    const stop = nearestStop(l.location)
    const d = distanceM(l.location, stop.location)
    l.nearest_stop = d <= 2000 ? { name: stop.name, mode: stop.mode, walk_min: Math.max(1, Math.round(d / 80)) } : null
  }
  return items
}

// ---------- transport (approximate real stop positions) ----------

const STOPS: Omit<TransportStop, 'distance_m' | 'walk_min'>[] = [
  { id: 'luas_james', name: 'James\'s', mode: 'luas', routes: ['Red'], location: { lng: -6.29340, lat: 53.34190 } },
  { id: 'luas_fatima', name: 'Fatima', mode: 'luas', routes: ['Red'], location: { lng: -6.29250, lat: 53.33840 } },
  { id: 'luas_rialto', name: 'Rialto', mode: 'luas', routes: ['Red'], location: { lng: -6.29740, lat: 53.33780 } },
  { id: 'luas_heuston', name: 'Heuston', mode: 'luas', routes: ['Red'], location: { lng: -6.29180, lat: 53.34660 } },
  { id: 'rail_heuston', name: 'Heuston Station', mode: 'rail', routes: ['Intercity', 'Commuter'], location: { lng: -6.29400, lat: 53.34630 } },
  { id: 'bus_thomas', name: 'Thomas Street', mode: 'bus', routes: ['13', '40', 'G1'], location: { lng: -6.28100, lat: 53.34330 } },
  { id: 'bus_cork', name: 'Cork Street', mode: 'bus', routes: ['27', '56A', '77A'], location: { lng: -6.28520, lat: 53.33790 } },
  { id: 'bus_coombe', name: 'The Coombe', mode: 'bus', routes: ['27', '77A', '151'], location: { lng: -6.27660, lat: 53.33890 } },
  { id: 'bus_src', name: 'South Circular Road', mode: 'bus', routes: ['9', '16', '83'], location: { lng: -6.28020, lat: 53.33320 } },
  { id: 'bus_patrick', name: 'Patrick Street', mode: 'bus', routes: ['49', '54A', '150'], location: { lng: -6.27140, lat: 53.33990 } },
]

function nearestStop(p: LngLat) {
  return STOPS.reduce((best, s) => (distanceM(p, s.location) < distanceM(p, best.location) ? s : best))
}

export function transportNear(p: LngLat, maxM = 1000): TransportStop[] {
  return STOPS
    .map(s => ({ ...s, distance_m: distanceM(p, s.location) }))
    .map(s => ({ ...s, walk_min: Math.max(1, Math.round(s.distance_m / 80)) }))
    .filter(s => s.distance_m <= maxM)
    .sort((a, b) => a.distance_m - b.distance_m)
    .slice(0, 6)
}

// ---------- amenities and planning (placed relative to the property) ----------

export function amenitiesNear(p: LngLat): Amenity[] {
  const raw: [Amenity['category'], string, number, number][] = [
    ['supermarket', 'Supermarket', 180, 140],
    ['pharmacy', 'Pharmacy', -120, 210],
    ['gp', 'GP surgery', 260, -190],
    ['school', 'Primary school', -340, -150],
    ['park', 'Park', 420, 380],
  ]
  return raw.map(([category, name, n, e], i) => {
    const location = offset(p, n, e)
    return { id: `amn_${i + 1}`, category, name, distance_m: distanceM(p, location), location }
  })
}

export function planningNear(p: LngLat): PlanningApplication[] {
  const raw: [PlanningApplication['status'], string, string, string | null, string, string, number, number][] = [
    ['granted', 'SAMPLE-DCC-3112/25', '2025-06-18', '2026-05-12', '120-unit build-to-rent apartment scheme with ground-floor retail', 'May add rental supply nearby from about 2028', 380, 470],
    ['pending', 'SAMPLE-DCC-2047/26', '2026-07-30', null, 'Change of use from office to 14 apartments', 'Small increase in local supply if granted', -260, -330],
    ['refused', 'SAMPLE-DCC-1580/25', '2025-03-04', '2025-09-22', 'Demolition of terrace and new 6-storey student accommodation', 'Refused, so no change expected', 520, -210],
  ]
  return raw.map(([status, reference, received, decision, summary, relevance, n, e], i) => {
    const location = offset(p, n, e)
    return {
      id: `pl_${i + 1}`, reference, status, received_date: received, decision_date: decision,
      summary, relevance, url: 'https://data.gov.ie/', distance_m: distanceM(p, location), location,
    }
  })
}

// ---------- comparables ----------

/** 42 candidates are found; 37 pass the filters (same bedrooms, within 18 months and 1.5 km). */
export const COMPARABLES_FOUND = 42

export function comparablesFor(p: LngLat, bedrooms: number, type: PropertyType, base = BASE_2BED_MEDIAN, seed = 37): Comparable[] {
  const rand = seeded(seed)
  const median = areaMedian(bedrooms, type, base)
  // Shape chosen so a 2-bed apartment gives median 1,980 · p10 1,750 · p90 2,250.
  const ratios = [
    0.854, 0.869, 0.879, 0.884, 0.889, 0.904, 0.914, 0.929, 0.939, 0.944, 0.949, 0.955, 0.962, 0.97, 0.975, 0.98, 0.985, 0.992,
    1, 1.005, 1.01, 1.018, 1.025, 1.03, 1.04, 1.048, 1.056, 1.066, 1.076, 1.086, 1.096, 1.106, 1.126, 1.136, 1.146, 1.166, 1.189,
  ]
  const months = ['2025-01', '2025-03', '2025-05', '2025-07', '2025-09', '2025-11', '2026-01', '2026-03', '2026-05', '2026-07', '2026-09']
  return ratios.map((ratio, i) => {
    const angle = rand() * Math.PI * 2
    const radius = 120 + Math.sqrt(rand()) * 1350
    const location = offset(p, Math.sin(angle) * radius, Math.cos(angle) * radius)
    const distance = distanceM(p, location)
    const area = type === 'shared_room' ? null : round(30 + bedrooms * 22 + rand() * 14, 1)
    const similarity = Math.max(0.55, Math.min(0.98, 1 - distance / 4000 - Math.abs(ratio - 1) * 0.6 - rand() * 0.06))
    return {
      id: `cmp_${String(i + 1).padStart(2, '0')}`,
      rent: round(median * ratio, 10),
      bedrooms, property_type: type, floor_area_m2: area,
      date: months[Math.floor(rand() * months.length)]!,
      distance_m: distance, similarity: Math.round(similarity * 100) / 100,
      location, source_id: 'rtb',
    }
  })
}

export function trendFor(median: number) {
  // Quarterly medians rising about 6% over the last 12 months to today's median.
  const quarters = ['2022-Q3', '2022-Q4', '2023-Q1', '2023-Q2', '2023-Q3', '2023-Q4', '2024-Q1', '2024-Q2', '2024-Q3', '2024-Q4', '2025-Q1', '2025-Q2', '2025-Q3', '2025-Q4', '2026-Q1', '2026-Q2']
  const shape = [0.8, 0.81, 0.82, 0.835, 0.85, 0.855, 0.865, 0.88, 0.895, 0.905, 0.915, 0.935, 0.955, 0.97, 0.985, 1]
  const series = quarters.map((period, i) => ({ period, median: round(median * shape[i]!, 10) }))
  const yearAgo = series[series.length - 5]!.median
  return { series, source_id: 'rtb', change_12m_pct: Math.round(((median - yearAgo) / yearAgo) * 1000) / 10 }
}

export function areaStats(area = 'Dublin 8') {
  const town = COUNTY_TOWNS.find(t => t.area === area)
  if (!town) {
    return [
      { key: 'population', label: 'Population', value: 4_812, unit: 'count' as const, national: null, geography: 'Merchants Quay C (ED)', year: 2022, source_id: 'cso' },
      { key: 'renting', label: 'Households renting', value: 0.58, unit: 'pct' as const, national: 0.19, geography: 'Merchants Quay C (ED)', year: 2022, source_id: 'cso' },
      { key: 'vacancy_rate', label: 'Vacancy rate', value: 0.054, unit: 'pct' as const, national: 0.078, geography: 'Merchants Quay C (ED)', year: 2022, source_id: 'cso' },
      { key: 'population_change', label: 'Population change since 2016', value: 0.112, unit: 'pct' as const, national: 0.081, geography: 'Merchants Quay C (ED)', year: 2022, source_id: 'cso' },
    ]
  }
  // Town-level sample figures, scaled loosely from the town's rent level.
  const k = (town.median - 950) / (1800 - 950)
  const geography = `${town.area} (town)`
  return [
    { key: 'population', label: 'Population', value: Math.round(9_000 + k * 120_000), unit: 'count' as const, national: null, geography, year: 2022, source_id: 'cso' },
    { key: 'renting', label: 'Households renting', value: Math.round((0.16 + k * 0.18) * 100) / 100, unit: 'pct' as const, national: 0.19, geography, year: 2022, source_id: 'cso' },
    { key: 'vacancy_rate', label: 'Vacancy rate', value: Math.round((0.11 - k * 0.05) * 1000) / 1000, unit: 'pct' as const, national: 0.078, geography, year: 2022, source_id: 'cso' },
    { key: 'population_change', label: 'Population change since 2016', value: Math.round((0.04 + k * 0.08) * 1000) / 1000, unit: 'pct' as const, national: 0.081, geography, year: 2022, source_id: 'cso' },
  ]
}

// ---------- geocoding ----------

export const LISTINGS: Listing[] = [...buildListings(), ...buildCountyListings()]

const EXTRA_ADDRESSES: GeocodeResult[] = [
  { place_id: 'geo_guinness', label: 'St James\'s Gate, Dublin 8, D08 VF8H', location: { lng: -6.28690, lat: 53.34180 }, area: 'Dublin 8' },
  { place_id: 'geo_rialto', label: 'Rialto Cottages, Rialto, Dublin 8', location: { lng: -6.29560, lat: 53.33680 }, area: 'Dublin 8' },
  { place_id: 'geo_portobello', label: 'Portobello Road, Dublin 8', location: { lng: -6.26890, lat: 53.33130 }, area: 'Dublin 8' },
  { place_id: 'geo_smithfield', label: 'Smithfield Square, Dublin 7', location: { lng: -6.27830, lat: 53.34800 }, area: 'Dublin 7' },
]

const TOWN_ADDRESSES: GeocodeResult[] = COUNTY_TOWNS.map(t => ({
  place_id: `geo_town_${t.county.toLowerCase()}`, label: `${t.area}, Co. ${t.county}`, location: { lng: t.lng, lat: t.lat }, area: t.area,
}))

export const GEOCODE_INDEX: GeocodeResult[] = [
  ...EXTRA_ADDRESSES,
  ...TOWN_ADDRESSES,
  ...LISTINGS.map(l => ({ place_id: `geo_${l.id}`, label: l.address, location: l.location, area: l.area })),
]

export type { Claim, Evidence }

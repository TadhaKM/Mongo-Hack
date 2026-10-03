// In-memory mock of the analysis pipeline. Owned by Agent A.
// An analysis is just { input, startedAt }; its state is derived from elapsed time,
// so SSE, polling and the section endpoints always agree.
import type {
  AnalyseRequest, Analysis, AnalysisEvent, Claim, ComparablesResponse, Evidence, LngLat, LocationResponse,
  PlanningResponse, PropertyType, ReportResponse, Stage, StageKey,
} from '../../app/types/api'
import {
  COMPARABLES_FOUND, COUNTY_TOWNS, RENT_DATA_PERIOD, DEMO_LISTING_ID, DUBLIN_8_CENTER, GEOCODE_INDEX, distanceM, LISTINGS, SOURCES, amenitiesNear, areaBase, areaMedian, areaStats, comparablesFor,
  planningNear, quantile, transportNear, trendFor, verdictFor,
} from './data'
import { eur, metres, pct } from '../../app/lib/format'

interface StoredAnalysis {
  id: string
  startedAt: number
  input: Analysis['input']
  location: LngLat
  area: string
  failStage: StageKey | null
}

interface TimelineStep { stage: StageKey; start: number; end: number; running: string; done: (a: StoredAnalysis) => string; detail?: (a: StoredAnalysis) => string; counts?: (a: StoredAnalysis) => Record<string, number> }

const TIMELINE: TimelineStep[] = [
  { stage: 'geocode', start: 0, end: 900, running: 'Locating property…', done: a => `Property identified: ${a.area}` },
  { stage: 'market', start: 900, end: 2300, running: 'Retrieving rental market data…', done: () => `Rental market data retrieved (RTB, ${RENT_DATA_PERIOD})` },
  {
    stage: 'comparables', start: 2300, end: 4400, running: 'Finding comparable properties…',
    done: () => `${COMPARABLES_FOUND} comparable properties found`,
    detail: a => `${a.input.bedrooms === 0 ? 'Studios' : `${a.input.bedrooms}-bed ${a.input.property_type.replace('_', ' ')}s`} within 1.5 km, Jan 2025 to Sep 2026`,
    counts: () => ({ comparables: COMPARABLES_FOUND }),
  },
  {
    stage: 'transport', start: 4400, end: 5700, running: 'Analysing transport…',
    done: a => (transportNear(a.location, 800).length ? `${transportNear(a.location, 800).length} stops within 800 m` : 'No transport data for this area yet'),
    detail: a => (transportNear(a.location, 2000).length ? '' : 'The sample transport data covers Dublin 8 only'),
    counts: a => ({ stops: transportNear(a.location, 800).length }),
  },
  { stage: 'area', start: 5700, end: 6800, running: 'Reading census data…', done: () => 'Area profile built', detail: a => (a.area.startsWith('Dublin') ? 'Census 2022, Merchants Quay C' : `Census 2022, ${a.area}`) },
  {
    stage: 'planning', start: 6800, end: 8300, running: 'Checking planning applications…',
    done: a => `${planningNear(a.location).length} nearby applications`,
    counts: a => ({ applications: planningNear(a.location).length }),
  },
  { stage: 'report', start: 8300, end: 10300, running: 'Generating report…', done: () => 'Report ready' },
]
const COMPLETE_AT = 10_500

const store = new Map<string, StoredAnalysis>()

/** For a dropped pin: the nearest sample area (Dublin 8 or a county town). */
function nearestArea(p: LngLat): string {
  const candidates = [{ area: 'Dublin 8', lng: DUBLIN_8_CENTER.lng, lat: DUBLIN_8_CENTER.lat }, ...COUNTY_TOWNS]
  return candidates.reduce((best, c) => (distanceM(p, c) < distanceM(p, best) ? c : best)).area
}

// ---------- create / lookup ----------

export function createAnalysis(body: AnalyseRequest): StoredAnalysis | { error: { code: string; message: string } } {
  let input: Analysis['input']
  let location: LngLat
  let area: string
  let id: string

  if (body.property_id) {
    const listing = LISTINGS.find(l => l.id === body.property_id)
    if (!listing) return { error: { code: 'ADDRESS_NOT_FOUND', message: 'That listing no longer exists.' } }
    input = {
      property_id: listing.id, address: listing.address, monthly_rent: listing.rent, bedrooms: listing.bedrooms,
      property_type: listing.property_type, floor_area_m2: listing.floor_area_m2 ?? undefined, furnished: listing.furnished,
    }
    location = listing.location
    area = listing.area
    // Unique per run, so two people testing the demo pin never restart each other's check.
    // (GET /analysis/an_demo still works: unknown ids come back as a finished demo analysis.)
    id = `an_${listing.id.replace('lst_', '')}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
  }
  else {
    if (!body.address || body.monthly_rent == null || body.bedrooms == null || !body.property_type)
      return { error: { code: 'VALIDATION', message: 'address, monthly_rent, bedrooms and property_type are required.' } }
    input = { ...body, address: body.address, monthly_rent: body.monthly_rent, bedrooms: body.bedrooms, property_type: body.property_type }
    const listing = LISTINGS.find(l => `geo_${l.id}` === body.place_id)
    const place = GEOCODE_INDEX.find(g => g.place_id === body.place_id)
    location = listing?.location ?? place?.location ?? body.location ?? DUBLIN_8_CENTER
    area = listing?.area ?? place?.area ?? nearestArea(location)
    id = `an_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
  }

  // Test hook for error states: put "FAIL_PLANNING" or "FAIL_ALL" in the address.
  const failStage: StageKey | null = /FAIL_ALL/.test(input.address) ? 'comparables' : /FAIL_PLANNING/.test(input.address) ? 'planning' : null
  const stored: StoredAnalysis = { id, startedAt: Date.now(), input, location, area, failStage }
  store.set(id, stored)
  return stored
}

/** Unknown ids (e.g. after a dev-server restart) come back as an already-complete demo analysis. */
export function getStored(id: string): StoredAnalysis {
  const existing = store.get(id)
  if (existing) return existing
  const created = createAnalysis({ property_id: DEMO_LISTING_ID }) as StoredAnalysis
  const restored = { ...created, id, startedAt: Date.now() - COMPLETE_AT - 1000 }
  store.set(id, restored)
  return restored
}

// ---------- timeline ----------

const failedAll = (a: StoredAnalysis) => a.failStage === 'comparables'

export function stagesAt(a: StoredAnalysis, elapsed: number): Stage[] {
  return TIMELINE.map((step) => {
    const failsHere = a.failStage === step.stage
    const afterFatal = failedAll(a) && TIMELINE.indexOf(step) > TIMELINE.findIndex(s => s.stage === 'comparables')
    if (afterFatal || elapsed < step.start) return { stage: step.stage, status: 'pending', label: step.running }
    if (elapsed < step.end) return { stage: step.stage, status: 'running', label: step.running }
    if (failsHere) return { stage: step.stage, status: 'failed', label: step.running, detail: 'Source did not respond in time' }
    return {
      stage: step.stage, status: 'done', label: step.done(a),
      ...(step.detail ? { detail: step.detail(a) } : {}),
      ...(step.counts ? { counts: step.counts(a) } : {}),
    }
  })
}

export function isStageDone(a: StoredAnalysis, stage: StageKey): boolean {
  return stagesAt(a, Date.now() - a.startedAt).find(s => s.stage === stage)?.status === 'done'
}

/** The ordered list of events this analysis emits, each with its offset in ms. */
export function eventTimeline(a: StoredAnalysis): { at: number; event: AnalysisEvent }[] {
  const out: { at: number; event: AnalysisEvent }[] = []
  for (const step of TIMELINE) {
    const before = stagesAt(a, step.start).find(s => s.stage === step.stage)!
    out.push({ at: step.start, event: { type: 'stage', at: '', ...before } })
    const after = stagesAt(a, step.end).find(s => s.stage === step.stage)!
    out.push({ at: step.end, event: { type: 'stage', at: '', ...after } })
    if (after.status === 'failed' && failedAll(a)) {
      out.push({ at: step.end + 200, event: { type: 'failed', error: { code: 'ANALYSIS_FAILED', message: 'Comparable data could not be retrieved, so no verdict could be made.' } } })
      return out
    }
  }
  out.push({ at: COMPLETE_AT, event: { type: 'complete' } })
  return out
}

// ---------- derived content ----------

function comparablesOf(a: StoredAnalysis) {
  const items = comparablesFor(a.location, a.input.bedrooms, a.input.property_type as PropertyType, areaBase(a.area))
  const rents = items.map(c => c.rent).sort((x, y) => x - y)
  return {
    items,
    stats: { count: items.length, median: Math.round(quantile(rents, 0.5)), p10: Math.round(quantile(rents, 0.1)), p90: Math.round(quantile(rents, 0.9)) },
  }
}

function buildSummary(a: StoredAnalysis) {
  const { items, stats } = comparablesOf(a)
  const asking = a.input.monthly_rent
  const differenceEur = asking - stats.median
  const differencePct = Math.round((differenceEur / stats.median) * 1000) / 10
  const percentile = Math.round((items.filter(c => c.rent < asking).length / items.length) * 100)
  const verdict = verdictFor(differencePct)
  const trend = trendFor(areaMedian(a.input.bedrooms, a.input.property_type as PropertyType, areaBase(a.area)), a.area)
  const typeLabel = a.input.bedrooms === 0 ? 'studios' : `${a.input.bedrooms}-bed ${a.input.property_type.replace('_', ' ')}s`

  const evidence: Evidence[] = [
    { id: 'e_asking', label: 'Asking rent', value: eur(asking), scope: 'Entered by you', source_id: 'user' },
    { id: 'e_median', label: 'Comparable median', value: eur(stats.median), scope: `${typeLabel} within 1.5 km, Jan 2025 to Sep 2026`, source_id: 'rtb', observations: stats.count },
    { id: 'e_range', label: 'Comparable range (P10 to P90)', value: `${eur(stats.p10)} to ${eur(stats.p90)}`, scope: `${typeLabel} within 1.5 km`, source_id: 'rtb', observations: stats.count },
    { id: 'e_percentile', label: 'Comparables cheaper than asking', value: `${items.filter(c => c.rent < asking).length} of ${stats.count}`, scope: 'Same comparable set', source_id: 'rtb', observations: stats.count },
    { id: 'e_filtered', label: 'Comparables found vs used', value: `${COMPARABLES_FOUND} found, ${stats.count} used`, scope: `${COMPARABLES_FOUND - stats.count} excluded: different bedroom count or older than 18 months`, source_id: 'rtb', observations: COMPARABLES_FOUND },
    { id: 'e_trend', label: 'Area median change, last 12 months', value: pct(trend.change_12m_pct, { sign: true, decimals: 1 }), scope: `RTB standardised rent, ${a.area}`, source_id: 'rtb' },
  ]

  const claims: Claim[] = []
  if (verdict === 'in_line') {
    claims.push({ id: 'c_verdict', text: `The asking rent is within 5% of the median for similar ${typeLabel} nearby.`, evidence_ids: ['e_asking', 'e_median'] })
  }
  else {
    claims.push({ id: 'c_verdict', text: `The asking rent is ${pct(Math.abs(differencePct))} ${verdict === 'above_market' ? 'above' : 'below'} the median for similar ${typeLabel} nearby (${eur(stats.median)}).`, evidence_ids: ['e_asking', 'e_median'] })
  }
  claims.push({ id: 'c_percentile', text: `It is higher than ${percentile}% of the ${stats.count} comparable rents.`, evidence_ids: ['e_percentile', 'e_range', 'e_filtered'] })
  claims.push({ id: 'c_trend', text: `Rents in ${a.area} rose ${pct(trend.change_12m_pct, { decimals: 1 })} over the last 12 months, which explains ${verdict === 'above_market' && differencePct > trend.change_12m_pct ? 'part of the gap but not all of it' : 'much of the current level'}.`, evidence_ids: ['e_trend'] })

  const observations = stats.count
  const confidence = {
    level: observations >= 30 ? 'high' as const : observations >= 10 ? 'medium' as const : 'low' as const,
    reasons: [`${observations} comparable observations`, 'All within 18 months', 'All within 1.5 km'],
  }

  return {
    summary: {
      verdict, asking, median: stats.median, p10: stats.p10, p90: stats.p90,
      difference_eur: differenceEur, difference_pct: differencePct, percentile,
      observations, period: { from: '2025-01', to: '2026-09' }, radius_m: 1500, confidence, claims,
    },
    trend,
    evidence,
  }
}

function buildArea(a: StoredAnalysis) {
  const stats = areaStats(a.area)
  const renting = stats.find(s => s.key === 'renting')!
  const vacancy = stats.find(s => s.key === 'vacancy_rate')!
  const evidence: Evidence[] = [
    { id: 'e_renting', label: 'Households renting', value: pct(renting.value * 100), scope: `${renting.geography}, Census ${renting.year}. National: ${pct(renting.national! * 100)}`, source_id: 'cso' },
    { id: 'e_vacancy', label: 'Vacancy rate', value: pct(vacancy.value * 100, { decimals: 1 }), scope: `${vacancy.geography}, Census ${vacancy.year}. National: ${pct(vacancy.national! * 100, { decimals: 1 })}`, source_id: 'cso' },
  ]
  const claims: Claim[] = [
    { id: 'c_area_renting', text: `About ${pct(renting.value * 100)} of households here rent, three times the national rate, so the rental market is deep.`, evidence_ids: ['e_renting'] },
    { id: 'c_area_vacancy', text: `Vacancy is below the national average, which points to tight supply in ${a.area}.`, evidence_ids: ['e_vacancy'] },
  ]
  return { area: { stats, claims }, evidence }
}

export function buildAnalysis(a: StoredAnalysis): Analysis {
  const elapsed = Date.now() - a.startedAt
  const stages = stagesAt(a, elapsed)
  const done = (s: StageKey) => stages.find(x => x.stage === s)?.status === 'done'
  const fatal = failedAll(a) && stages.some(s => s.status === 'failed')
  const status: Analysis['status'] = fatal ? 'failed' : elapsed >= COMPLETE_AT ? 'complete' : 'running'

  const core = done('comparables') && done('market') ? buildSummary(a) : null
  const area = done('area') ? buildArea(a) : null
  const limitations = [
    'Sample data: this demo uses fixtures shaped like RTB, CSO, NTA and planning data, not live figures.',
    'RTB figures reflect registered tenancies, not current asking prices.',
    ...(a.input.floor_area_m2 ? [] : ['Floor area was not provided, so comparables were matched on bedrooms and type only.']),
    ...(transportNear(a.location, 2000).length ? [] : ['Transport stops in this demo are sampled for Dublin 8 only, so none are shown here.']),
    'Planning status may have changed since the data was retrieved.',
  ]

  return {
    id: a.id,
    status,
    created_at: new Date(a.startedAt).toISOString(),
    input: a.input,
    property: { location: a.location, area: a.area, eircode: a.area === 'Dublin 8' ? 'D08' : null },
    stages,
    summary: status === 'complete' || done('report') ? core?.summary ?? null : null,
    trend: core?.trend ?? null,
    area: area?.area ?? null,
    evidence: [...(core?.evidence ?? []), ...(area?.evidence ?? []), ...locationEvidence(a), ...planningEvidence(a)],
    sources: [{ id: 'user', name: 'Your details', publisher: 'Entered by you', url: '', data_period: 'Today', retrieved_at: new Date(a.startedAt).toISOString().slice(0, 10) }, ...SOURCES],
    limitations,
    error: status === 'failed' ? { code: 'ANALYSIS_FAILED', message: 'Comparable data could not be retrieved, so no verdict could be made.' } : null,
  }
}

function locationEvidence(a: StoredAnalysis): Evidence[] {
  const stops = transportNear(a.location)
  const luas = stops.find(s => s.mode === 'luas')
  return [
    ...(luas ? [{ id: 'e_luas', label: `Nearest Luas: ${luas.name}`, value: `${metres(luas.distance_m)} · ${luas.walk_min} min walk`, scope: `Straight-line distance at 80 m/min, ${luas.routes.join(', ')} line`, source_id: 'nta_gtfs' }] : []),
    { id: 'e_stops', label: 'Stops within 800 m', value: transportNear(a.location, 800).length, scope: 'Luas, rail and bus stops from GTFS', source_id: 'nta_gtfs' },
  ]
}

function planningEvidence(a: StoredAnalysis): Evidence[] {
  return planningNear(a.location).map(p => ({
    id: `e_${p.id}`, label: p.reference, value: p.status, scope: `${p.summary}, ${metres(p.distance_m)} away`, source_id: 'planning',
  }))
}

export function buildComparables(a: StoredAnalysis): ComparablesResponse {
  return comparablesOf(a)
}

export function buildLocation(a: StoredAnalysis): LocationResponse {
  const transport = transportNear(a.location)
  const luas = transport.find(s => s.mode === 'luas')
  const claims: Claim[] = [
    ...(luas ? [{ id: 'c_luas', text: `The Luas ${luas.routes[0]} Line (${luas.name}) is ${luas.walk_min} minutes' walk away.`, evidence_ids: ['e_luas'] }] : []),
    ...(transport.length ? [{ id: 'c_stops', text: `${transportNear(a.location, 800).length} public transport stops are within 800 m.`, evidence_ids: ['e_stops'] }] : []),
  ]
  return { transport, amenities: amenitiesNear(a.location), claims, source_ids: ['nta_gtfs', 'osm'] }
}

export function buildPlanning(a: StoredAnalysis): PlanningResponse {
  const items = planningNear(a.location)
  const granted = items.find(p => p.status === 'granted')
  const claims: Claim[] = granted
    ? [{ id: 'c_planning', text: `A ${granted.summary.toLowerCase()} was granted ${metres(granted.distance_m)} away, which may add rental supply.`, evidence_ids: [`e_${granted.id}`] }]
    : []
  return { items, claims, source_ids: ['planning'] }
}

export function buildReport(a: StoredAnalysis): ReportResponse {
  return {
    analysis: buildAnalysis(a),
    comparables: buildComparables(a),
    location: buildLocation(a),
    planning: buildPlanning(a),
    generated_at: new Date().toISOString(),
    disclaimer: 'mend.ai is a decision-support tool, not a valuation or legal advice. Check important details with the landlord and the RTB.',
  }
}

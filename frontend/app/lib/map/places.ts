// Common Dublin commute destinations, suggested instantly in the Commute card.
// Names are what Google Maps resolves well; no coordinates needed for a directions link.

export type PlaceKind = 'study' | 'work' | 'health' | 'travel'

export interface Place { name: string; detail: string; kind: PlaceKind; aliases?: string[] }

export const COMMUTE_PLACES: Place[] = [
  { name: 'Trinity College Dublin', detail: 'College Green, Dublin 2', kind: 'study', aliases: ['tcd'] },
  { name: 'University College Dublin', detail: 'Belfield, Dublin 4', kind: 'study', aliases: ['ucd'] },
  { name: 'Dublin City University', detail: 'Glasnevin, Dublin 9', kind: 'study', aliases: ['dcu'] },
  { name: 'TU Dublin Grangegorman', detail: 'Grangegorman, Dublin 7', kind: 'study', aliases: ['tud', 'dit'] },
  { name: 'RCSI', detail: "St Stephen's Green, Dublin 2", kind: 'study', aliases: ['royal college of surgeons'] },
  { name: 'Griffith College Dublin', detail: 'South Circular Road, Dublin 8', kind: 'study' },
  { name: 'National College of Art and Design', detail: 'Thomas Street, Dublin 8', kind: 'study', aliases: ['ncad'] },
  { name: 'Grand Canal Dock', detail: 'Silicon Docks, Dublin 2', kind: 'work', aliases: ['silicon docks'] },
  { name: 'IFSC', detail: 'North Wall Quay, Dublin 1', kind: 'work', aliases: ['financial services centre', 'docklands'] },
  { name: "St Stephen's Green", detail: 'City centre, Dublin 2', kind: 'work', aliases: ['city centre'] },
  { name: 'Sandyford Business District', detail: 'Sandyford, Dublin 18', kind: 'work' },
  { name: 'Citywest Business Campus', detail: 'Citywest, Dublin 24', kind: 'work' },
  { name: 'Dublin Airport', detail: 'Collinstown, Co. Dublin', kind: 'work', aliases: ['airport'] },
  { name: "St James's Hospital", detail: "James's Street, Dublin 8", kind: 'health' },
  { name: 'Mater Misericordiae University Hospital', detail: 'Eccles Street, Dublin 7', kind: 'health', aliases: ['mater'] },
  { name: 'Beaumont Hospital', detail: 'Beaumont, Dublin 9', kind: 'health' },
  { name: "St Vincent's University Hospital", detail: 'Elm Park, Dublin 4', kind: 'health' },
  { name: 'Tallaght University Hospital', detail: 'Tallaght, Dublin 24', kind: 'health' },
  { name: 'Heuston Station', detail: 'Dublin 8', kind: 'travel' },
  { name: 'Connolly Station', detail: 'Amiens Street, Dublin 1', kind: 'travel' },
]

/** Places where every typed word starts a word in the name, area or an alias ("tri" → Trinity, not District). */
export function matchPlaces(query: string, limit = 5): Place[] {
  const norm = (v: string) => v.toLowerCase().replace(/['’]/g, '')
  const words = norm(query).trim().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  return COMMUTE_PLACES.filter((p) => {
    const tokens = norm([p.name, p.detail, ...(p.aliases ?? [])].join(' ')).split(/[\s,.-]+/)
    return words.every(w => tokens.some(t => t.startsWith(w)))
  }).slice(0, limit)
}

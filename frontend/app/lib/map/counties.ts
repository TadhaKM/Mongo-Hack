import type { BBox } from './geo'

// The 26 counties covered by the RTB (Republic of Ireland), with approximate
// bounds [west, south, east, north]. Used to fly the map to a county: listings are
// fetched for whatever is on screen, so no API change is needed to "filter" by county.
export const COUNTIES: { name: string; bbox: BBox }[] = [
  { name: 'Carlow', bbox: [-7.11, 52.47, -6.5, 52.92] },
  { name: 'Cavan', bbox: [-7.98, 53.72, -6.75, 54.34] },
  { name: 'Clare', bbox: [-9.95, 52.55, -8.28, 53.17] },
  { name: 'Cork', bbox: [-10.25, 51.42, -7.84, 52.39] },
  { name: 'Donegal', bbox: [-8.8, 54.46, -6.92, 55.44] },
  { name: 'Dublin', bbox: [-6.55, 53.2, -6.03, 53.64] },
  { name: 'Galway', bbox: [-10.25, 52.96, -7.97, 53.7] },
  { name: 'Kerry', bbox: [-10.68, 51.68, -9.21, 52.6] },
  { name: 'Kildare', bbox: [-7.18, 52.86, -6.46, 53.46] },
  { name: 'Kilkenny', bbox: [-7.62, 52.24, -6.92, 52.86] },
  { name: 'Laois', bbox: [-7.77, 52.78, -6.93, 53.2] },
  { name: 'Leitrim', bbox: [-8.47, 53.76, -7.65, 54.48] },
  { name: 'Limerick', bbox: [-9.37, 52.29, -8.14, 52.77] },
  { name: 'Longford', bbox: [-8.03, 53.52, -7.34, 53.94] },
  { name: 'Louth', bbox: [-6.72, 53.71, -6.07, 54.12] },
  { name: 'Mayo', bbox: [-10.29, 53.47, -8.56, 54.35] },
  { name: 'Meath', bbox: [-7.35, 53.38, -6.21, 53.92] },
  { name: 'Monaghan', bbox: [-7.35, 53.89, -6.55, 54.42] },
  { name: 'Offaly', bbox: [-8.08, 52.85, -6.98, 53.45] },
  { name: 'Roscommon', bbox: [-8.82, 53.27, -7.85, 54.12] },
  { name: 'Sligo', bbox: [-9.1, 53.89, -8.15, 54.47] },
  { name: 'Tipperary', bbox: [-8.48, 52.2, -7.37, 53.17] },
  { name: 'Waterford', bbox: [-8.15, 51.94, -6.95, 52.36] },
  { name: 'Westmeath', bbox: [-7.98, 53.36, -6.97, 53.8] },
  { name: 'Wexford', bbox: [-6.95, 52.12, -6.13, 52.8] },
  { name: 'Wicklow', bbox: [-6.8, 52.84, -6.0, 53.24] },
]

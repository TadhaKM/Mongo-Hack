// Single place to swap the basemap if the venue Wi-Fi struggles.
export const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty'
export const MAP_STYLE_FALLBACK = 'https://tiles.openfreemap.org/styles/positron'
export const STYLE_LOAD_TIMEOUT_MS = 8000

/** Dublin 8 (around James's / Rialto). [lng, lat] */
export const DUBLIN_CENTER: [number, number] = [-6.283, 53.338]

/** Liberty draws 3D buildings in this layer from zoom 14. */
export const BUILDING_LAYER = 'building-3d'
export const BUILDING_MIN_ZOOM = 14

export const DESKTOP_QUERY = '(min-width: 1024px)'
/** Desktop side panel width + gutter, used as camera padding. */
export const PANEL_PADDING_LEFT = 420

export interface CameraPreset { zoom: number; pitch: number; bearing: number }

export const CAMERA = {
  browse: { zoom: 14.5, pitch: 45, bearing: -10 },
  mobileBrowse: { zoom: 14, pitch: 0, bearing: 0 },
  selected: { zoom: 17, pitch: 60, bearing: -20 },
  analysis: { zoom: 15, pitch: 55, bearing: -20 },
} satisfies Record<string, CameraPreset>

export const FLY_DURATION_MS = 1500
export const BBOX_DEBOUNCE_MS = 300
export const PITCH_3D = 60

/** Default buildings are softened so the selected one pops. */
export const BUILDING_SOFT_COLOR = '#e7e5e4'
export const BUILDING_SOFT_OPACITY = 0.85

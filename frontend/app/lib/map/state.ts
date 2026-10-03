import { useState } from '#imports'
import type { PropertyType } from '~/types/api'
import type { BBox } from './geo'

export interface ListingFilters { bedrooms?: number; max_rent?: number; type?: PropertyType }
export type AnalysisLayerKey = 'comparables' | 'transport' | 'planning' | 'radius'

/** Map-side UI state shared by the shell, map, filters and list (B only). */
export function useMapUi() {
  return {
    bbox: useState<BBox | null>('map:bbox', () => null),
    filters: useState<ListingFilters>('map:filters', () => ({})),
    /** null = use the device default (3D on desktop, 2D on mobile). */
    is3D: useState<boolean | null>('map:3d', () => null),
    visited: useState<string[]>('map:visited', () => []),
    layers: useState<Record<AnalysisLayerKey, boolean>>('map:layers', () => ({ comparables: true, transport: true, planning: true, radius: true })),
    sameBedroomsOnly: useState<boolean>('map:same-beds', () => false),
    /** Bumped by the recentre control. */
    recentre: useState<number>('map:recentre', () => 0),
  }
}

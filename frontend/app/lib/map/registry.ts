import type { InjectionKey } from 'vue'
import type { LngLat } from '~/types/api'
import type { FeatureId } from '~/composables/useMapSelection'

/**
 * Analysis layers register where their features are, so the map can
 * focusFeature(id) and frame everything when an analysis completes.
 */
export class FeatureRegistry {
  private groups = new Map<string, Map<FeatureId, LngLat>>()

  set(group: string, entries: [FeatureId, LngLat][]) {
    this.groups.set(group, new Map(entries))
  }

  clear(group: string) {
    this.groups.delete(group)
  }

  get(id: FeatureId): LngLat | undefined {
    for (const g of this.groups.values()) {
      const hit = g.get(id)
      if (hit) return hit
    }
    return undefined
  }

  all(): LngLat[] {
    return [...this.groups.values()].flatMap(g => [...g.values()])
  }
}

export const REGISTRY_KEY: InjectionKey<FeatureRegistry> = Symbol('mend-feature-registry')

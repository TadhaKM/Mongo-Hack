import { keepPreviousData, useQuery } from '@tanstack/vue-query'
import { refDebounced } from '@vueuse/core'
import type { MaybeRefOrGetter } from 'vue'
import type { CommuteResponse, LngLat } from '~/types/api'
import { ApiRequestError } from './client'

/**
 * Walk / cycle / public transport / drive times from a property to a place the renter names.
 * Always served by this Nuxt app's own server route (/api/commute), whatever apiBase points at.
 */
export function useCommute(from: MaybeRefOrGetter<LngLat | null>, destination: MaybeRefOrGetter<string>) {
  const q = refDebounced(computed(() => toValue(destination).trim()), 600)
  return useQuery({
    queryKey: computed(() => ['commute', toValue(from)?.lng, toValue(from)?.lat, q.value] as const),
    queryFn: async ({ signal }) => {
      const f = toValue(from)!
      try {
        return await $fetch<CommuteResponse>('/api/commute', { signal, query: { from: `${f.lng},${f.lat}`, q: q.value } })
      }
      catch (err: unknown) {
        const e = err as { statusCode?: number; data?: { error?: { code: string; message: string } } }
        throw new ApiRequestError(e.statusCode ?? 0, e.data?.error?.code ?? 'NETWORK', e.data?.error?.message ?? 'Route times aren\'t available right now.')
      }
    },
    enabled: computed(() => !!toValue(from) && q.value.length >= 3),
    placeholderData: keepPreviousData,
    staleTime: 30 * 60_000,
    retry: false,
  })
}

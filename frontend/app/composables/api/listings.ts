import { keepPreviousData, useQuery } from '@tanstack/vue-query'
import { refDebounced } from '@vueuse/core'
import { toast } from 'vue-sonner'
import type { MaybeRefOrGetter, Ref } from 'vue'
import type { GeocodeResponse, Listing, ListingsResponse, PropertyType } from '~/types/api'
import { ApiRequestError, apiFetch } from './client'

export type BBox = [number, number, number, number]
export interface ListingFilters { bedrooms?: number; max_rent?: number; type?: PropertyType }

/** Listings inside the map viewport. Keeps the previous page while panning so pins don't flash. */
export function useListings(bbox: Ref<BBox | null>, filters: Ref<ListingFilters>) {
  const query = useQuery({
    queryKey: computed(() => ['listings', bbox.value?.map(n => n.toFixed(4)).join(','), filters.value] as const),
    queryFn: ({ signal }) => apiFetch<ListingsResponse>('/listings', {
      signal,
      query: {
        bbox: bbox.value!.join(','),
        bedrooms: filters.value.bedrooms,
        max_rent: filters.value.max_rent,
        type: filters.value.type,
      },
    }),
    enabled: computed(() => !!bbox.value),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: 2,
  })
  // Server errors are non-blocking: keep the last pins and say so once.
  if (import.meta.client) {
    watch(query.error, (err) => {
      if (err && (!(err instanceof ApiRequestError) || err.status >= 500 || err.status === 0))
        toast.error('Couldn\'t load listings, retrying', { id: 'listings-error' })
    })
  }
  return query
}

export function useListing(id: MaybeRefOrGetter<string | null>) {
  return useQuery({
    queryKey: computed(() => ['listing', toValue(id)] as const),
    queryFn: ({ signal }) => apiFetch<Listing>(`/listings/${toValue(id)}`, { signal }),
    enabled: computed(() => !!toValue(id)),
    staleTime: 5 * 60_000,
  })
}

/** Address / Eircode search, debounced 250 ms, enabled from 3 characters. */
export function useGeocode(q: Ref<string>) {
  const debounced = refDebounced(computed(() => q.value.trim()), 250)
  return useQuery({
    queryKey: computed(() => ['geocode', debounced.value] as const),
    queryFn: ({ signal }) => apiFetch<GeocodeResponse>('/geocode', { signal, query: { q: debounced.value } }),
    enabled: computed(() => debounced.value.length >= 3),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  })
}

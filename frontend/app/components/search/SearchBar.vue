<script setup lang="ts">
import { Loader2, MapPin, Search, X } from '@lucide/vue'
import { onClickOutside } from '@vueuse/core'
import type { GeocodeResult } from '~/types/api'
import { useMapUi } from '~/lib/map/state'

const sel = useMapSelection()
const ui = useMapUi()
const { data: listingsData } = useListings(ui.bbox, ui.filters)

const q = ref('')
const open = ref(false)
const active = ref(0)
const root = ref<HTMLElement>()
const { data, isFetching } = useGeocode(q)
const results = computed(() => (q.value.length >= 3 ? data.value?.results ?? [] : []))

watch(results, () => { active.value = 0 })
onClickOutside(root, () => { open.value = false })

/** Same building as a listing (within ~20 m) → open the listing instead of a dropped pin. */
function listingAt(r: GeocodeResult) {
  const kx = 111320 * Math.cos((r.location.lat * Math.PI) / 180)
  return listingsData.value?.items.find(l =>
    Math.hypot((l.location.lng - r.location.lng) * kx, (l.location.lat - r.location.lat) * 110540) < 20)
}

function choose(r: GeocodeResult) {
  open.value = false
  q.value = r.label
  const listing = listingAt(r)
  if (listing) sel.selectListing(listing.id)
  else sel.dropPin({ location: r.location, address: r.label, place_id: r.place_id })
}

function onKey(e: KeyboardEvent) {
  if (!results.value.length) return
  if (e.key === 'ArrowDown') { e.preventDefault(); open.value = true; active.value = (active.value + 1) % results.value.length }
  else if (e.key === 'ArrowUp') { e.preventDefault(); active.value = (active.value - 1 + results.value.length) % results.value.length }
  else if (e.key === 'Enter') { e.preventDefault(); const r = results.value[active.value]; if (r) choose(r) }
  else if (e.key === 'Escape') { open.value = false }
}

function clear() {
  q.value = ''
  open.value = false
}
</script>

<template>
  <div ref="root" class="relative">
    <div class="flex h-12 items-center gap-2 rounded-xl border bg-background px-3 shadow-lg focus-within:ring-2 focus-within:ring-brand/40">
      <Search class="size-4 shrink-0 text-muted-foreground" />
      <input
        v-model="q"
        type="search"
        role="combobox"
        aria-label="Search an address or Eircode"
        aria-autocomplete="list"
        :aria-expanded="open && results.length > 0"
        aria-controls="rc-search-results"
        :aria-activedescendant="open && results.length ? `rc-search-${active}` : undefined"
        placeholder="Search an address or Eircode"
        autocomplete="off"
        class="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        @focus="open = true"
        @input="open = true"
        @keydown="onKey"
      >
      <Loader2 v-if="isFetching" class="size-4 shrink-0 animate-spin text-muted-foreground" />
      <button v-else-if="q" type="button" class="grid size-8 place-items-center rounded-md hover:bg-muted" aria-label="Clear search" @click="clear">
        <X class="size-4" />
      </button>
    </div>

    <ul
      v-if="open && results.length"
      id="rc-search-results"
      role="listbox"
      class="absolute inset-x-0 top-[calc(100%+6px)] z-40 overflow-hidden rounded-xl border bg-background py-1 shadow-xl"
    >
      <li
        v-for="(r, i) in results"
        :id="`rc-search-${i}`"
        :key="r.place_id"
        role="option"
        :aria-selected="i === active"
        class="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm"
        :class="i === active ? 'bg-muted' : ''"
        @mouseenter="active = i"
        @mousedown.prevent="choose(r)"
      >
        <MapPin class="size-4 shrink-0 text-muted-foreground" />
        <div class="min-w-0">
          <div class="truncate font-medium">{{ r.label }}</div>
          <div class="truncate text-xs text-muted-foreground">{{ r.area }}</div>
        </div>
      </li>
    </ul>
    <div
      v-else-if="open && q.length >= 3 && !isFetching && data && !results.length"
      class="absolute inset-x-0 top-[calc(100%+6px)] z-40 rounded-xl border bg-background px-3 py-3 text-sm text-muted-foreground shadow-xl"
    >
      No Irish address found. Try an Eircode, or right-click / long-press the map to drop a pin.
    </div>
  </div>
</template>

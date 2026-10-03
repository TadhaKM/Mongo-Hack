<script setup lang="ts">
import type { Component } from 'vue'
import { Bike, Briefcase, Footprints, GraduationCap, Hospital, Loader2, MapPin, Route, TrainFront } from '@lucide/vue'
import type { LngLat } from '~/types/api'
import MapCard from './MapCard.vue'
import { matchPlaces, type PlaceKind } from '~/lib/map/places'

// "Commute": directions from the property to the renter's work or college in
// Google Maps (a link, no API key). The destination is remembered in this browser.
const props = defineProps<{ from: LngLat; label: string; x: number; y: number; desktop: boolean }>()
const emit = defineEmits<{ closed: [] }>()

const STORAGE_KEY = 'rc:commute-destination'
function load(): string {
  try { return localStorage.getItem(STORAGE_KEY) ?? '' }
  catch { return '' }
}

const destination = ref(load())
type Mode = 'transit' | 'walking' | 'bicycling'
const mode = ref<Mode>('transit')
const MODES: { key: Mode; label: string; icon: unknown }[] = [
  { key: 'transit', label: 'Transit', icon: TrainFront },
  { key: 'walking', label: 'Walk', icon: Footprints },
  { key: 'bicycling', label: 'Cycle', icon: Bike },
]

const url = computed(() => {
  const q = new URLSearchParams({
    api: '1',
    origin: `${props.from.lat},${props.from.lng}`,
    destination: destination.value.trim(),
    travelmode: mode.value,
  })
  return `https://www.google.com/maps/dir/?${q}`
})

const input = ref<HTMLInputElement>()
onMounted(() => { if (!destination.value) input.value?.focus() })

// --- type-ahead: common Dublin destinations instantly, then address search ---
interface Suggestion { key: string; label: string; detail: string; value: string; icon: Component }
const KIND_ICON: Record<PlaceKind, Component> = { study: GraduationCap, work: Briefcase, health: Hospital, travel: TrainFront }

const open = ref(false)
const active = ref(0)
const { data: geo, isFetching } = useGeocode(destination)
const suggestions = computed<Suggestion[]>(() => {
  const q = destination.value.trim()
  if (!q) return []
  const places = matchPlaces(q).map(p => ({ key: `p:${p.name}`, label: p.name, detail: p.detail, value: `${p.name}, ${p.detail}`, icon: KIND_ICON[p.kind] }))
  const seen = new Set(places.map(p => p.label.toLowerCase()))
  const addresses = (q.length >= 3 ? geo.value?.results ?? [] : [])
    .filter(r => !seen.has(r.label.toLowerCase()))
    .map(r => ({ key: `g:${r.place_id}`, label: r.label, detail: r.area, value: r.label, icon: MapPin as Component }))
  return [...places, ...addresses].slice(0, 6)
})
const showList = computed(() => open.value && suggestions.value.length > 0)
watch(suggestions, () => { active.value = 0 })

function choose(s: Suggestion) {
  destination.value = s.value
  open.value = false
  input.value?.focus()
}

function onKey(e: KeyboardEvent) {
  const list = suggestions.value
  if (e.key === 'ArrowDown' && list.length) { e.preventDefault(); open.value = true; active.value = (active.value + 1) % list.length }
  else if (e.key === 'ArrowUp' && list.length) { e.preventDefault(); active.value = (active.value - 1 + list.length) % list.length }
  else if (e.key === 'Enter' && showList.value) { e.preventDefault(); const s = list[active.value]; if (s) choose(s) }
  else if (e.key === 'Escape' && showList.value) { e.stopPropagation(); open.value = false }
}

function go() {
  if (!destination.value.trim()) return input.value?.focus()
  try { localStorage.setItem(STORAGE_KEY, destination.value.trim()) }
  catch { /* private mode: just don't remember it */ }
  window.open(url.value, '_blank', 'noopener')
}
</script>

<template>
  <MapCard :x="x" :y="y" :desktop="desktop" :width="340" title="Commute" :subtitle="`From ${label}`" :icon="Route" @closed="emit('closed')">
    <form class="flex flex-col gap-3" @submit.prevent="go">
      <div class="relative flex flex-col gap-1.5 text-sm">
        <label for="commute-destination" class="font-medium">Where do you go most days?</label>
        <div class="relative">
          <input
            id="commute-destination"
            ref="input"
            v-model="destination"
            type="text"
            role="combobox"
            autocomplete="off"
            aria-autocomplete="list"
            aria-controls="commute-suggestions"
            :aria-expanded="showList"
            :aria-activedescendant="showList ? `commute-opt-${active}` : undefined"
            placeholder="e.g. Trinity College Dublin"
            class="h-11 w-full rounded-xl border bg-background px-3 pr-9 text-sm focus-visible:border-brand focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand/15"
            @focus="open = true"
            @input="open = true"
            @keydown="onKey"
          >
          <Loader2 v-if="isFetching" class="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        </div>
        <ul
          v-if="showList"
          id="commute-suggestions"
          role="listbox"
          class="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-xl border bg-background py-1 shadow-xl"
        >
          <li
            v-for="(s, i) in suggestions"
            :id="`commute-opt-${i}`"
            :key="s.key"
            role="option"
            :aria-selected="i === active"
            class="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-1.5"
            :class="i === active ? 'bg-muted' : ''"
            @mouseenter="active = i"
            @mousedown.prevent="choose(s)"
          >
            <component :is="s.icon" class="size-4 shrink-0 text-muted-foreground" />
            <div class="min-w-0">
              <div class="truncate font-medium">{{ s.label }}</div>
              <div class="truncate text-xs text-muted-foreground">{{ s.detail }}</div>
            </div>
          </li>
        </ul>
      </div>
      <div class="flex gap-2" role="radiogroup" aria-label="Travel mode">
        <button
          v-for="m in MODES"
          :key="m.key"
          type="button"
          role="radio"
          :aria-checked="mode === m.key"
          class="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full border text-sm font-medium transition-colors"
          :class="mode === m.key ? 'border-brand bg-brand text-brand-foreground' : 'hover:bg-muted'"
          @click="mode = m.key"
        >
          <component :is="m.icon" class="size-4" /> {{ m.label }}
        </button>
      </div>
      <button
        type="submit"
        class="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-brand px-4 text-sm font-medium text-brand-foreground hover:bg-brand/90 disabled:opacity-50"
        :disabled="!destination.trim()"
      >
        <Route class="size-4" /> Show route in Google Maps
      </button>
      <p class="text-xs text-muted-foreground">Opens in a new tab. Your destination stays in this browser only.</p>
    </form>
  </MapCard>
</template>

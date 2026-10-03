<script setup lang="ts">
import { Bike, Footprints, Route, TrainFront } from '@lucide/vue'
import type { LngLat } from '~/types/api'
import MapCard from './MapCard.vue'

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
      <label class="flex flex-col gap-1.5 text-sm">
        <span class="font-medium">Where do you go most days?</span>
        <input
          ref="input"
          v-model="destination"
          type="text"
          autocomplete="off"
          placeholder="e.g. Trinity College Dublin"
          class="h-11 rounded-xl border bg-background px-3 text-sm focus-visible:border-brand focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand/15"
        >
      </label>
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

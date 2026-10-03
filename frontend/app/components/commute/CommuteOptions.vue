<script setup lang="ts">
import { Bike, Car, Footprints, Loader2, TrainFront } from '@lucide/vue'
import type { CommuteMode, LngLat } from '~/types/api'
import { metres } from '~/lib/format'

// Commute times from the property to the renter's place, shown in the app before any Google Maps link.
const props = defineProps<{ from: LngLat; destination: string }>()
const emit = defineEmits<{ pick: [mode: CommuteMode] }>()

const { data, isFetching, isError, error } = useCommute(() => props.from, () => props.destination)

const MODE = {
  walk: { label: 'Walk', icon: Footprints },
  cycle: { label: 'Cycle', icon: Bike },
  transit: { label: 'Public transport', icon: TrainFront },
  drive: { label: 'Drive', icon: Car },
} as const

const fastest = computed(() => {
  const opts = data.value?.options.filter(o => o.mode !== 'drive') ?? []
  return opts.reduce<null | (typeof opts)[number]>((best, o) => (!best || o.duration_s < best.duration_s ? o : best), null)?.mode
})
const minutes = (s: number) => {
  const m = Math.max(1, Math.round(s / 60))
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}
</script>

<template>
  <div v-if="destination.trim().length >= 3" class="space-y-2" aria-live="polite">
    <div v-if="isFetching && !data" class="flex items-center gap-2 py-2 text-xs text-muted-foreground">
      <Loader2 class="size-3.5 animate-spin" /> Working out travel times…
    </div>
    <p v-else-if="isError" class="rounded-xl border border-dashed px-3 py-2 text-xs text-muted-foreground">{{ error?.message }}</p>
    <template v-else-if="data">
      <p class="truncate text-xs text-muted-foreground">To <span class="font-medium text-foreground">{{ data.to.label }}</span></p>
      <ul class="divide-y overflow-hidden rounded-xl border" :class="isFetching ? 'opacity-60' : ''">
        <li v-for="o in data.options" :key="o.mode">
          <button
            type="button"
            class="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/60"
            @click="emit('pick', o.mode)"
          >
            <component :is="MODE[o.mode].icon" class="size-4 shrink-0 text-muted-foreground" />
            <span class="flex-1">
              {{ MODE[o.mode].label }}
              <span v-if="o.mode === fastest" class="ml-1 rounded-full bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand">Fastest</span>
            </span>
            <span class="text-right tabular-nums">
              <span class="font-semibold text-foreground">{{ o.basis === 'estimate' ? '~' : '' }}{{ minutes(o.duration_s) }}</span>
              <span class="block text-[11px] text-muted-foreground">{{ metres(o.distance_m) }}{{ o.basis === 'estimate' ? ' · estimate' : '' }}</span>
            </span>
          </button>
        </li>
      </ul>
      <p class="text-[11px] leading-relaxed text-muted-foreground">
        Walk, cycle and drive are real routes. Public transport is an estimate, so check live times in Google Maps. {{ data.attribution }}
      </p>
    </template>
  </div>
</template>

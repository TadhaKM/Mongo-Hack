<script setup lang="ts">
import { Pill, School, ShoppingCart, Stethoscope, Trees } from '@lucide/vue'
import type { Amenity, TransportMode, TransportStop } from '~/types/api'
import { metres } from '~/lib/format'
import { TRANSPORT_MODE } from '~/lib/transport'

const props = defineProps<{ transport: TransportStop[]; amenities: Amenity[] }>()
const sel = useMapSelection()

const ORDER: TransportMode[] = ['luas', 'dart', 'rail', 'bus']
const groups = computed(() => ORDER
  .map(mode => ({ mode, stops: props.transport.filter(s => s.mode === mode) }))
  .filter(g => g.stops.length))

const AMENITY = { supermarket: ShoppingCart, gp: Stethoscope, pharmacy: Pill, school: School, park: Trees } as const
</script>

<template>
  <div class="space-y-4">
    <div v-for="g in groups" :key="g.mode" class="space-y-1">
      <p class="flex items-center gap-1.5 text-xs font-medium" :class="TRANSPORT_MODE[g.mode].text">
        <component :is="TRANSPORT_MODE[g.mode].icon" class="size-4" /> {{ TRANSPORT_MODE[g.mode].label }}
      </p>
      <ul class="divide-y rounded-lg border" @pointerleave="sel.hover(null)">
        <li
          v-for="s in g.stops"
          :key="s.id"
          class="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-muted/60"
          :class="sel.hoveredFeature.value === `stop:${s.id}` ? 'bg-brand/10' : ''"
          @pointerenter="sel.hover(`stop:${s.id}`)"
          @click="sel.focusFeature(`stop:${s.id}`)"
        >
          <span class="min-w-0 flex-1">
            <span class="block truncate font-medium">{{ s.name }}</span>
            <span class="block truncate text-xs text-muted-foreground">{{ s.routes.join(', ') }}</span>
          </span>
          <span class="text-right text-xs tabular-nums">
            <span class="block font-medium">{{ s.walk_min }} min</span>
            <span class="block text-muted-foreground">{{ metres(s.distance_m) }}</span>
          </span>
        </li>
      </ul>
    </div>

    <div v-if="amenities.length" class="space-y-1">
      <p class="text-xs font-medium text-muted-foreground">Nearby amenities</p>
      <ul class="grid grid-cols-2 gap-2">
        <li
          v-for="a in amenities"
          :key="a.id"
          class="flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs"
          @pointerenter="sel.hover(`amenity:${a.id}`)"
          @pointerleave="sel.hover(null)"
        >
          <component :is="AMENITY[a.category]" class="size-4 shrink-0 text-muted-foreground" />
          <span class="min-w-0 flex-1 truncate">{{ a.name }}</span>
          <span class="tabular-nums text-muted-foreground">{{ metres(a.distance_m) }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

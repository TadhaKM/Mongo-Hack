<script setup lang="ts">
import { BedDouble, Building2, Bus, ChevronDown, CircleDashed, Euro, Landmark, Users } from '@lucide/vue'
import type { PropertyType } from '~/types/api'
import { PopoverClose } from 'reka-ui'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { eur, propertyType } from '~/lib/format'
import { useMapUi, type AnalysisLayerKey } from '~/lib/map/state'

const ui = useMapUi()
const sel = useMapSelection()

const BEDS: { label: string; value?: number }[] = [{ label: 'Any' }, { label: '1', value: 1 }, { label: '2', value: 2 }, { label: '3+', value: 3 }]
const RENTS: { label: string; value?: number }[] = [{ label: 'Any' }, ...[1500, 2000, 2500, 3000].map(v => ({ label: `${eur(v)}${v === 3000 ? '+' : ''}`, value: v === 3000 ? undefined : v }))]
const TYPES: (PropertyType | undefined)[] = [undefined, 'apartment', 'house', 'duplex', 'shared_room']

function set<K extends keyof typeof ui.filters.value>(key: K, value: (typeof ui.filters.value)[K]) {
  const next = { ...ui.filters.value }
  if (value === undefined) delete next[key]
  else next[key] = value
  ui.filters.value = next
}

const bedsLabel = computed(() => ui.filters.value.bedrooms ? `${ui.filters.value.bedrooms === 3 ? '3+' : ui.filters.value.bedrooms} bed` : 'Beds')
const rentLabel = computed(() => ui.filters.value.max_rent ? `Up to ${eur(ui.filters.value.max_rent)}` : 'Max rent')
const typeLabel = computed(() => ui.filters.value.type ? propertyType(ui.filters.value.type) : 'Type')

const LAYERS: { key: AnalysisLayerKey; label: string; icon: unknown }[] = [
  { key: 'comparables', label: 'Comparables', icon: Users },
  { key: 'transport', label: 'Transport', icon: Bus },
  { key: 'planning', label: 'Planning', icon: Landmark },
  { key: 'radius', label: 'Radius', icon: CircleDashed },
]
function toggleLayer(key: AnalysisLayerKey) {
  ui.layers.value = { ...ui.layers.value, [key]: !ui.layers.value[key] }
}

const chip = 'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border bg-background px-3 text-sm font-medium shadow-md transition-colors hover:bg-muted'
const on = 'border-brand bg-brand text-brand-foreground hover:bg-brand/90'
const option = 'flex min-h-10 w-full items-center rounded-md px-3 text-left text-sm hover:bg-muted'
</script>

<template>
  <div class="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
    <!-- During an analysis: layer toggles -->
    <template v-if="sel.activeAnalysisId.value">
      <button
        v-for="l in LAYERS"
        :key="l.key"
        type="button"
        :class="[chip, ui.layers.value[l.key] ? on : '']"
        :aria-pressed="ui.layers.value[l.key]"
        @click="toggleLayer(l.key)"
      >
        <component :is="l.icon" class="size-3.5" /> {{ l.label }}
      </button>
      <button
        type="button"
        :class="[chip, ui.sameBedroomsOnly.value ? on : '']"
        :aria-pressed="ui.sameBedroomsOnly.value"
        @click="ui.sameBedroomsOnly.value = !ui.sameBedroomsOnly.value"
      >
        <BedDouble class="size-3.5" /> Same bedrooms only
      </button>
    </template>

    <!-- Browsing: listing filters -->
    <template v-else>
      <Popover>
        <PopoverTrigger :class="[chip, ui.filters.value.bedrooms ? on : '']">
          <BedDouble class="size-3.5" /> {{ bedsLabel }} <ChevronDown class="size-3.5 opacity-60" />
        </PopoverTrigger>
        <PopoverContent align="start" class="w-40 p-1">
          <PopoverClose v-for="b in BEDS" :key="b.label" as-child><button type="button" :class="option" @click="set('bedrooms', b.value)">{{ b.label }}</button></PopoverClose>
        </PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger :class="[chip, ui.filters.value.max_rent ? on : '']">
          <Euro class="size-3.5" /> {{ rentLabel }} <ChevronDown class="size-3.5 opacity-60" />
        </PopoverTrigger>
        <PopoverContent align="start" class="w-44 p-1">
          <PopoverClose v-for="r in RENTS" :key="r.label" as-child><button type="button" :class="option" @click="set('max_rent', r.value)">{{ r.label }}</button></PopoverClose>
        </PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger :class="[chip, ui.filters.value.type ? on : '']">
          <Building2 class="size-3.5" /> {{ typeLabel }} <ChevronDown class="size-3.5 opacity-60" />
        </PopoverTrigger>
        <PopoverContent align="start" class="w-44 p-1">
          <PopoverClose v-for="t in TYPES" :key="t ?? 'any'" as-child><button type="button" :class="option" @click="set('type', t)">{{ t ? propertyType(t) : 'Any' }}</button></PopoverClose>
        </PopoverContent>
      </Popover>
    </template>
  </div>
</template>

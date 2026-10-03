<script setup lang="ts">
import { ArrowDownUp } from '@lucide/vue'
import type { ListingSummary } from '~/types/api'
import { beds, eur, pct, propertyType, verdictLabel } from '~/lib/format'
import { useMapUi } from '~/lib/map/state'

const ui = useMapUi()
const sel = useMapSelection()
const { data, isPending } = useListings(ui.bbox, ui.filters)

type SortKey = 'price' | 'difference'
const sortKey = ref<SortKey>('difference')
const items = computed<ListingSummary[]>(() => {
  const list = [...(data.value?.items ?? [])]
  return sortKey.value === 'price'
    ? list.sort((a, b) => a.rent - b.rent)
    : list.sort((a, b) => a.diff_pct - b.diff_pct)
})

const verdictChip: Record<ListingSummary['verdict'], string> = {
  below_market: 'bg-verdict-below',
  in_line: 'bg-verdict-inline',
  above_market: 'bg-verdict-above',
}
</script>

<template>
  <div class="pb-4">
    <div class="sticky top-0 z-10 flex items-center justify-between gap-2 border-b bg-background/95 px-4 py-3 backdrop-blur">
      <div>
        <h2 class="text-base font-semibold">
          <template v-if="isPending && !data">Loading rentals…</template>
          <template v-else>
            <!-- The count slides out and the new one slides in when filters or the view change. -->
            <span class="relative inline-flex overflow-hidden align-bottom tabular-nums">
              <Transition
                mode="out-in"
                enter-active-class="transition duration-200 ease-out motion-reduce:transition-none"
                enter-from-class="translate-y-full opacity-0"
                leave-active-class="transition duration-150 ease-in motion-reduce:transition-none"
                leave-to-class="-translate-y-full opacity-0"
              >
                <span :key="items.length" class="inline-block">{{ items.length }}</span>
              </Transition>
            </span>
            {{ items.length === 1 ? 'rental' : 'rentals' }} in this area
          </template>
        </h2>
        <p class="text-xs text-muted-foreground">Coloured by rent vs the local median</p>
      </div>
      <button
        type="button"
        class="inline-flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium hover:bg-muted"
        :aria-label="`Sort by ${sortKey === 'price' ? 'difference' : 'price'}`"
        @click="sortKey = sortKey === 'price' ? 'difference' : 'price'"
      >
        <ArrowDownUp class="size-3.5" />
        {{ sortKey === 'price' ? 'Price' : 'Best value' }}
      </button>
    </div>

    <p v-if="!isPending && !items.length" class="px-4 py-10 text-center text-sm text-muted-foreground">
      No rentals in view. Zoom out or move the map.
    </p>

    <ul v-else class="divide-y">
      <li v-for="l in items" :key="l.id">
        <button
          type="button"
          class="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted"
          :class="sel.hoveredFeature.value === `listing:${l.id}` ? 'bg-muted' : ''"
          @mouseenter="sel.hover(`listing:${l.id}`)"
          @mouseleave="sel.hover(null)"
          @focus="sel.hover(`listing:${l.id}`)"
          @blur="sel.hover(null)"
          @click="sel.selectListing(l.id)"
        >
          <div class="min-w-0 flex-1">
            <div class="flex items-baseline gap-2">
              <span class="text-base font-bold tabular-nums">{{ eur(l.rent) }}</span>
              <span class="text-xs text-muted-foreground">/month</span>
            </div>
            <div class="truncate text-sm text-muted-foreground">
              {{ beds(l.bedrooms) }} · {{ propertyType(l.property_type) }} · {{ l.area }}
            </div>
            <div v-if="l.is_sample" class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">Sample listing</div>
          </div>
          <span
            class="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold text-white tabular-nums"
            :class="verdictChip[l.verdict]"
            :title="verdictLabel(l.verdict)"
          >
            {{ pct(l.diff_pct, { sign: true }) }}
          </span>
        </button>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ArrowDownUp, Heart } from '@lucide/vue'
import type { ListingSummary } from '~/types/api'
import { beds, eur, pct, propertyType, verdictLabel } from '~/lib/format'
import { useMapUi } from '~/lib/map/state'
import { useSaved } from '~/lib/map/saved'

const ui = useMapUi()
const sel = useMapSelection()
const { data, isPending } = useListings(ui.bbox, ui.filters)

const shortlist = useSaved()
/** "Nearby" = listings in view; "Saved" = the shortlist (anywhere). */
const tab = useState<'nearby' | 'saved'>('list:tab', () => 'nearby')

type SortKey = 'price' | 'difference'
const sortKey = ref<SortKey>('difference')
const items = computed<ListingSummary[]>(() => {
  const list = tab.value === 'saved' ? [...shortlist.saved.value] : [...(data.value?.items ?? [])]
  return sortKey.value === 'price'
    ? list.sort((a, b) => b.rent - a.rent) // highest price first
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
    <div class="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
    <div class="flex gap-1 px-4 pt-3" role="tablist" aria-label="Rentals">
      <button
        v-for="t in (['nearby', 'saved'] as const)"
        :key="t"
        type="button"
        role="tab"
        :aria-selected="tab === t"
        class="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors"
        :class="tab === t ? 'bg-ink text-background' : 'text-muted-foreground hover:bg-muted'"
        @click="tab = t"
      >
        <template v-if="t === 'nearby'">In view</template>
        <template v-else><Heart class="size-3.5" :class="shortlist.saved.value.length ? 'fill-current' : ''" /> Saved{{ shortlist.saved.value.length ? ` (${shortlist.saved.value.length})` : '' }}</template>
      </button>
    </div>
    <div class="flex items-center justify-between gap-2 px-4 py-3">
      <div>
        <h2 class="text-base font-semibold">
          <template v-if="tab === 'nearby' && isPending && !data">Loading rentals…</template>
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
            {{ items.length === 1 ? 'rental' : 'rentals' }} {{ tab === 'saved' ? 'saved' : 'in this area' }}
          </template>
        </h2>
        <p class="text-xs text-muted-foreground">{{ tab === 'saved' ? 'Kept in this browser' : 'Coloured by rent vs the local median' }}</p>
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
    </div>

    <p v-if="tab === 'saved' && !items.length" class="px-6 py-10 text-center text-sm text-muted-foreground">
      No saved rentals yet. Click a pin, click it again, then tap the heart.
    </p>
    <p v-else-if="tab === 'nearby' && !isPending && !items.length" class="px-4 py-10 text-center text-sm text-muted-foreground">
      No rentals in view. Zoom out or move the map.
    </p>

    <ul v-else class="divide-y">
      <li v-for="l in items" :key="l.id" class="flex items-stretch">
        <button
          type="button"
          class="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2.5 pl-4 pr-2 text-left transition-colors hover:bg-muted"
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
        <button
          type="button"
          class="grid w-11 shrink-0 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
          :class="shortlist.isSaved(l.id) ? 'text-destructive' : ''"
          :aria-label="shortlist.isSaved(l.id) ? 'Remove from shortlist' : 'Save to shortlist'"
          :aria-pressed="shortlist.isSaved(l.id)"
          @click="shortlist.toggle(l)"
        >
          <Heart class="size-4" :class="shortlist.isSaved(l.id) ? 'fill-current' : ''" />
        </button>
      </li>
    </ul>
  </div>
</template>

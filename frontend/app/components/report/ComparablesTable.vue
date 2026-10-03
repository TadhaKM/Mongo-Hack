<script setup lang="ts">
import { FlexRender, createColumnHelper, getCoreRowModel, getSortedRowModel, useVueTable, type SortingState } from '@tanstack/vue-table'
import { ArrowDown, ArrowUp } from '@lucide/vue'
import type { Comparable } from '~/types/api'
import { eur, metres, month } from '~/lib/format'
import { VERDICT_STYLE, rentVsAsking } from '~/lib/verdict'

const props = defineProps<{ comparables: Comparable[]; asking: number; print?: boolean }>()
const sel = useMapSelection()

const helper = createColumnHelper<Comparable>()
const columns = [
  helper.accessor('rent', { header: 'Rent' }),
  helper.accessor('bedrooms', { header: 'Beds' }),
  helper.accessor('distance_m', { header: 'Distance' }),
  helper.accessor('date', { header: 'Date' }),
  helper.accessor('similarity', { header: 'Match' }),
]
const sorting = ref<SortingState>([{ id: 'similarity', desc: true }])
const table = useVueTable({
  get data() { return props.comparables },
  columns,
  state: { get sorting() { return sorting.value } },
  onSortingChange: (u) => { sorting.value = typeof u === 'function' ? u(sorting.value) : u },
  getCoreRowModel: getCoreRowModel(),
  getSortedRowModel: getSortedRowModel(),
})

const expanded = ref(!!props.print)
// Printing shows every row; restore the short list afterwards.
watch(() => props.print, (p) => { expanded.value = !!p })
const rows = computed(() => (expanded.value ? table.getRowModel().rows : table.getRowModel().rows.slice(0, 8)))

// Map → table: highlight and reveal the row the map is hovering (unless the pointer is already on the table).
const pointerInside = ref(false)
const rowRefs = new Map<string, HTMLElement>()
watch(sel.hoveredFeature, (id) => {
  if (pointerInside.value || !id?.startsWith('cmp:')) return
  const cmpId = id.slice(4)
  if (!expanded.value && !rows.value.some(r => r.original.id === cmpId)) expanded.value = true
  nextTick(() => rowRefs.get(cmpId)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
})
</script>

<template>
  <div class="overflow-hidden rounded-lg border" @pointerenter="pointerInside = true" @pointerleave="pointerInside = false; sel.hover(null)">
    <table class="w-full text-sm">
      <thead class="bg-muted/50 text-xs text-muted-foreground">
        <tr>
          <th v-for="h in table.getHeaderGroups()[0]!.headers" :key="h.id" class="px-2 py-2 text-left font-medium first:pl-3 last:pr-3">
            <button type="button" class="inline-flex items-center gap-0.5 hover:text-foreground" @click="h.column.toggleSorting(h.column.getIsSorted() !== 'desc')">
              <FlexRender :render="h.column.columnDef.header" :props="h.getContext()" />
              <ArrowUp v-if="h.column.getIsSorted() === 'asc'" class="size-3" />
              <ArrowDown v-else-if="h.column.getIsSorted() === 'desc'" class="size-3" />
            </button>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.id"
          :ref="(el) => { if (el) rowRefs.set(row.original.id, el as HTMLElement) }"
          class="cursor-pointer border-t transition-colors hover:bg-muted/60"
          :class="sel.hoveredFeature.value === `cmp:${row.original.id}` ? 'bg-brand/10' : ''"
          @pointerenter="sel.hover(`cmp:${row.original.id}`)"
          @click="sel.focusFeature(`cmp:${row.original.id}`)"
        >
          <td class="py-2 pl-3 font-medium tabular-nums" :class="VERDICT_STYLE[rentVsAsking(row.original.rent, asking)].text">{{ eur(row.original.rent) }}</td>
          <td class="px-2 tabular-nums">{{ row.original.bedrooms }}</td>
          <td class="px-2 tabular-nums">{{ metres(row.original.distance_m) }}</td>
          <td class="px-2 whitespace-nowrap">{{ month(row.original.date) }}</td>
          <td class="py-2 pr-3">
            <div class="flex items-center gap-1.5">
              <div class="h-1.5 w-10 overflow-hidden rounded-full bg-muted">
                <div class="h-full rounded-full bg-brand" :style="{ width: `${Math.round(row.original.similarity * 100)}%` }" />
              </div>
              <span class="text-xs tabular-nums text-muted-foreground">{{ Math.round(row.original.similarity * 100) }}%</span>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    <button
      v-if="comparables.length > 8 && !print"
      type="button"
      class="w-full border-t py-2 text-xs font-medium text-brand hover:bg-muted/50"
      @click="expanded = !expanded"
    >
      {{ expanded ? 'Show fewer' : `Show all ${comparables.length}` }}
    </button>
  </div>
</template>

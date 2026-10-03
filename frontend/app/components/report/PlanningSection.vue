<script setup lang="ts">
import { ExternalLink } from '@lucide/vue'
import type { PlanningApplication } from '~/types/api'
import { day, metres } from '~/lib/format'
import { PLANNING_STYLE } from '~/lib/verdict'

defineProps<{ items: PlanningApplication[] }>()
const sel = useMapSelection()
</script>

<template>
  <ul class="space-y-2" @pointerleave="sel.hover(null)">
    <li
      v-for="p in items"
      :key="p.id"
      class="cursor-pointer space-y-1.5 rounded-lg border p-3 text-sm transition-colors hover:bg-muted/60"
      :class="sel.hoveredFeature.value === `plan:${p.id}` ? 'bg-brand/10' : ''"
      @pointerenter="sel.hover(`plan:${p.id}`)"
      @click="sel.focusFeature(`plan:${p.id}`)"
    >
      <div class="flex items-center justify-between gap-2">
        <span class="rounded-md border px-1.5 py-0.5 text-[11px] font-semibold" :class="PLANNING_STYLE[p.status].soft">{{ PLANNING_STYLE[p.status].label }}</span>
        <span class="text-xs tabular-nums text-muted-foreground">{{ metres(p.distance_m) }} away</span>
      </div>
      <p class="font-medium">{{ p.summary }}</p>
      <p class="text-xs"><span class="text-muted-foreground">Why it matters:</span> {{ p.relevance }}</p>
      <div class="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{{ p.reference }} · Received {{ day(p.received_date) }}<template v-if="p.decision_date"> · Decided {{ day(p.decision_date) }}</template></span>
        <a :href="p.url" target="_blank" rel="noopener" class="text-brand" aria-label="Open planning record" @click.stop>
          <ExternalLink class="size-3.5" />
        </a>
      </div>
    </li>
  </ul>
</template>

<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import { Flame, LocateFixed, Minus, Plus } from '@lucide/vue'
import { DESKTOP_QUERY } from '~/lib/map/config'
import { useMapUi } from '~/lib/map/state'

// Rendered outside AnalysisMap's slot: talks to the map through shared UI state.
const ui = useMapUi()
const sel = useMapSelection()
const desktop = useMediaQuery(DESKTOP_QUERY, { ssrWidth: 1280 })
const is3D = computed(() => ui.is3D.value ?? desktop.value)

function zoom(delta: number) {
  ui.zoomBy.value = { delta, n: (ui.zoomBy.value?.n ?? 0) + 1 }
}
</script>

<template>
  <div class="flex flex-col items-end gap-2">
    <div class="flex flex-col overflow-hidden rounded-lg border bg-background shadow-md">
      <button type="button" class="grid size-11 place-items-center hover:bg-muted" aria-label="Zoom in" @click="zoom(1)">
        <Plus class="size-4" />
      </button>
      <div class="h-px bg-border" />
      <button type="button" class="grid size-11 place-items-center hover:bg-muted" aria-label="Zoom out" @click="zoom(-1)">
        <Minus class="size-4" />
      </button>
    </div>
    <button
      v-if="!sel.activeAnalysisId.value"
      type="button"
      class="grid size-11 place-items-center rounded-lg border shadow-md transition-colors"
      :class="ui.heat.value ? 'border-brand bg-brand text-brand-foreground' : 'bg-background hover:bg-muted'"
      :aria-pressed="ui.heat.value"
      aria-label="Rent heatmap"
      title="Rent heatmap: where rents run above or below the local median"
      @click="ui.heat.value = !ui.heat.value"
    >
      <Flame class="size-4" />
    </button>
    <button
      type="button"
      class="grid size-11 place-items-center rounded-lg border bg-background text-xs font-bold shadow-md hover:bg-muted"
      :aria-label="is3D ? 'Switch to 2D map' : 'Switch to 3D map'"
      :aria-pressed="is3D"
      @click="ui.is3D.value = !is3D"
    >
      {{ is3D ? '2D' : '3D' }}
    </button>
    <button
      type="button"
      class="grid size-11 place-items-center rounded-lg border bg-background shadow-md hover:bg-muted"
      aria-label="Recentre map"
      @click="ui.recentre.value++"
    >
      <LocateFixed class="size-4" />
    </button>
  </div>
</template>

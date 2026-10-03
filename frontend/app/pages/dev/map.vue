<script setup lang="ts">
import AnalysisMap from '~/components/map/AnalysisMap.vue'
import AnalysisLayers from '~/components/map/AnalysisLayers.vue'
import MapControls from '~/components/map/MapControls.vue'
import { useMapUi } from '~/lib/map/state'

// Map sandbox: the map and its layers without the panel. Handy for tuning camera and layers.
useMapSelectionUrlSync()
const ui = useMapUi()
const sel = useMapSelection()
const { data } = useListings(ui.bbox, ui.filters)
const listings = computed(() => data.value?.items ?? [])
</script>

<template>
  <div class="fixed inset-0">
    <ClientOnly>
      <AnalysisMap :listings="listings">
        <AnalysisLayers />
      </AnalysisMap>
    </ClientOnly>
    <div class="absolute left-3 top-3 z-10 flex flex-wrap gap-2 rounded-lg border bg-background p-2 text-sm shadow">
      <button type="button" class="rounded border px-2 py-1" @click="sel.selectListing('lst_demo')">Select lst_demo</button>
      <button type="button" class="rounded border px-2 py-1" @click="sel.startAnalysis('an_demo')">Start an_demo</button>
      <button type="button" class="rounded border px-2 py-1" @click="sel.reset()">Reset</button>
      <span class="self-center text-muted-foreground">{{ listings.length }} listings</span>
    </div>
    <MapControls class="absolute bottom-8 right-4 z-10" />
  </div>
</template>

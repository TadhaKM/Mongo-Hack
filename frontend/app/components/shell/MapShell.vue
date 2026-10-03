<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import { DrawerContent, DrawerDescription, DrawerHandle, DrawerPortal, DrawerRoot, DrawerTitle } from 'vaul-vue'
import { ScrollArea } from '~/components/ui/scroll-area'
import AnalysisMap from '~/components/map/AnalysisMap.vue'
import AnalysisLayers from '~/components/map/AnalysisLayers.vue'
import MapControls from '~/components/map/MapControls.vue'
import SearchBar from '~/components/search/SearchBar.vue'
import MapFilters from '~/components/search/MapFilters.vue'
import PanelContent from './PanelContent.vue'
import { DESKTOP_QUERY } from '~/lib/map/config'
import { useMapUi } from '~/lib/map/state'

const ui = useMapUi()
const sel = useMapSelection()
const desktop = useMediaQuery(DESKTOP_QUERY, { ssrWidth: 1280 })

const { data: listingsData } = useListings(ui.bbox, ui.filters)
const listings = computed(() => listingsData.value?.items ?? [])

// Mobile bottom sheet: peek 148 px / half / full. The sheet is 72 px shorter than the
// window so "full" stops below the search bar; vaul measures px snaps from the top of a
// full-height drawer, so the peek needs those 72 px added back.
const SHEET_TOP_GAP = 72
const SNAP_POINTS: (string | number)[] = [`${148 + SHEET_TOP_GAP}px`, 0.5, 1]
const hasSelection = () => !!(sel.selectedListingId.value || sel.activeAnalysisId.value || sel.droppedPin.value)
const snap = ref<string | number | null>(hasSelection() ? 0.5 : SNAP_POINTS[0]!)
// Opening a card or analysis lifts the sheet to half height.
watch(() => [sel.selectedListingId.value, sel.activeAnalysisId.value, sel.droppedPin.value], () => {
  if (!desktop.value && snap.value === SNAP_POINTS[0]) snap.value = 0.5
})
</script>

<template>
  <div class="fixed inset-0 overflow-hidden bg-muted">
    <ClientOnly>
      <AnalysisMap :listings="listings">
        <AnalysisLayers />
      </AnalysisMap>
    </ClientOnly>

    <!-- Search + filters (top-left on desktop, full width on mobile) -->
    <div class="pointer-events-none absolute inset-x-3 top-3 z-20 flex flex-col gap-2 lg:right-auto lg:left-4 lg:top-4 lg:w-[400px]">
      <SearchBar class="pointer-events-auto" />
      <MapFilters class="pointer-events-auto" />
    </div>


    <!-- Client-only: which panel to show depends on the viewport width. -->
    <ClientOnly>
      <!-- Map controls. Mobile: top-right under the filters, so the bottom sheet never covers them -->
      <MapControls class="absolute right-3 z-10 lg:right-4" :class="desktop ? 'bottom-8' : 'top-[124px]'" />

      <!-- Desktop: floating side panel -->
      <aside
        v-if="desktop"
        class="absolute bottom-4 left-4 top-[124px] z-10 flex w-[400px] flex-col overflow-hidden rounded-xl border bg-background shadow-xl"
      >
        <ScrollArea class="h-full">
          <PanelContent />
        </ScrollArea>
      </aside>

      <!-- Mobile: bottom sheet, map stays interactive above it -->
      <DrawerRoot
        v-else
        :open="true"
        :modal="false"
        :dismissible="false"
        :snap-points="SNAP_POINTS"
        v-model:active-snap-point="snap"
      >
        <DrawerPortal>
          <DrawerContent
            class="fixed inset-x-0 bottom-0 z-30 flex h-[calc(100dvh-72px)] flex-col rounded-t-2xl border bg-background shadow-[0_-8px_30px_rgb(0_0_0/0.12)] outline-none"
          >
            <DrawerHandle class="mx-auto mt-2 mb-1 h-1.5 w-12 shrink-0 rounded-full bg-muted-foreground/30" />
            <DrawerTitle class="sr-only">Mend AI</DrawerTitle>
            <DrawerDescription class="sr-only">Rentals on the map and the property check</DrawerDescription>
            <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain" :class="snap === 1 ? '' : 'overflow-hidden'">
              <PanelContent />
            </div>
          </DrawerContent>
        </DrawerPortal>
      </DrawerRoot>
    </ClientOnly>
  </div>
</template>

<script setup lang="ts">
import { resolveComponent, type Component } from 'vue'
import PanelPlaceholder from './PanelPlaceholder.vue'
import ListingList from '~/components/search/ListingList.vue'

// Panel routing (brief 1.7): AnalysisPanel > PropertyCard > PropertyForm > ListingList.
// A's components resolve by name; until they exist a placeholder with the same props renders.
const sel = useMapSelection()

// Literal names so Nuxt can compile these into imports.
const maybe = (c: unknown): Component | null => (typeof c === 'string' ? null : (c as Component))
const AnalysisPanel = maybe(resolveComponent('AnalysisPanel'))
const PropertyCard = maybe(resolveComponent('PropertyCard'))
const PropertyForm = maybe(resolveComponent('PropertyForm'))

const view = computed(() => {
  if (sel.activeAnalysisId.value) return { key: `analysis:${sel.activeAnalysisId.value}`, name: 'AnalysisPanel', is: AnalysisPanel, props: { analysisId: sel.activeAnalysisId.value } }
  if (sel.selectedListingId.value) return { key: `listing:${sel.selectedListingId.value}`, name: 'PropertyCard', is: PropertyCard, props: { listingId: sel.selectedListingId.value } }
  if (sel.droppedPin.value) return { key: 'pin', name: 'PropertyForm', is: PropertyForm, props: { initial: sel.droppedPin.value } }
  return { key: 'list', name: 'ListingList', is: null, props: {} }
})
</script>

<template>
  <Transition
    mode="out-in"
    enter-active-class="transition duration-200 ease-out"
    enter-from-class="opacity-0 translate-y-2"
    leave-active-class="transition duration-150 ease-in"
    leave-to-class="opacity-0 -translate-y-1"
  >
    <div :key="view.key">
      <ListingList v-if="view.name === 'ListingList'" />
      <component :is="view.is" v-else-if="view.is" v-bind="view.props" />
      <PanelPlaceholder v-else :name="view.name" :props="view.props" @back="sel.back()" />
    </div>
  </Transition>
</template>

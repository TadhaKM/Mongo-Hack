<script setup lang="ts">
import RadiusLayer from './layers/RadiusLayer.vue'
import ComparablesLayer from './layers/ComparablesLayer.vue'
import TransportLayer from './layers/TransportLayer.vue'
import PlanningLayer from './layers/PlanningLayer.vue'
import { useMapUi } from '~/lib/map/state'

// The map "fills in" live: each query is enabled only once its stage is done,
// so each layer appears as its data arrives.
const sel = useMapSelection()
const ui = useMapUi()
const id = sel.activeAnalysisId

const { data: analysis } = useAnalysis(id)
const { data: comparables } = useComparables(id)
const { data: location } = useLocationData(id)
const { data: planning } = usePlanning(id)

const home = computed(() => analysis.value?.property?.location ?? null)
const asking = computed(() => analysis.value?.summary?.asking ?? analysis.value?.input?.monthly_rent ?? 0)
const bedrooms = computed(() => (ui.sameBedroomsOnly.value ? analysis.value?.input?.bedrooms ?? null : null))
</script>

<template>
  <template v-if="id && home">
    <RadiusLayer :center="home" :radius-m="analysis?.summary?.radius_m ?? 1500" :visible="ui.layers.value.radius" />
    <ComparablesLayer
      v-if="comparables && asking"
      :items="comparables.items"
      :asking="asking"
      :bedrooms="bedrooms"
      :visible="ui.layers.value.comparables"
    />
    <TransportLayer v-if="location" :stops="location.transport" :home="home" :visible="ui.layers.value.transport" />
    <PlanningLayer v-if="planning" :items="planning.items" :visible="ui.layers.value.planning" />
  </template>
</template>

<script setup lang="ts">
import { FileText } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import EvidenceProvider from '../evidence/EvidenceProvider.vue'
import PanelHeader from '../property/PanelHeader.vue'
import ReportBody from '../report/ReportBody.vue'
import AnalysisFailed from './AnalysisFailed.vue'
import StageRow from './StageRow.vue'
import { useStageQueue } from './useStageQueue'

const props = defineProps<{ analysisId: string }>()
const id = computed(() => props.analysisId)
const { data: analysis, polling } = useAnalysis(id)
const { data: comparables } = useComparables(id)
const { data: location } = useLocationData(id)
const { data: planning } = usePlanning(id)

const { stages, settled, animated } = useStageQueue(analysis)

// Switch to the report once every stage has visibly finished, with a short beat for the last tick.
const showReport = ref(false)
watch(
  () => [analysis.value?.status, settled.value] as const,
  ([status, isSettled]) => {
    if (status !== 'complete' || !isSettled || showReport.value) return
    if (animated.value) setTimeout(() => (showReport.value = true), 600)
    else showReport.value = true
  },
  { immediate: true },
)

// Only mention reconnecting if the stream has been down for a while.
const showReconnecting = ref(false)
let reconnectTimer: ReturnType<typeof setTimeout> | undefined
watch(polling, (p) => {
  clearTimeout(reconnectTimer)
  if (p) reconnectTimer = setTimeout(() => (showReconnecting.value = true), 5000)
})
watch(() => analysis.value?.status, (s) => { if (s !== 'running') showReconnecting.value = false })
onBeforeUnmount(() => clearTimeout(reconnectTimer))

const SECTIONS = [
  { id: 'r-rent', label: 'Rent' }, { id: 'r-comparables', label: 'Comparables' }, { id: 'r-location', label: 'Location' },
  { id: 'r-area', label: 'Area' }, { id: 'r-planning', label: 'Planning' }, { id: 'r-sources', label: 'Sources' },
]
function jump(sectionId: string) {
  document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
</script>

<template>
  <div>
    <PanelHeader
      :title="analysis?.input.address ?? 'RentCheck'"
      :subtitle="analysis?.status === 'failed' ? 'Check failed' : analysis?.status === 'running' || !showReport ? 'Checking this property…' : 'Know before you rent'"
    >
      <template #actions>
        <Button v-if="showReport && analysis?.status === 'complete'" as-child size="sm" variant="outline" class="shrink-0">
          <NuxtLink :to="`/analysis/${analysisId}/report`" target="_blank"><FileText class="size-3.5" /> Full report</NuxtLink>
        </Button>
      </template>
    </PanelHeader>

    <div v-if="!analysis" class="space-y-3 p-4">
      <Skeleton v-for="i in 7" :key="i" class="h-6 w-full" />
    </div>

    <AnalysisFailed v-else-if="analysis.status === 'failed'" :analysis="analysis" />

    <Transition
      v-else
      mode="out-in"
      enter-active-class="transition duration-300 ease-out"
      enter-from-class="opacity-0 translate-y-2"
      leave-active-class="transition duration-200 ease-in"
      leave-to-class="opacity-0"
    >
      <!-- Agent progress: the stages are the loading UI -->
      <div v-if="!showReport" key="progress" class="p-4">
        <p class="mb-2 text-sm text-muted-foreground">RentCheck is investigating this property.</p>
        <ol aria-live="polite">
          <StageRow v-for="s in stages" :key="s.stage" :stage="s" />
        </ol>
        <p v-if="showReconnecting" class="mt-3 text-xs text-muted-foreground">Reconnecting…</p>
      </div>

      <div v-else key="report">
      <EvidenceProvider :evidence="analysis.evidence" :sources="analysis.sources">
        <nav class="sticky top-[53px] z-[5] flex gap-1 overflow-x-auto border-b bg-background/95 px-3 py-2 backdrop-blur [scrollbar-width:none]">
          <button
            v-for="s in SECTIONS"
            :key="s.id"
            type="button"
            class="shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            @click="jump(s.id)"
          >
            {{ s.label }}
          </button>
        </nav>
        <ReportBody :analysis="analysis" :comparables="comparables" :location="location" :planning="planning" />
      </EvidenceProvider>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { FileText } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import EvidenceProvider from '../evidence/EvidenceProvider.vue'
import PanelHeader from '../property/PanelHeader.vue'
import ReportBody from '../report/ReportBody.vue'
import AnalysisFailed from './AnalysisFailed.vue'
import GradientOrb from '../report/GradientOrb.vue'
import StageRow from './StageRow.vue'
import { useStageQueue } from './useStageQueue'
import { gsap, reducedMotion } from '~/lib/motion'
import { playCompletionBeat } from '~/lib/beat'

const props = defineProps<{ analysisId: string }>()
const id = computed(() => props.analysisId)
const { data: analysis, polling } = useAnalysis(id)
const { data: comparables } = useComparables(id)
const { data: location } = useLocationData(id)
const { data: planning } = usePlanning(id)

const { stages, settled, animated } = useStageQueue(analysis)

// Progress rail: fills down the stage list as stages finish.
const rail = ref<HTMLElement>()
const doneShare = computed(() => {
  const list = stages.value
  if (!list.length) return 0
  const finished = list.filter(s => s.status === 'done' || s.status === 'failed').length
  return finished / list.length
})
watch(doneShare, (share) => {
  if (!rail.value) return
  if (reducedMotion()) rail.value.style.transform = `scaleY(${share})`
  else gsap.to(rail.value, { scaleY: share, duration: 0.5, ease: 'power2.out' })
})

// Report entrance: sections rise in once, only after a live run.
const reportEl = ref<HTMLElement>()
watch(reportEl, (el) => {
  if (!el || !animated.value || reducedMotion()) return
  gsap.from(el.querySelectorAll('section'), { y: 18, autoAlpha: 0, duration: 0.5, stagger: 0.08, ease: 'power3.out', clearProps: 'all' })
})

// Switch to the report once every stage has visibly finished, with a short beat for the last tick.
const showReport = ref(false)
watch(
  () => [analysis.value?.status, settled.value] as const,
  ([status, isSettled]) => {
    if (status !== 'complete' || !isSettled || showReport.value) return
    // Live run: one master timeline sequences map → panel → rating → verdict (lib/beat.ts).
    if (animated.value) playCompletionBeat({ onPanel: () => (showReport.value = true) })
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
      :subtitle="analysis?.status === 'failed' ? 'Check stopped' : analysis?.status === 'running' || !showReport ? 'Checking this rent…' : 'Rent check'"
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
      <div v-if="!showReport" key="progress" class="relative overflow-hidden p-5">
        <GradientOrb tone="lavender" :size="300" drift class="-top-28 -right-24" />
        <GradientOrb tone="sky" :size="220" drift class="top-48 -left-28 opacity-60" />
        <p class="type-display-sm relative mb-1 text-foreground">Checking this rent</p>
        <p class="relative mb-5 text-sm text-muted-foreground">Against public rental, transport, census and planning data.</p>
        <ol aria-live="polite" class="relative">
          <!-- rail behind the stage dots -->
          <span aria-hidden="true" class="absolute top-4 bottom-4 left-[9.5px] w-px bg-border" />
          <span ref="rail" aria-hidden="true" class="absolute top-4 bottom-4 left-[9px] w-[2px] origin-top scale-y-0 bg-brand" />
          <StageRow v-for="s in stages" :key="s.stage" :stage="s" />
        </ol>
        <p v-if="showReconnecting" class="mt-3 text-xs text-muted-foreground">Reconnecting…</p>
      </div>

      <div v-else ref="reportEl" key="report">
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
        <ReportBody :analysis="analysis" :comparables="comparables" :location="location" :planning="planning" :animate="animated ? 'beat' : false" />
      </EvidenceProvider>
      </div>
    </Transition>
  </div>
</template>

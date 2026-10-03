<script setup lang="ts">
import { Download, MapPin } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import EvidenceProvider from '~/components/evidence/EvidenceProvider.vue'
import ReportBody from '~/components/report/ReportBody.vue'
import MiniMap from '~/components/map/MiniMap.vue'
import type { FeatureId } from '~/composables/useMapSelection'
import { day } from '~/lib/format'

// Printable "Know Before You Rent" report (task A11). Everything expanded, no tabs.
const route = useRoute()
const id = computed(() => String(route.params.id))
const { data: analysis } = useAnalysis(id)
const { data: report, isError, refetch } = useReport(id)

useHead({ title: computed(() => (report.value ? `RentCheck report · ${report.value.analysis.input.address}` : 'RentCheck report')) })

const points = computed(() => {
  if (!report.value) return []
  const r = report.value
  return [
    ...r.comparables.items.map(c => ({ id: `cmp:${c.id}` as FeatureId, location: c.location })),
    ...r.location.transport.map(s => ({ id: `stop:${s.id}` as FeatureId, location: s.location })),
    ...r.planning.items.map(p => ({ id: `plan:${p.id}` as FeatureId, location: p.location })),
  ]
})

function printReport() {
  window.print()
}

const DISCLAIMER = 'RentCheck is a decision-support tool, not a valuation or legal advice.'
</script>

<template>
  <div class="min-h-dvh bg-canvas py-0 print:bg-white sm:py-8">
    <main class="mx-auto max-w-3xl overflow-hidden bg-background shadow-soft print:max-w-none print:shadow-none sm:rounded-2xl sm:border">
      <!-- Header (also printed) -->
      <header class="flex items-start justify-between gap-4 border-b px-6 py-5">
        <div>
          <p class="type-caption-upper text-muted-foreground">RentCheck AI · Know before you rent</p>
          <h1 class="type-display-md mt-2 text-foreground">{{ report?.analysis.input.address ?? 'Rental report' }}</h1>
          <p v-if="report" class="text-sm text-muted-foreground">Generated {{ day(report.generated_at) }} · {{ DISCLAIMER }}</p>
        </div>
        <Button class="no-print shrink-0 rounded-full border-hairline-strong" variant="outline" :disabled="!report" @click="printReport">
          <Download class="size-4" /> Download PDF
        </Button>
      </header>

      <div v-if="isError" class="space-y-3 p-6 text-sm">
        <p>This report isn't available yet.</p>
        <Button variant="outline" size="sm" @click="refetch()">Try again</Button>
      </div>

      <div v-else-if="!report" class="space-y-4 p-6">
        <p v-if="analysis?.status === 'running'" class="text-sm text-muted-foreground">The analysis is still running. This page will fill in when it finishes.</p>
        <Skeleton class="h-56 w-full" />
        <Skeleton class="h-8 w-1/2" />
        <Skeleton class="h-40 w-full" />
      </div>

      <template v-else>
        <div class="print-avoid-break relative h-56 border-b">
          <ClientOnly>
            <MiniMap class="absolute inset-0" :center="report.analysis.property.location" :points="points" />
          </ClientOnly>
          <div class="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1 rounded-md bg-background/90 px-2 py-1 text-[11px]">
            <MapPin class="size-3 text-brand" /> {{ report.analysis.property.area }} · comparables, transport and planning nearby
          </div>
        </div>

        <EvidenceProvider :evidence="report.analysis.evidence" :sources="report.analysis.sources">
          <ReportBody
            print
            :analysis="report.analysis"
            :comparables="report.comparables"
            :location="report.location"
            :planning="report.planning"
            :disclaimer="report.disclaimer"
          />
        </EvidenceProvider>

        <footer class="border-t px-6 py-4 text-xs text-muted-foreground">
          RentCheck AI · Report {{ report.analysis.id }} · Generated {{ day(report.generated_at) }}
        </footer>
      </template>
    </main>
  </div>
</template>

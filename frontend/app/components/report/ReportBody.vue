<script setup lang="ts">
import type { Analysis, ComparablesResponse, LocationResponse, PlanningResponse } from '~/types/api'
import { beds, eur, propertyType } from '~/lib/format'
import RentDistributionChart from '../charts/RentDistributionChart.vue'
import RentTrendChart from '../charts/RentTrendChart.vue'
import AreaSection from './AreaSection.vue'
import ClaimText from './ClaimText.vue'
import ComparablesTable from './ComparablesTable.vue'
import PlanningSection from './PlanningSection.vue'
import ReportSection from './ReportSection.vue'
import SectionFooter from './SectionFooter.vue'
import SourcesSection from './SourcesSection.vue'
import TransportList from './TransportList.vue'
import VerdictCard from './VerdictCard.vue'

const props = defineProps<{
  analysis: Analysis
  comparables?: ComparablesResponse
  location?: LocationResponse
  planning?: PlanningResponse
  disclaimer?: string
  print?: boolean
}>()

const failed = (stage: string) => props.analysis.stages.find(s => s.stage === stage)?.status === 'failed'
const unavailable = (stage: string, what: string) => (failed(stage) ? `${what} data unavailable for this area: ${props.analysis.stages.find(s => s.stage === stage)?.detail ?? 'the source did not respond'}.` : null)
const furnished = computed(() => ({ furnished: 'Furnished', unfurnished: 'Unfurnished', unknown: 'Furnishing not stated' })[props.analysis.input.furnished ?? 'unknown'])
const lowConfidence = computed(() => props.analysis.summary?.confidence.level === 'low')
</script>

<template>
  <div class="divide-y">
    <!-- Property summary -->
    <ReportSection id="r-summary" title="Property">
      <div class="flex items-baseline justify-between gap-2">
        <p class="font-heading text-2xl font-semibold tabular-nums">{{ eur(analysis.input.monthly_rent) }}<span class="text-sm font-normal text-muted-foreground"> /month</span></p>
        <p class="text-sm text-muted-foreground">{{ analysis.property.area }}</p>
      </div>
      <p class="text-sm text-muted-foreground">
        {{ beds(analysis.input.bedrooms) }} · {{ propertyType(analysis.input.property_type) }} · {{ furnished }}<template v-if="analysis.input.floor_area_m2"> · {{ analysis.input.floor_area_m2 }} m²</template>
      </p>
      <p class="text-sm">{{ analysis.input.address }}</p>
      <a v-if="analysis.input.listing_url" :href="analysis.input.listing_url" target="_blank" rel="noopener" class="text-xs text-brand hover:underline">View listing</a>
    </ReportSection>

    <!-- Rental analysis -->
    <ReportSection id="r-rent" title="Rental analysis" :unavailable="analysis.summary ? null : 'Rental analysis unavailable: no comparable data could be retrieved.'">
      <div v-if="lowConfidence" class="rounded-lg border border-verdict-above/40 bg-verdict-above/10 p-3 text-xs">
        Only {{ analysis.summary!.observations }} comparables were found, so treat this verdict with caution.
      </div>
      <VerdictCard v-if="analysis.summary" :summary="analysis.summary" />
      <RentDistributionChart
        v-if="analysis.summary && comparables"
        class="pt-2"
        :comparables="comparables.items"
        :asking="analysis.summary.asking"
        :median="analysis.summary.median"
      />
      <RentTrendChart
        v-if="analysis.trend && analysis.summary"
        class="pt-2"
        :series="analysis.trend.series"
        :asking="analysis.summary.asking"
        :change12m-pct="analysis.trend.change_12m_pct"
        :area="analysis.property.area"
      />
      <SectionFooter :source-ids="['rtb']" :observations="analysis.summary?.observations" />
    </ReportSection>

    <!-- Comparables -->
    <ReportSection id="r-comparables" title="Comparable properties" :unavailable="unavailable('comparables', 'Comparable')">
      <ComparablesTable v-if="comparables && analysis.summary" :comparables="comparables.items" :asking="analysis.summary.asking" :print="print" />
      <SectionFooter :source-ids="['rtb']" :observations="comparables?.stats.count" />
    </ReportSection>

    <!-- Location -->
    <ReportSection id="r-location" title="Location" :unavailable="unavailable('transport', 'Transport')">
      <template v-if="location">
        <ClaimText v-for="c in location.claims" :key="c.id" :claim="c" />
        <TransportList :transport="location.transport" :amenities="print ? [] : location.amenities" />
        <SectionFooter :source-ids="location.source_ids" />
      </template>
    </ReportSection>

    <!-- Area -->
    <ReportSection id="r-area" title="Area" :unavailable="unavailable('area', 'Census')">
      <template v-if="analysis.area">
        <AreaSection :area="analysis.area" />
        <SectionFooter :source-ids="['cso']" />
      </template>
    </ReportSection>

    <!-- Planning -->
    <ReportSection id="r-planning" title="Planning nearby" :unavailable="unavailable('planning', 'Planning')">
      <template v-if="planning">
        <ClaimText v-for="c in planning.claims" :key="c.id" :claim="c" />
        <PlanningSection :items="planning.items" />
        <SectionFooter :source-ids="planning.source_ids" />
      </template>
    </ReportSection>

    <!-- Sources -->
    <ReportSection id="r-sources" title="Sources and limitations">
      <SourcesSection :sources="analysis.sources" :limitations="analysis.limitations" :disclaimer="disclaimer" />
    </ReportSection>
  </div>
</template>

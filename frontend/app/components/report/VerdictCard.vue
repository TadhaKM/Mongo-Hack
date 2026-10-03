<script setup lang="ts">
import type { Analysis } from '~/types/api'
import { eur, metres, pct, period, verdictLabel } from '~/lib/format'
import { VERDICT_STYLE } from '~/lib/verdict'
import { registerBeatPart } from '~/lib/beat'
import TextSwap from './TextSwap.vue'
import ClaimText from './ClaimText.vue'
import ConfidencePill from './ConfidencePill.vue'
import GradientOrb from './GradientOrb.vue'
import RentRating from './RentRating.vue'

const props = defineProps<{ summary: NonNullable<Analysis['summary']>; animate?: boolean | 'beat' }>()
const style = computed(() => VERDICT_STYLE[props.summary.verdict])
// Text replacement (SplitText): the pill's letters swap from "Checking" to the verdict.
// In a live run the completion beat sequences it; on the report page it plays after a short delay.
const pill = ref<InstanceType<typeof TextSwap>>()
let unregister: (() => void) | null = null
let fallback: ReturnType<typeof setTimeout> | undefined
let played = false
onMounted(() => {
  if (props.animate !== 'beat') return
  unregister = registerBeatPart('verdict', () => { played = true; return pill.value?.swap() })
  fallback = setTimeout(() => { if (!played) pill.value?.swap() }, 2000)
})
onBeforeUnmount(() => { unregister?.(); clearTimeout(fallback) })

const orb = computed(() => ({ below_market: 'mint', in_line: 'lavender', above_market: 'peach' } as const)[props.summary.verdict])

// Say the difference in money first: that's what a renter feels every month.
const headline = computed(() => {
  const diff = props.summary.difference_eur
  if (props.summary.verdict === 'in_line') return 'In line with similar homes nearby'
  return `${eur(Math.abs(diff))} a month ${diff > 0 ? 'more' : 'less'} than similar homes nearby`
})
const subline = computed(() => {
  const diff = props.summary.difference_eur
  if (props.summary.verdict !== 'in_line') return `${pct(Math.abs(props.summary.difference_pct), { decimals: 1 })} ${diff > 0 ? 'above' : 'below'} the median of ${eur(props.summary.median)}`
  if (diff === 0) return `Exactly the median of ${eur(props.summary.median)}`
  return `${eur(Math.abs(diff))} ${diff > 0 ? 'above' : 'below'} the median of ${eur(props.summary.median)}`
})
</script>

<template>
  <div class="space-y-4">
    <!-- gradient-orb-card: the verdict headline sits on a soft atmospheric bloom -->
    <div class="relative overflow-hidden rounded-3xl bg-canvas-soft px-5 pt-5 pb-6">
      <GradientOrb :tone="orb" :size="280" class="-top-24 -right-16" />
      <GradientOrb tone="lavender" :size="180" class="-bottom-24 -left-12 opacity-50" />
      <div class="relative space-y-6">
        <div class="flex items-start justify-between gap-3">
          <p class="type-caption-upper inline-flex items-center gap-1.5 rounded-full bg-background/80 px-2.5 py-1 text-foreground">
            <component :is="style.icon" class="size-3.5" :class="style.text" />
            <TextSwap
              v-if="animate"
              ref="pill"
              :text="verdictLabel(summary.verdict)"
              from="Checking"
              :manual="animate === 'beat'"
              :delay="0.6"
            />
            <span v-else>{{ verdictLabel(summary.verdict) }}</span>
          </p>
          <ConfidencePill :confidence="summary.confidence" />
        </div>
        <div>
          <h3 class="type-display-md text-balance text-foreground">{{ headline }}</h3>
          <p class="mt-2 text-sm text-muted-foreground">{{ subline }}</p>
        </div>
      </div>
    </div>

    <RentRating :difference-pct="summary.difference_pct" :asking="summary.asking" :observations="summary.observations" :animate="animate" />

    <!-- The numbers behind the rating -->
    <dl class="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border text-sm">
      <div class="bg-background p-3">
        <dt class="text-xs text-muted-foreground">Asking rent</dt>
        <dd class="type-title text-foreground tabular-nums">{{ eur(summary.asking) }}</dd>
      </div>
      <div class="bg-background p-3">
        <dt class="text-xs text-muted-foreground">Median for similar homes</dt>
        <dd class="type-title text-foreground tabular-nums">{{ eur(summary.median) }}</dd>
      </div>
      <div class="bg-background p-3">
        <dt class="text-xs text-muted-foreground">Most rent between</dt>
        <dd class="font-medium tabular-nums">{{ eur(summary.p10) }} and {{ eur(summary.p90) }}</dd>
      </div>
      <div class="bg-background p-3">
        <dt class="text-xs text-muted-foreground">Cheaper than this one</dt>
        <dd class="font-medium tabular-nums">{{ summary.percentile }}% of them</dd>
      </div>
    </dl>

    <p class="text-xs leading-relaxed text-muted-foreground">
      RTB · {{ summary.observations }} homes · {{ period(summary.period.from, summary.period.to) }} · within {{ metres(summary.radius_m) }}
    </p>

    <div v-if="summary.claims.length" class="space-y-2 rounded-xl bg-canvas p-4">
      <p class="type-caption-upper text-foreground">Why</p>
      <ClaimText v-for="c in summary.claims" :key="c.id" :claim="c" />
    </div>
  </div>
</template>

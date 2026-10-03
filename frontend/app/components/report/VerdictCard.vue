<script setup lang="ts">
import type { Analysis } from '~/types/api'
import { eur, metres, pct, period, verdictLabel } from '~/lib/format'
import { VERDICT_STYLE } from '~/lib/verdict'
import ClaimText from './ClaimText.vue'
import ConfidencePill from './ConfidencePill.vue'

const props = defineProps<{ summary: NonNullable<Analysis['summary']> }>()
const style = computed(() => VERDICT_STYLE[props.summary.verdict])
const diffEur = computed(() => `${props.summary.difference_eur > 0 ? '+' : props.summary.difference_eur < 0 ? '-' : ''}${eur(Math.abs(props.summary.difference_eur))}`)
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-start justify-between gap-3">
      <div>
        <p class="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold tracking-wide uppercase" :class="style.soft">
          <component :is="style.icon" class="size-3.5" /> {{ verdictLabel(summary.verdict) }}
        </p>
        <p class="mt-2 font-heading text-4xl font-semibold tracking-tight tabular-nums" :class="style.text">
          {{ pct(summary.difference_pct, { sign: true }) }}
        </p>
        <p class="text-sm text-muted-foreground">vs comparable median</p>
      </div>
      <ConfidencePill :confidence="summary.confidence" />
    </div>

    <!-- The numbers come before any conclusion -->
    <dl class="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border text-sm">
      <div class="bg-background p-3">
        <dt class="text-xs text-muted-foreground">Asking rent</dt>
        <dd class="font-heading text-lg font-semibold tabular-nums">{{ eur(summary.asking) }}</dd>
      </div>
      <div class="bg-background p-3">
        <dt class="text-xs text-muted-foreground">Comparable median</dt>
        <dd class="font-heading text-lg font-semibold tabular-nums">{{ eur(summary.median) }}</dd>
      </div>
      <div class="bg-background p-3">
        <dt class="text-xs text-muted-foreground">Typical range (P10 to P90)</dt>
        <dd class="font-medium tabular-nums">{{ eur(summary.p10) }} to {{ eur(summary.p90) }}</dd>
      </div>
      <div class="bg-background p-3">
        <dt class="text-xs text-muted-foreground">Difference</dt>
        <dd class="font-medium tabular-nums" :class="style.text">{{ diffEur }} ({{ pct(summary.difference_pct, { sign: true, decimals: 1 }) }})</dd>
      </div>
    </dl>

    <p class="text-xs text-muted-foreground">
      {{ summary.observations }} comparable observations · {{ period(summary.period.from, summary.period.to) }} · within {{ metres(summary.radius_m) }}
    </p>

    <div v-if="summary.claims.length" class="space-y-2 rounded-lg bg-muted/50 p-3">
      <p class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Why</p>
      <ClaimText v-for="c in summary.claims" :key="c.id" :claim="c" />
    </div>
  </div>
</template>

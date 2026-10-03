<script setup lang="ts">
import { VisAxis, VisLine, VisPlotline, VisScatter, VisXYContainer } from '@unovis/vue'
import { eur, month, parseDate, pct } from '~/lib/format'

const props = defineProps<{ series: { period: string; median: number }[]; asking: number; change12mPct: number; area: string }>()

interface Point { t: number; median: number; period: string }
const data = computed<Point[]>(() => props.series.map(s => ({ t: parseDate(s.period).getTime(), median: s.median, period: s.period })))

const css = (name: string) => (import.meta.client ? getComputedStyle(document.documentElement).getPropertyValue(name).trim() : '')
const brand = computed(() => css('--brand') || '#2563eb')
const line = computed(() => css('--verdict-inline') || '#64748b')

const yDomain = computed<[number, number]>(() => {
  const values = [...props.series.map(s => s.median), props.asking]
  return [Math.floor((Math.min(...values) * 0.94) / 100) * 100, Math.ceil((Math.max(...values) * 1.04) / 100) * 100]
})
const x = (d: Point) => d.t
const y = (d: Point) => d.median
const last = computed(() => data.value.slice(-1))
// One tick per calendar year inside the data range (avoids "2023, 2023" from auto ticks).
const yearTicks = computed(() => {
  const first = data.value[0]!.t
  const end = data.value.at(-1)!.t
  const ticks: number[] = []
  for (let y = new Date(first).getUTCFullYear(); y <= new Date(end).getUTCFullYear(); y++) {
    const t = Date.UTC(y, 0, 1)
    if (t >= first && t <= end) ticks.push(t)
  }
  return ticks
})
</script>

<template>
  <figure class="space-y-1">
    <ClientOnly>
      <VisXYContainer :data="data" :height="150" :y-domain="yDomain" :margin="{ top: 18, right: 8, left: 4, bottom: 0 }">
        <VisLine :x="x" :y="y" :color="line" :line-width="2" />
        <VisScatter :data="last" :x="x" :y="y" :color="line" :size="7" />
        <VisPlotline axis="y" :value="asking" :color="brand" :line-width="1.5" line-style="dash" :label-text="`Asking ${eur(asking)}`" label-position="top-left" :label-offset-y="-12" :label-size="11" :label-color="brand" />
        <VisAxis type="x" :tick-values="yearTicks" :tick-format="(v: number) => String(new Date(v).getUTCFullYear())" :grid-line="false" :tick-text-font-size="'11px'" />
        <VisAxis type="y" :num-ticks="3" :tick-format="(v: number) => eur(v)" :tick-text-font-size="'11px'" />
      </VisXYContainer>
      <template #fallback><div class="h-[150px] animate-pulse rounded-md bg-muted" /></template>
    </ClientOnly>
    <figcaption class="text-[11px] text-muted-foreground">
      Median rent in {{ area }}, {{ month(series[0]!.period) }} to {{ month(series.at(-1)!.period) }}.
      {{ pct(change12mPct, { sign: true, decimals: 1 }) }} in the last 12 months.
    </figcaption>
  </figure>
</template>

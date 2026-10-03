<script setup lang="ts">
import { VisAxis, VisPlotline, VisStackedBar, VisXYContainer } from '@unovis/vue'
import type { Comparable } from '~/types/api'
import { count, eur } from '~/lib/format'

const props = defineProps<{ comparables: Comparable[]; asking: number; median: number; caption?: string }>()

const BIN = 100
interface Bin { x: number; count: number; from: number }

const bins = computed<Bin[]>(() => {
  const rents = props.comparables.map(c => c.rent)
  const lo = Math.floor(Math.min(...rents, props.asking) / BIN) * BIN - BIN
  const hi = Math.ceil(Math.max(...rents, props.asking) / BIN) * BIN + BIN
  const out: Bin[] = []
  for (let from = lo; from < hi; from += BIN)
    out.push({ from, x: from + BIN / 2, count: rents.filter(r => r >= from && r < from + BIN).length })
  return out
})

const css = (name: string) => (import.meta.client ? getComputedStyle(document.documentElement).getPropertyValue(name).trim() : '')
const brand = computed(() => css('--brand') || '#2563eb')
const muted = computed(() => css('--verdict-inline') || '#64748b')

const x = (d: Bin) => d.x
const y = [(d: Bin) => d.count]
const color = (d: Bin) => (props.asking >= d.from && props.asking < d.from + BIN ? brand.value : muted.value)
const xDomain = computed<[number, number]>(() => [bins.value[0]!.from, bins.value.at(-1)!.from + BIN])
</script>

<template>
  <figure class="space-y-1">
    <ClientOnly>
      <VisXYContainer :data="bins" :height="170" :x-domain="xDomain" :margin="{ top: 26, right: 8, left: 4, bottom: 0 }">
        <VisStackedBar :x="x" :y="y" :color="color" :data-step="BIN" :bar-padding="0.12" :rounded-corners="3" />
        <VisPlotline axis="x" :value="median" :color="muted" :line-width="1.5" line-style="dash" :label-text="`Median ${eur(median)}`" label-position="top-left" :label-offset-y="-14" :label-size="11" :label-color="muted" />
        <VisPlotline axis="x" :value="asking" :color="brand" :line-width="2" :label-text="`Asking ${eur(asking)}`" label-position="top-right" :label-offset-y="-14" :label-size="11" :label-color="brand" />
        <VisAxis type="x" :tick-format="(v: number) => eur(v)" :num-ticks="4" :grid-line="false" :tick-text-font-size="'11px'" />
        <VisAxis type="y" :num-ticks="3" :tick-format="(v: number) => (Number.isInteger(v) ? String(v) : '')" :tick-text-font-size="'11px'" />
      </VisXYContainer>
      <template #fallback><div class="h-[170px] animate-pulse rounded-md bg-muted" /></template>
    </ClientOnly>
    <figcaption class="text-[11px] text-muted-foreground">
      Monthly rents of {{ count(comparables.length) }} comparable homes, in €{{ BIN }} bands.{{ caption ? ` ${caption}` : '' }}
    </figcaption>
  </figure>
</template>

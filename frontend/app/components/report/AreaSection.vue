<script setup lang="ts">
import type { Analysis } from '~/types/api'
import { count, eur, fraction } from '~/lib/format'
import ClaimText from './ClaimText.vue'

defineProps<{ area: NonNullable<Analysis['area']> }>()
const fmt = (v: number, unit: 'pct' | 'count' | 'eur') => (unit === 'pct' ? fraction(v) : unit === 'eur' ? eur(v) : count(v))
</script>

<template>
  <div class="space-y-3">
    <div class="grid grid-cols-2 gap-2">
      <div v-for="s in area.stats" :key="s.key" class="rounded-lg border p-3">
        <p class="text-xs text-muted-foreground">{{ s.label }}</p>
        <p class="type-display-sm text-foreground tabular-nums">{{ fmt(s.value, s.unit) }}</p>
        <p v-if="s.national != null" class="text-[11px] text-muted-foreground">Ireland: {{ fmt(s.national, s.unit) }}</p>
        <p class="mt-1 text-[11px] text-muted-foreground">{{ s.geography }} · {{ s.year }}</p>
      </div>
    </div>
    <ClaimText v-for="c in area.claims" :key="c.id" :claim="c" />
  </div>
</template>

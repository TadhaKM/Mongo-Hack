<script setup lang="ts">
// Key for the rent heatmap (A's --band-1..5 scale).
const BANDS = [
  { cls: 'bg-band-1', label: '<−10' },
  { cls: 'bg-band-2', label: '−10…−3' },
  { cls: 'bg-band-3', label: '±3' },
  { cls: 'bg-band-4', label: '+3…+10' },
  { cls: 'bg-band-5', label: '>+10' },
]
</script>

<template>
  <div class="rounded-xl border bg-background/95 px-3 py-2 shadow-md backdrop-blur" role="note" aria-label="Rent heatmap legend">
    <div class="mb-1.5 text-xs font-semibold">Rent vs local median (%)</div>
    <div class="flex gap-0.5">
      <div v-for="b in BANDS" :key="b.label" class="flex w-14 flex-col items-center gap-1">
        <span class="h-2 w-full rounded-full opacity-80" :class="b.cls" />
        <span class="whitespace-nowrap text-[10px] leading-none text-muted-foreground tabular-nums">{{ b.label }}</span>
      </div>
    </div>
  </div>
</template>

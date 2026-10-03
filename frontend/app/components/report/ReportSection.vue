<script setup lang="ts">
defineProps<{ id: string; title: string; unavailable?: string | null }>()
</script>

<template>
  <section :id="id" class="print-avoid-break scroll-mt-28 space-y-3 px-4 py-5">
    <h2 class="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{{ title }}</h2>
    <div v-if="unavailable" class="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">{{ unavailable }}</div>
    <slot v-else />
  </section>
</template>

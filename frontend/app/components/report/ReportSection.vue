<script setup lang="ts">
defineProps<{ id: string; title: string; unavailable?: string | null }>()
</script>

<template>
  <section :id="id" class="print-avoid-break scroll-mt-28 space-y-4 px-5 py-7">
    <h2 class="type-display-sm text-foreground">{{ title }}</h2>
    <div v-if="unavailable" class="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">{{ unavailable }}</div>
    <slot v-else />
  </section>
</template>

<script setup lang="ts">
import { ArrowLeft } from '@lucide/vue'

// Stand-in for Agent A's panel components while they are being built.
defineProps<{ name: string; props: Record<string, unknown> }>()
defineEmits<{ back: [] }>()
</script>

<template>
  <div class="space-y-3 p-4">
    <button type="button" class="inline-flex h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground" @click="$emit('back')">
      <ArrowLeft class="size-4" /> Back
    </button>
    <div class="rounded-lg border border-dashed p-4 text-sm">
      <p class="font-medium">&lt;{{ name }}&gt; coming from Agent A</p>
      <pre class="mt-2 overflow-x-auto text-xs text-muted-foreground">{{ JSON.stringify(props, null, 2) }}</pre>
    </div>
  </div>
</template>

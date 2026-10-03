<script setup lang="ts">
import { ExternalLink, TriangleAlert } from '@lucide/vue'
import type { Source } from '~/types/api'
import { day } from '~/lib/format'

const props = defineProps<{ sources: Source[]; limitations: string[]; disclaimer?: string }>()
const listed = computed(() => props.sources.filter(s => s.id !== 'user'))
</script>

<template>
  <div class="space-y-4">
    <ul class="divide-y rounded-lg border text-sm">
      <li v-for="s in listed" :key="s.id" class="flex items-start gap-2 px-3 py-2">
        <div class="min-w-0 flex-1">
          <p class="font-medium">{{ s.name }}</p>
          <p class="text-xs text-muted-foreground">{{ s.publisher }} · Data: {{ s.data_period }} · Retrieved {{ day(s.retrieved_at) }}</p>
        </div>
        <a v-if="s.url" :href="s.url" target="_blank" rel="noopener" class="mt-0.5 text-brand" :aria-label="`Open ${s.name}`"><ExternalLink class="size-3.5" /></a>
      </li>
    </ul>

    <div v-if="limitations.length" class="space-y-1.5 rounded-lg border border-verdict-above/30 bg-verdict-above/5 p-3 text-sm">
      <p class="flex items-center gap-1.5 text-xs font-semibold text-verdict-above"><TriangleAlert class="size-3.5" /> Limitations</p>
      <ul class="list-disc space-y-1 pl-4 text-xs">
        <li v-for="l in limitations" :key="l">{{ l }}</li>
      </ul>
    </div>

    <p class="text-xs text-muted-foreground">
      {{ disclaimer ?? 'mend.ai is a decision-support tool, not a valuation or legal advice.' }}
    </p>
  </div>
</template>

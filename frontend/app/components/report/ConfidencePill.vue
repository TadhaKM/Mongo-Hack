<script setup lang="ts">
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { Confidence } from '~/types/api'

const props = defineProps<{ confidence: Confidence }>()
const DOT = { high: 'bg-verdict-below', medium: 'bg-verdict-inline', low: 'bg-verdict-above' } as const
const label = computed(() => props.confidence.level[0]!.toUpperCase() + props.confidence.level.slice(1))
</script>

<template>
  <Popover>
    <PopoverTrigger as-child>
      <button type="button" class="type-caption-upper inline-flex items-center gap-1.5 rounded-full bg-background/80 px-2.5 py-1 text-foreground hover:bg-background">
        <span class="size-1.5 rounded-full" :class="DOT[confidence.level]" /> {{ label }} confidence
      </button>
    </PopoverTrigger>
    <PopoverContent class="w-72 space-y-3 text-sm" align="end">
      <div>
        <p class="font-medium">Why {{ confidence.level }}?</p>
        <ul class="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
          <li v-for="r in confidence.reasons" :key="r">{{ r }}</li>
        </ul>
      </div>
      <div class="space-y-1 border-t pt-2 text-xs text-muted-foreground">
        <p><strong class="text-foreground">High:</strong> 30+ comparables, all within 18 months and 1.5 km.</p>
        <p><strong class="text-foreground">Medium:</strong> 10 to 29 comparables, or the search radius was widened.</p>
        <p><strong class="text-foreground">Low:</strong> fewer than 10 comparables.</p>
      </div>
    </PopoverContent>
  </Popover>
</template>

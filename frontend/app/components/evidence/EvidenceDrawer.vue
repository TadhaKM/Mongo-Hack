<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import { Database, ExternalLink, Hash } from '@lucide/vue'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { Evidence, Source } from '~/types/api'
import { count, day } from '~/lib/format'

const props = defineProps<{ heading?: string; items: Evidence[]; sources: Source[] }>()
const open = defineModel<boolean>('open', { default: false })
const desktop = useMediaQuery('(min-width: 1024px)', { ssrWidth: 1280 })

const sourceOf = (id: string) => props.sources.find(s => s.id === id)
</script>

<template>
  <Sheet v-model:open="open">
    <SheetContent :side="desktop ? 'right' : 'bottom'" class="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-md lg:max-h-none">
      <SheetHeader class="border-b p-4 text-left">
        <SheetTitle>Evidence</SheetTitle>
        <SheetDescription v-if="heading" class="text-sm text-foreground/80">“{{ heading }}”</SheetDescription>
      </SheetHeader>

      <div class="flex-1 space-y-3 overflow-y-auto p-4">
        <p v-if="!items.length" class="text-sm text-muted-foreground">No evidence recorded for this claim.</p>
        <article v-for="e in items" :key="e.id" class="space-y-2 rounded-lg border p-3">
          <div class="flex items-baseline justify-between gap-3">
            <h3 class="text-sm font-medium">{{ e.label }}</h3>
            <p class="font-heading text-lg font-semibold tabular-nums">{{ e.value }}</p>
          </div>
          <p class="text-xs text-muted-foreground">{{ e.scope }}</p>
          <p v-if="e.observations" class="flex items-center gap-1.5 text-xs">
            <Hash class="size-3.5 text-muted-foreground" /> {{ count(e.observations) }} observations
          </p>
          <div v-if="sourceOf(e.source_id)" class="flex items-start gap-2 rounded-md bg-muted/60 p-2 text-xs">
            <Database class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <div class="min-w-0 flex-1">
              <p class="font-medium">{{ sourceOf(e.source_id)!.name }}</p>
              <p class="text-muted-foreground">
                {{ sourceOf(e.source_id)!.publisher }} · Data: {{ sourceOf(e.source_id)!.data_period }}
                · Retrieved {{ day(sourceOf(e.source_id)!.retrieved_at) }}
              </p>
            </div>
            <a v-if="sourceOf(e.source_id)!.url" :href="sourceOf(e.source_id)!.url" target="_blank" rel="noopener" class="text-brand" aria-label="Open source">
              <ExternalLink class="size-3.5" />
            </a>
          </div>
        </article>
      </div>
    </SheetContent>
  </Sheet>
</template>

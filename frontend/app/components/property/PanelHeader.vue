<script setup lang="ts">
import { ArrowLeft } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import TextSwap from '../report/TextSwap.vue'

defineProps<{ title?: string; subtitle?: string }>()
const sel = useMapSelection()
</script>

<template>
  <div class="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/95 px-3 py-2 backdrop-blur">
    <Button variant="ghost" size="icon" class="size-9 shrink-0" aria-label="Back" @click="sel.back()">
      <ArrowLeft class="size-4" />
    </Button>
    <div class="min-w-0 flex-1">
      <p v-if="title" class="truncate text-[15px] font-medium text-foreground">{{ title }}</p>
      <p v-if="subtitle" class="truncate text-xs text-muted-foreground"><TextSwap :text="subtitle" /></p>
    </div>
    <slot name="actions" />
  </div>
</template>

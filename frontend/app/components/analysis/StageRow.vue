<script setup lang="ts">
import { Check, TriangleAlert } from '@lucide/vue'
import type { Stage } from '~/types/api'

const props = defineProps<{ stage: Stage }>()

// Tick the first number in a done label up from 0 ("42 comparable properties found").
const shownLabel = ref(props.stage.label)
let frame = 0
watch(() => [props.stage.status, props.stage.label] as const, ([status, label]) => {
  cancelAnimationFrame(frame)
  const match = status === 'done' ? /\d+/.exec(label) : null
  if (!match || !import.meta.client) { shownLabel.value = label; return }
  const target = Number(match[0])
  const start = performance.now()
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / 600)
    const eased = 1 - (1 - t) ** 3
    shownLabel.value = label.replace(match[0], String(Math.round(target * eased)))
    if (t < 1) frame = requestAnimationFrame(step)
  }
  frame = requestAnimationFrame(step)
}, { immediate: true })
onBeforeUnmount(() => cancelAnimationFrame(frame))
</script>

<template>
  <li class="flex gap-3 py-2" :aria-busy="stage.status === 'running'">
    <span class="mt-0.5 flex size-5 shrink-0 items-center justify-center">
      <span v-if="stage.status === 'pending'" class="size-2 rounded-full bg-muted-foreground/30" />
      <span v-else-if="stage.status === 'running'" class="relative flex size-2.5">
        <span class="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-75" />
        <span class="relative inline-flex size-2.5 rounded-full bg-brand" />
      </span>
      <span v-else-if="stage.status === 'done'" class="flex size-5 items-center justify-center rounded-full bg-verdict-below/15 text-verdict-below animate-in zoom-in-50 duration-200">
        <Check class="size-3.5" stroke-width="3" />
      </span>
      <TriangleAlert v-else class="size-4 text-verdict-above" />
    </span>
    <div class="min-w-0 flex-1">
      <p
        class="text-sm"
        :class="{
          'text-muted-foreground': stage.status === 'pending',
          'font-medium text-foreground': stage.status === 'running',
          'text-foreground': stage.status === 'done',
          'text-verdict-above': stage.status === 'failed',
        }"
      >
        {{ stage.status === 'failed' ? `Skipped: ${stage.label.replace(/…$/, '').toLowerCase()}` : shownLabel }}
      </p>
      <p v-if="stage.detail && stage.status !== 'pending' && stage.status !== 'running'" class="text-xs text-muted-foreground">
        {{ stage.detail }}
      </p>
    </div>
  </li>
</template>

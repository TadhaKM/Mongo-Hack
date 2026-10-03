<script setup lang="ts">
import { Check, TriangleAlert } from '@lucide/vue'
import type { Stage } from '~/types/api'
import { countTo, gsap, reducedMotion } from '~/lib/motion'

const props = defineProps<{ stage: Stage }>()

// When a stage finishes: stamp the tick in and count the first number in its label up from 0.
const shownLabel = ref(props.stage.label)
const tick = ref<HTMLElement>()
let tween: gsap.core.Tween | null = null

watch(() => [props.stage.status, props.stage.label] as const, async ([status, label], old) => {
  tween?.kill()
  const match = status === 'done' ? /\d+/.exec(label) : null
  if (!match || !import.meta.client) {
    shownLabel.value = label
  }
  else {
    const n = Number(match[0])
    tween = countTo(0, n, v => (shownLabel.value = label.replace(match[0], String(Math.round(v)))), { duration: 0.7 })
  }
  if (status === 'done' && old && old[0] !== 'done' && !reducedMotion()) {
    await nextTick()
    if (tick.value) gsap.from(tick.value, { scale: 0, rotate: -40, duration: 0.45, ease: 'back.out(3)' })
  }
}, { immediate: true })
onBeforeUnmount(() => tween?.kill())
</script>

<template>
  <li class="relative flex gap-3 py-2" :aria-busy="stage.status === 'running'">
    <span class="relative z-[1] mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-background">
      <span v-if="stage.status === 'pending'" class="size-2 rounded-full bg-muted-foreground/30" />
      <span v-else-if="stage.status === 'running'" class="relative flex size-2.5">
        <span class="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-75" />
        <span class="relative inline-flex size-2.5 rounded-full bg-brand" />
      </span>
      <span v-else-if="stage.status === 'done'" ref="tick" class="flex size-5 items-center justify-center rounded-full bg-brand text-brand-foreground">
        <Check class="size-3" stroke-width="3.5" />
      </span>
      <TriangleAlert v-else class="size-4 text-verdict-above" />
    </span>
    <div class="min-w-0 flex-1">
      <p
        class="text-sm"
        :class="{
          'text-muted-foreground': stage.status === 'pending',
          'font-semibold text-foreground': stage.status === 'running',
          'text-foreground': stage.status === 'done',
          'text-verdict-above': stage.status === 'failed',
        }"
      >
        {{ stage.status === 'failed' ? `Skipped: ${stage.label.replace(/…$/, '').toLowerCase()}` : shownLabel }}
      </p>
      <p v-if="stage.detail && (stage.status === 'done' || stage.status === 'failed')" class="text-xs text-muted-foreground">
        {{ stage.detail }}
      </p>
    </div>
  </li>
</template>

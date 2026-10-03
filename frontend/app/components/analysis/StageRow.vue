<script setup lang="ts">
import { Check, TriangleAlert } from '@lucide/vue'
import type { Stage } from '~/types/api'
import { countTo, gsap, reducedMotion, scrambleTo } from '~/lib/motion'

const props = defineProps<{ stage: Stage }>()

// A done label is split around its first number: the words scramble in, the number counts up.
const parts = computed(() => {
  const label = props.stage.status === 'failed' ? `Skipped: ${props.stage.label.replace(/…$/, '').toLowerCase()}` : props.stage.label
  // Only a leading count ("42 comparable properties found") animates; "Dublin 8" or "Q2 2026" stay text.
  const m = props.stage.status === 'done' ? /^(\d+)\s+(.*)$/.exec(label) : null
  if (!m) return { before: label, num: null as number | null, after: '' }
  return { before: '', num: Number(m[1]), after: m[2]! }
})
const shownNum = ref<number | null>(parts.value.num)
const beforeEl = ref<HTMLElement>()
const afterEl = ref<HTMLElement>()
const tick = ref<HTMLElement>()
const tweens: (gsap.core.Tween | null)[] = []

watch(() => props.stage.status, async (status, old) => {
  tweens.forEach(t => t?.kill())
  tweens.length = 0
  shownNum.value = parts.value.num
  if (status !== 'done' || !old || old === 'done' || !import.meta.client) return
  await nextTick()
  // Text: scramble from the running wording into the result. Figure: count up.
  if (parts.value.before) tweens.push(scrambleTo(beforeEl.value, parts.value.before, { duration: 0.6 }))
  if (parts.value.after) tweens.push(scrambleTo(afterEl.value, parts.value.after, { duration: 0.65 }))
  if (parts.value.num != null) tweens.push(countTo(0, parts.value.num, v => (shownNum.value = Math.round(v)), { duration: 0.7 }))
  if (tick.value && !reducedMotion()) tweens.push(gsap.from(tick.value, { scale: 0, rotate: -40, duration: 0.45, ease: 'back.out(3)' }))
})
onBeforeUnmount(() => tweens.forEach(t => t?.kill()))
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
        <span v-if="parts.num != null" class="tabular-nums">{{ shownNum }}&nbsp;</span><span ref="beforeEl">{{ parts.before }}</span><span ref="afterEl">{{ parts.after }}</span>
      </p>
      <p v-if="stage.detail && (stage.status === 'done' || stage.status === 'failed')" class="text-xs text-muted-foreground">
        {{ stage.detail }}
      </p>
    </div>
  </li>
</template>

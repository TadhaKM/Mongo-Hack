<script setup lang="ts">
import { swapText } from '~/lib/motion'

// Animated text replacement (GSAP SplitText). Vue renders the first text once (v-once), then
// GSAP owns this element's contents so split letters are never overwritten mid-animation.
const props = withDefaults(defineProps<{
  text: string
  /** Start by showing this, then swap to `text` (after `delay`). */
  from?: string
  delay?: number
  /** Don't swap on mount; a parent calls `swap()` (e.g. inside the completion beat). */
  manual?: boolean
}>(), { delay: 0, manual: false })

const el = ref<HTMLElement>()
let tl: gsap.core.Timeline | null = null

function swap(next = props.text, delay = 0) {
  tl?.kill()
  tl = swapText(el.value, next, { delay })
  return tl
}

onMounted(() => {
  if (!el.value) return
  if (props.from && !props.manual) swap(props.text, props.delay)
})
watch(() => props.text, (next, prev) => {
  if (next !== prev && !props.manual) swap(next)
})
onBeforeUnmount(() => tl?.kill())

defineExpose({ swap })
</script>

<template>
  <span class="relative inline-block" :aria-label="text"><span ref="el" v-once aria-hidden="true" class="inline-block">{{ from ?? text }}</span></span>
</template>

<script setup lang="ts">
import { gsap, reducedMotion } from '~/lib/motion'

// DESIGN.md atmospheric orb: a soft radial bloom, decoration only. Never holds content, never a fill.
const props = withDefaults(defineProps<{
  tone: 'mint' | 'peach' | 'lavender' | 'sky' | 'rose'
  size?: number
  drift?: boolean
}>(), { size: 260, drift: false })

const el = ref<HTMLElement>()
let tween: gsap.core.Tween | null = null

onMounted(() => {
  if (!props.drift || reducedMotion() || !el.value) return
  tween = gsap.to(el.value, { x: 28, y: 18, scale: 1.08, duration: 7, ease: 'sine.inOut', yoyo: true, repeat: -1 })
})
onBeforeUnmount(() => tween?.kill())
</script>

<template>
  <div
    ref="el"
    aria-hidden="true"
    class="pointer-events-none absolute rounded-full opacity-80 blur-2xl print:hidden"
    :style="{
      width: `${size}px`,
      height: `${size}px`,
      background: `radial-gradient(circle at 50% 50%, var(--orb-${tone}) 0%, color-mix(in srgb, var(--orb-${tone}) 40%, transparent) 45%, transparent 70%)`,
    }"
  />
</template>

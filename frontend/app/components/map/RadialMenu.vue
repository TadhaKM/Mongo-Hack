<script setup lang="ts">
import type { Component } from 'vue'
import { gsap, reducedMotion } from '~/lib/motion'

export interface RadialItem { key: string; label: string; icon: Component }

// Right-click / long-press menu on the map. Items bloom out from the point and,
// on close, fold back in reverse with their own ease (GSAP easeReverse).
const props = defineProps<{ x: number; y: number; items: RadialItem[] }>()
const emit = defineEmits<{ pick: [key: string]; closed: [] }>()

const RADIUS = 66
const root = ref<HTMLElement>()
const itemEls = ref<HTMLElement[]>([])
let tl: gsap.core.Timeline | null = null
let closing = false

/** Spread items on a circle starting at the top; keep the arc on-screen near edges. */
function angleFor(i: number) {
  const n = props.items.length
  const nearTop = props.y < RADIUS + 70
  const start = nearTop ? 0 : -90
  return ((start + (360 / n) * i + 45) * Math.PI) / 180
}

onMounted(() => {
  const els = itemEls.value
  tl = gsap.timeline({ paused: true, onReverseComplete: () => emit('closed') })
  tl.fromTo(root.value!.querySelector('.rc-radial__hub'), { scale: 0, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.2, ease: 'power2.out', easeReverse: 'power2.in' })
  tl.fromTo(els, { x: 0, y: 0, scale: 0.4, autoAlpha: 0 }, {
    x: (i: number) => Math.cos(angleFor(i)) * RADIUS,
    y: (i: number) => Math.sin(angleFor(i)) * RADIUS,
    scale: 1,
    autoAlpha: 1,
    duration: 0.38,
    ease: 'back.out(1.8)',
    easeReverse: 'power3.in',
    stagger: 0.035,
  }, 0.04)
  if (reducedMotion()) tl.progress(1)
  else tl.play()
  els[0]?.focus({ preventScroll: true })
  window.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  tl?.kill()
})

function close() {
  if (closing) return
  closing = true
  if (!tl || reducedMotion()) emit('closed')
  else tl.timeScale(1.6).reverse()
}

function pick(key: string) {
  emit('pick', key)
  close()
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

defineExpose({ close })
</script>

<template>
  <div
    ref="root"
    class="rc-radial pointer-events-none absolute z-20"
    :style="{ left: `${x}px`, top: `${y}px` }"
    role="menu"
    aria-label="Map actions"
  >
    <div class="rc-radial__hub" />
    <button
      v-for="(item, i) in items"
      :key="item.key"
      :ref="el => { if (el) itemEls[i] = el as HTMLElement }"
      type="button"
      role="menuitem"
      class="rc-radial__item pointer-events-auto group"
      :aria-label="item.label"
      @click.stop="pick(item.key)"
    >
      <component :is="item.icon" class="size-5" />
      <span class="rc-radial__label">{{ item.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.rc-radial { width: 0; height: 0; }
.rc-radial__hub {
  position: absolute; left: -9px; top: -9px; width: 18px; height: 18px; border-radius: 50%;
  background: #fff; border: 4px solid var(--brand); box-shadow: 0 2px 6px rgb(0 0 0 / 0.3);
}
.rc-radial__item {
  position: absolute; left: -24px; top: -24px; width: 48px; height: 48px; border-radius: 50%;
  display: grid; place-items: center;
  background: var(--background, #fff); color: var(--ink, #1b2430);
  border: 1px solid rgb(0 0 0 / 0.08);
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.18);
  cursor: pointer; visibility: hidden;
  transition: background-color 120ms ease, color 120ms ease;
}
.rc-radial__item:hover, .rc-radial__item:focus-visible { background: var(--brand); color: #fff; outline: none; }
.rc-radial__label {
  position: absolute; top: calc(100% + 6px); left: 50%; translate: -50% 0;
  white-space: nowrap; padding: 2px 8px; border-radius: 999px;
  background: var(--ink, #1b2430); color: #fff; font-size: 12px; font-weight: 600;
  opacity: 0; pointer-events: none; transition: opacity 120ms ease;
}
.rc-radial__item:hover .rc-radial__label, .rc-radial__item:focus-visible .rc-radial__label { opacity: 1; }
</style>

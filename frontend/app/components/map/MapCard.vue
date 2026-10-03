<script setup lang="ts">
import type { Component } from 'vue'
import { X } from '@lucide/vue'
import { onClickOutside } from '@vueuse/core'
import { gsap, reducedMotion } from '~/lib/motion'

// Small floating card opened from the map's radial menu (Send to landlord, Commute).
// Blooms out of the menu point, sits beside it on whichever side has room, and
// closes on Esc, the close button, or any click outside it.
const props = withDefaults(defineProps<{
  x: number; y: number; desktop: boolean
  title: string; subtitle?: string; icon: Component; width?: number
}>(), { subtitle: '', width: 360 })
const emit = defineEmits<{ closed: [] }>()

const root = ref<HTMLElement>()
const style = computed(() => {
  if (!props.desktop) return {}
  const parent = root.value?.parentElement?.getBoundingClientRect()
  const pw = parent?.width ?? 1280
  const ph = parent?.height ?? 800
  const W = props.width
  // Beside the point, on whichever side has more room (the side panel takes ~440 px on the left).
  const GAP = 70
  const roomRight = pw - (props.x + GAP)
  const roomLeft = props.x - GAP - 440
  const left = roomRight >= roomLeft ? Math.min(props.x + GAP, pw - W - 16) : Math.max(props.x - GAP - W, 440)
  const top = Math.min(Math.max(props.y - 120, 80), ph - 470)
  return { left: `${left}px`, top: `${Math.max(16, top)}px`, width: `${W}px` }
})

let tween: gsap.core.Tween | null = null
let closing = false

onMounted(() => {
  window.addEventListener('keydown', onKey)
  if (reducedMotion()) return
  const el = root.value!
  const parent = el.parentElement!.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  tween = gsap.fromTo(el, {
    autoAlpha: 0, scale: 0.85, y: 8,
    transformOrigin: `${props.x - (r.left - parent.left)}px ${props.y - (r.top - parent.top)}px`,
  }, { autoAlpha: 1, scale: 1, y: 0, duration: 0.35, ease: 'back.out(1.6)', easeReverse: 'power2.in' })
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  tween?.kill()
})

function close() {
  if (closing) return
  closing = true
  if (!tween || reducedMotion()) return emit('closed')
  tween.eventCallback('onReverseComplete', () => emit('closed'))
  tween.timeScale(1.5).reverse()
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

onClickOutside(root, close)
defineExpose({ close })
</script>

<template>
  <section
    ref="root"
    class="absolute z-30 flex flex-col gap-3 rounded-2xl border bg-background p-4 shadow-2xl"
    :class="desktop ? '' : 'inset-x-3 top-[124px] max-h-[calc(100dvh-140px)] overflow-y-auto'"
    :style="style"
    role="dialog"
    :aria-label="title"
    @contextmenu.stop
  >
    <header class="flex items-start gap-3">
      <span class="grid size-9 shrink-0 place-items-center rounded-full bg-brand text-brand-foreground">
        <component :is="icon" class="size-4" />
      </span>
      <div class="min-w-0 flex-1">
        <h2 class="text-sm font-semibold">{{ title }}</h2>
        <p v-if="subtitle" class="truncate text-xs text-muted-foreground">{{ subtitle }}</p>
      </div>
      <button type="button" class="grid size-9 place-items-center rounded-full hover:bg-muted" aria-label="Close" @click="close">
        <X class="size-4" />
      </button>
    </header>
    <slot :close="close" />
  </section>
</template>

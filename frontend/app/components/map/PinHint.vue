<script setup lang="ts">
import { Mail, MousePointerClick, PersonStanding, Route } from '@lucide/vue'
import { gsap, reducedMotion } from '~/lib/motion'

// One-time nudge beside the selected pin: the radial menu is otherwise invisible.
// Positioned by the parent in map-container pixels (centre of the price pill).
const props = defineProps<{ x: number; y: number; touch: boolean; flip: boolean }>()

const root = ref<HTMLElement>()
onMounted(() => {
  if (reducedMotion() || !root.value) return
  gsap.fromTo(root.value, { autoAlpha: 0, x: props.flip ? 8 : -8 }, { autoAlpha: 1, x: 0, duration: 0.35, ease: 'back.out(1.7)', delay: 0.15 })
})
</script>

<template>
  <div
    class="pointer-events-none absolute z-20"
    :style="{ left: `${x}px`, top: `${y}px` }"
    role="status"
  >
    <div
      ref="root"
      class="rc-hint absolute top-0 flex -translate-y-1/2 items-center gap-2.5 whitespace-nowrap rounded-xl bg-ink py-2 pl-2.5 pr-3 text-background shadow-xl"
      :class="flip ? 'right-[58px] rc-hint--flip' : 'left-[58px]'"
    >
      <MousePointerClick class="size-4 shrink-0 opacity-90" />
      <div class="leading-tight">
        <div class="text-[13px] font-semibold">{{ touch ? 'Tap the pin again for more' : 'Click the pin again for more' }}</div>
        <div class="mt-0.5 flex items-center gap-1.5 text-[11px] text-background/75">
          <Mail class="size-3" /> Landlord
          <span aria-hidden="true">·</span>
          <PersonStanding class="size-3" /> Street View
          <span aria-hidden="true">·</span>
          <Route class="size-3" /> Commute
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Arrow pointing at the pin. */
.rc-hint::before {
  content: '';
  position: absolute;
  top: 50%;
  left: -5px;
  width: 10px;
  height: 10px;
  background: inherit;
  transform: translateY(-50%) rotate(45deg);
  border-radius: 2px;
}
.rc-hint--flip::before { left: auto; right: -5px; }
</style>

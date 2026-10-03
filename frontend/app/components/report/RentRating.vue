<script setup lang="ts">
import { eur, pct } from '~/lib/format'
import { countTo, gsap, reducedMotion } from '~/lib/motion'

// The verdict drawn like a BER energy label: five stepped bands, a black pointer on this rent's band.
const props = defineProps<{ differencePct: number; asking: number; observations: number; animate?: boolean }>()

const BANDS = [
  { label: 'Well below', range: '15% or more under', bar: 'bg-band-1 text-white', width: 50 },
  { label: 'Below', range: '5 to 15% under', bar: 'bg-band-2 text-white', width: 61 },
  { label: 'In line', range: 'within 5% of', bar: 'bg-band-3 text-ink', width: 72 },
  { label: 'Above', range: '5 to 15% over', bar: 'bg-band-4 text-white', width: 83 },
  { label: 'Well above', range: '15% or more over', bar: 'bg-band-5 text-white', width: 94 },
] as const
const ROW = 30 // px, keep in sync with h-[30px] below

const band = computed(() => {
  const d = props.differencePct
  return d <= -15 ? 0 : d < -5 ? 1 : d <= 5 ? 2 : d < 15 ? 3 : 4
})

const root = ref<HTMLElement>()
const pointer = ref<HTMLElement>()
const shownPct = ref(props.animate ? 0 : props.differencePct)
const landed = ref(!props.animate)
let tl: gsap.core.Timeline | null = null
let counter: gsap.core.Tween | null = null

onMounted(() => {
  if (!props.animate || reducedMotion()) {
    shownPct.value = props.differencePct
    landed.value = true
    return
  }
  const bars = root.value!.querySelectorAll('[data-bar]')
  tl = gsap.timeline({ defaults: { ease: 'power3.out' } })
  tl.from(bars, { scaleX: 0, transformOrigin: 'left center', duration: 0.45, stagger: 0.07 })
    .from(pointer.value!, { autoAlpha: 0, x: 24, duration: 0.3 }, '-=0.15')
    // Travel down the scale from the first band and settle on this rent's band.
    .fromTo(pointer.value!, { y: 0 }, { y: band.value * ROW, duration: 0.5 + band.value * 0.12, ease: 'power2.inOut' })
    .add(() => { landed.value = true })
    .from(pointer.value!, { scale: 1.12, duration: 0.35, ease: 'back.out(3)' })
  counter = countTo(0, props.differencePct, v => (shownPct.value = v), { duration: 1.1, delay: 0.55 })
})
onBeforeUnmount(() => {
  tl?.kill()
  counter?.kill()
})
</script>

<template>
  <figure
    ref="root"
    class="rounded-xl border bg-background p-4"
    role="img"
    :aria-label="`Rent rating: ${BANDS[band].label}. ${pct(differencePct, { sign: true })} compared with ${observations} similar homes.`"
  >
    <figcaption class="mb-2 flex items-baseline justify-between gap-2">
      <span class="type-caption-upper text-foreground">Rent rating</span>
      <span class="text-xs text-muted-foreground">vs {{ observations }} similar homes</span>
    </figcaption>

    <div class="relative grid grid-cols-[1fr_auto] gap-x-2">
      <ol class="space-y-0">
        <li v-for="(b, i) in BANDS" :key="b.label" class="flex h-[30px] items-center">
          <div
            data-bar
            class="flex h-[24px] items-center pr-4 pl-2 whitespace-nowrap text-[11px] font-semibold transition-opacity duration-300 [clip-path:polygon(0_0,calc(100%-10px)_0,100%_50%,calc(100%-10px)_100%,0_100%)]"
            :class="[b.bar, landed && i !== band ? 'opacity-50' : 'opacity-100']"
            :style="{ width: `${b.width}%` }"
          >
            <span class="font-medium">{{ b.label }}</span>
          </div>
        </li>
      </ol>

      <!-- Pointer: a black arrow tab, like the rating arrow on a BER cert -->
      <div class="relative w-[92px]">
        <div
          ref="pointer"
          class="absolute top-0 left-0 flex h-[30px] w-full items-center"
          :style="animate ? undefined : { transform: `translateY(${band * ROW}px)` }"
        >
          <div class="flex h-[26px] w-full items-center justify-end gap-1 bg-ink pr-2 pl-4 text-white [clip-path:polygon(10px_0,100%_0,100%_100%,10px_100%,0_50%)]">
            <span class="text-sm font-semibold tabular-nums">{{ pct(shownPct, { sign: true }) }}</span>
          </div>
        </div>
      </div>
    </div>

    <p class="mt-2 text-xs text-muted-foreground">
      Asking <strong class="font-semibold text-foreground">{{ eur(asking) }}</strong> sits in the
      <strong class="font-semibold text-foreground">{{ BANDS[band].label.toLowerCase() }}</strong> band ({{ BANDS[band].range }} the median).
    </p>
  </figure>
</template>

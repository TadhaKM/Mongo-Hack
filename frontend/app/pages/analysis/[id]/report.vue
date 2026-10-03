<script setup lang="ts">
import { ArrowLeft, Check, Download, Link2, MapPin } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import EvidenceProvider from '~/components/evidence/EvidenceProvider.vue'
import ReportBody from '~/components/report/ReportBody.vue'
import GradientOrb from '~/components/report/GradientOrb.vue'
import MiniMap from '~/components/map/MiniMap.vue'
import type { FeatureId } from '~/composables/useMapSelection'
import { beds, day, eur, pct, propertyType, verdictLabel } from '~/lib/format'
import { VERDICT_STYLE } from '~/lib/verdict'
import { gsap, reducedMotion } from '~/lib/motion'

// Full "Know before you rent" report: cover, at-a-glance figures, the evidence, and a contents rail.
const route = useRoute()
const id = computed(() => String(route.params.id))
const { data: analysis } = useAnalysis(id)
const { data: report, isError, refetch } = useReport(id)

const a = computed(() => report.value?.analysis)
const summary = computed(() => a.value?.summary ?? null)
useHead({ title: computed(() => (a.value ? `Rent check · ${a.value.input.address}` : 'Rent check report')) })

const facts = computed(() => {
  if (!a.value) return ''
  const i = a.value.input
  const furnished = i.furnished === 'furnished' ? 'Furnished' : i.furnished === 'unfurnished' ? 'Unfurnished' : null
  return [beds(i.bedrooms), propertyType(i.property_type), furnished, i.floor_area_m2 ? `${i.floor_area_m2} m²` : null, a.value.property.area]
    .filter(Boolean).join(' · ')
})
const orb = computed(() => (summary.value ? ({ below_market: 'mint', in_line: 'lavender', above_market: 'peach' } as const)[summary.value.verdict] : 'lavender'))
const backTo = computed(() => {
  const q = new URLSearchParams()
  if (a.value?.input.property_id) q.set('listing', a.value.input.property_id)
  q.set('analysis', id.value)
  return `/?${q.toString()}`
})

const points = computed(() => {
  if (!report.value) return []
  const r = report.value
  return [
    ...r.comparables.items.map(c => ({ id: `cmp:${c.id}` as FeatureId, location: c.location })),
    ...r.location.transport.map(s => ({ id: `stop:${s.id}` as FeatureId, location: s.location })),
    ...r.planning.items.map(p => ({ id: `plan:${p.id}` as FeatureId, location: p.location })),
  ]
})

// Contents rail with scroll-spy.
const SECTIONS = [
  { id: 'r-rent', label: 'Is the rent fair?' },
  { id: 'r-comparables', label: 'What similar homes rent for' },
  { id: 'r-location', label: 'Getting around' },
  { id: 'r-area', label: 'The area' },
  { id: 'r-planning', label: 'Planning nearby' },
  { id: 'r-enquiry', label: 'Ask the landlord' },
  { id: 'r-sources', label: 'Where this comes from' },
]
const active = ref('r-rent')
let observer: IntersectionObserver | null = null
watch(report, async (r) => {
  if (!r || !import.meta.client) return
  await nextTick()
  observer?.disconnect()
  observer = new IntersectionObserver((entries) => {
    const visible = entries.filter(e => e.isIntersecting).sort((x, y) => x.boundingClientRect.top - y.boundingClientRect.top)
    if (visible[0]) active.value = visible[0].target.id
  }, { rootMargin: '-20% 0px -70% 0px' })
  SECTIONS.forEach((s) => {
    const el = document.getElementById(s.id)
    if (el) observer!.observe(el)
  })
}, { immediate: true })
function jump(sectionId: string) {
  document.getElementById(sectionId)?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' })
}

// Printing expands everything (e.g. all comparables) and drops interactive bits.
const printing = ref(false)
const onBeforePrint = () => (printing.value = true)
const onAfterPrint = () => (printing.value = false)
function printReport() {
  printing.value = true
  nextTick(() => window.print())
}
onMounted(() => {
  window.addEventListener('beforeprint', onBeforePrint)
  window.addEventListener('afterprint', onAfterPrint)
})

const copied = ref(false)
async function copyLink() {
  try {
    await navigator.clipboard.writeText(window.location.href)
    copied.value = true
    toast.success('Link copied')
    setTimeout(() => (copied.value = false), 2000)
  }
  catch {
    toast.error('Couldn\'t copy the link. Copy it from the address bar.')
  }
}

// Cover entrance, once.
const cover = ref<HTMLElement>()
watch(cover, (el) => {
  if (!el || reducedMotion()) return
  gsap.from(el.querySelectorAll('[data-rise]'), { y: 14, autoAlpha: 0, duration: 0.55, stagger: 0.07, ease: 'power3.out', clearProps: 'all' })
})
onBeforeUnmount(() => {
  observer?.disconnect()
  window.removeEventListener('beforeprint', onBeforePrint)
  window.removeEventListener('afterprint', onAfterPrint)
})
</script>

<template>
  <div class="min-h-dvh bg-canvas print:bg-white">
    <!-- Toolbar (screen only) -->
    <header class="sticky top-0 z-20 border-b bg-canvas/85 backdrop-blur print:hidden">
      <div class="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Button as-child variant="ghost" class="-ml-2 rounded-full px-3">
          <NuxtLink :to="backTo"><ArrowLeft class="size-4" /> Back to map</NuxtLink>
        </Button>
        <p class="type-caption-upper hidden flex-1 text-center text-muted-foreground sm:block">RentCheck · Know before you rent</p>
        <div class="ml-auto flex items-center gap-2">
          <Button variant="outline" class="rounded-full border-hairline-strong" :disabled="!report" @click="copyLink">
            <component :is="copied ? Check : Link2" class="size-4" />
            <span class="hidden sm:inline">{{ copied ? 'Copied' : 'Copy link' }}</span>
          </Button>
          <Button class="rounded-full bg-brand text-brand-foreground hover:bg-brand/90" :disabled="!report" @click="printReport">
            <Download class="size-4" /> Download PDF
          </Button>
        </div>
      </div>
    </header>

    <div v-if="isError" class="mx-auto max-w-3xl space-y-3 p-6 text-sm">
      <p>This report isn't ready. The check may still be running.</p>
      <Button variant="outline" size="sm" @click="refetch()">Try again</Button>
    </div>

    <div v-else-if="!report || !a" class="mx-auto max-w-6xl space-y-4 p-6">
      <p v-if="analysis?.status === 'running'" class="text-sm text-muted-foreground">The check is still running. This page fills in when it finishes.</p>
      <Skeleton class="h-64 w-full rounded-3xl" />
      <Skeleton class="h-24 w-full rounded-2xl" />
      <Skeleton class="h-96 w-full rounded-2xl" />
    </div>

    <main v-else class="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10 print:max-w-none print:p-0">
      <!-- Cover -->
      <section ref="cover" class="relative overflow-hidden rounded-3xl border bg-background print:rounded-none print:border-0">
        <GradientOrb :tone="orb" :size="520" class="-top-56 -left-40" />
        <GradientOrb tone="sky" :size="320" class="-right-24 -bottom-40 opacity-60" />
        <div class="relative grid gap-6 p-6 sm:p-10 lg:grid-cols-[1fr_380px] lg:gap-10">
          <div class="flex flex-col justify-between gap-8">
            <div class="space-y-4">
              <p data-rise class="type-caption-upper text-muted-foreground">Rent check · {{ day(report.generated_at) }}</p>
              <h1 data-rise class="font-heading text-[40px] leading-[1.05] font-light tracking-[-0.8px] text-balance text-foreground sm:text-[52px] sm:tracking-[-1.2px]">
                {{ a.input.address }}
              </h1>
              <p data-rise class="text-base text-muted-foreground">
                <span class="font-medium text-foreground">{{ eur(a.input.monthly_rent) }} a month</span> · {{ facts }}
              </p>
            </div>
            <div v-if="summary" data-rise class="flex flex-wrap items-center gap-3">
              <span class="type-caption-upper inline-flex items-center gap-1.5 rounded-full bg-background/90 px-3 py-1.5 text-foreground shadow-soft">
                <component :is="VERDICT_STYLE[summary.verdict].icon" class="size-3.5" :class="VERDICT_STYLE[summary.verdict].text" />
                {{ verdictLabel(summary.verdict) }}
              </span>
              <span class="text-sm text-muted-foreground">
                {{ pct(summary.difference_pct, { sign: true, decimals: 1 }) }} against {{ summary.observations }} similar homes nearby
              </span>
            </div>
          </div>
          <div data-rise class="relative h-64 overflow-hidden rounded-2xl border bg-muted lg:h-auto lg:min-h-72">
            <ClientOnly>
              <MiniMap class="absolute inset-0" :center="a.property.location" :points="points" />
            </ClientOnly>
            <p class="pointer-events-none absolute top-2 left-2 flex items-center gap-1 rounded-full bg-background/90 px-2.5 py-1 text-[11px] text-foreground shadow-soft">
              <MapPin class="size-3 text-brand" /> Comparables, transport and planning nearby
            </p>
          </div>
        </div>
      </section>

      <!-- At a glance -->
      <dl v-if="summary" class="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border bg-border lg:grid-cols-4 print:mt-6">
        <div class="bg-background p-5">
          <dt class="text-xs text-muted-foreground">Asking rent</dt>
          <dd class="type-display-md mt-1 text-foreground tabular-nums">{{ eur(summary.asking) }}</dd>
        </div>
        <div class="bg-background p-5">
          <dt class="text-xs text-muted-foreground">Median for similar homes</dt>
          <dd class="type-display-md mt-1 text-foreground tabular-nums">{{ eur(summary.median) }}</dd>
        </div>
        <div class="bg-background p-5">
          <dt class="text-xs text-muted-foreground">Difference a month</dt>
          <dd class="type-display-md mt-1 tabular-nums" :class="VERDICT_STYLE[summary.verdict].text">
            {{ summary.difference_eur > 0 ? '+' : summary.difference_eur < 0 ? '-' : '' }}{{ eur(Math.abs(summary.difference_eur)) }}
          </dd>
        </div>
        <div class="bg-background p-5">
          <dt class="text-xs text-muted-foreground">Confidence</dt>
          <dd class="type-display-md mt-1 text-foreground capitalize">{{ summary.confidence.level }}</dd>
          <p class="text-xs text-muted-foreground">{{ summary.observations }} homes within {{ summary.radius_m / 1000 }} km</p>
        </div>
      </dl>

      <!-- Body + contents rail -->
      <div class="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_260px] print:block">
        <article class="overflow-hidden rounded-2xl border bg-background print:rounded-none print:border-0">
          <EvidenceProvider :evidence="a.evidence" :sources="a.sources">
            <ReportBody
              hide-summary
              :animate="!printing"
              :print="printing"
              :analysis="a"
              :comparables="report.comparables"
              :location="report.location"
              :planning="report.planning"
              :disclaimer="report.disclaimer"
            />
          </EvidenceProvider>
        </article>

        <aside class="hidden lg:block print:hidden">
          <div class="sticky top-20 space-y-6">
            <nav aria-label="Report contents">
              <p class="type-caption-upper mb-2 text-muted-foreground">Contents</p>
              <ul class="space-y-0.5 border-l">
                <li v-for="s in SECTIONS" :key="s.id">
                  <button
                    type="button"
                    class="-ml-px block w-full border-l-2 py-1.5 pl-4 text-left text-sm transition-colors"
                    :class="active === s.id ? 'border-brand font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'"
                    @click="jump(s.id)"
                  >
                    {{ s.label }}
                  </button>
                </li>
              </ul>
            </nav>
            <div class="space-y-2 rounded-2xl border bg-background p-4">
              <p class="type-caption-upper text-muted-foreground">Data used</p>
              <ul class="space-y-1.5 text-xs">
                <li v-for="src in a.sources.filter(x => x.id !== 'user')" :key="src.id">
                  <span class="font-medium text-foreground">{{ src.name }}</span>
                  <span class="text-muted-foreground"> · {{ src.data_period }}</span>
                </li>
              </ul>
            </div>
            <p class="px-1 text-xs leading-relaxed text-muted-foreground">{{ report.disclaimer }}</p>
          </div>
        </aside>
      </div>

      <footer class="mt-8 flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-muted-foreground print:mt-4">
        <span>RentCheck AI · Report {{ a.id }}</span>
        <span>Generated {{ day(report.generated_at) }}</span>
      </footer>
    </main>
  </div>
</template>

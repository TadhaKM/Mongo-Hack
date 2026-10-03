<script setup lang="ts">
import { Check, Copy, Mail } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { beds, eur, metres, period, propertyType } from '~/lib/format'
import MapCard from './MapCard.vue'

// "Send to landlord", opened from the map's radial menu. A draft built from the
// evidence (same wording as A's report version). mend.ai never sends anything:
// the renter edits it, then copies it or opens it in their own email app.
const props = defineProps<{ listingId: string; x: number; y: number; desktop: boolean }>()
const emit = defineEmits<{ closed: [] }>()

const sel = useMapSelection()
const { data: listing } = useListing(() => props.listingId)
const { data: analysis } = useAnalysis(sel.activeAnalysisId)

/** The completed check for this listing, if there is one. */
const summary = computed(() => {
  const a = analysis.value
  return a?.input?.property_id === props.listingId ? a.summary : null
})

const asking = computed(() => summary.value?.asking ?? listing.value?.rent ?? 0)
const median = computed(() => summary.value?.median ?? listing.value?.area_median ?? null)
const counter = computed(() => {
  if (!median.value || asking.value <= median.value * 1.02) return null
  return Math.round((median.value + asking.value) / 2 / 50) * 50
})

const home = computed(() => {
  const l = listing.value
  if (!l) return 'property'
  const size = l.bedrooms === 0 ? 'studio' : `${beds(l.bedrooms).replace(' beds', '-bed').replace(' bed', '-bed')} ${propertyType(l.property_type).toLowerCase()}`
  return `${size} at ${l.address}`
})

function draft(): string {
  const s = summary.value
  const lines = ['Hi,', '', `I'm interested in the ${home.value}, listed at ${eur(asking.value)} a month.`]
  if (s) {
    lines.push('', `Similar homes nearby rent for a median of ${eur(s.median)} (${s.observations} recent registered tenancies within ${metres(s.radius_m)}, ${period(s.period.from, s.period.to)}).`)
  }
  else if (median.value) {
    lines.push('', `The median rent for similar homes in ${listing.value?.area ?? 'the area'} is ${eur(median.value)} a month.`)
  }
  if (counter.value) lines.push(`Would you consider ${eur(counter.value)} a month?`)
  else if (median.value) lines.push('The asking rent looks in line with the area, and I\'d like to go ahead with a viewing.')
  lines.push('', 'Could you also let me know:', '- the BER rating', '- the rent registered with the RTB for the previous tenancy', '- when the property is available to view', '', 'Thanks,', '[Your name]')
  return lines.join('\n')
}

const subject = computed(() => `Enquiry: ${home.value}`)
const body = ref('')
const touched = ref(false)
// Fill (and refill as data arrives) until the renter starts editing.
watchEffect(() => { if (!touched.value) body.value = draft() })

const mailto = computed(() => `mailto:?subject=${encodeURIComponent(subject.value)}&body=${encodeURIComponent(body.value)}`)
const copied = ref(false)
async function copy() {
  try {
    await navigator.clipboard.writeText(`${subject.value}\n\n${body.value}`)
    copied.value = true
    toast.success('Copied to clipboard')
    setTimeout(() => (copied.value = false), 2000)
  }
  catch {
    toast.error('Couldn\'t copy. Select the text and copy it yourself.')
  }
}

</script>

<template>
  <MapCard :x="x" :y="y" :desktop="desktop" title="Send to landlord" :subtitle="listing?.address ?? 'Loading…'" :icon="Mail" @closed="emit('closed')">
    <p v-if="counter" class="text-sm">
      Suggested offer: <strong class="font-semibold">{{ eur(counter) }}</strong>
      <span class="text-muted-foreground"> (midway between the median and the asking rent)</span>
    </p>
    <p v-else-if="!summary" class="text-xs text-muted-foreground">Run the full check first for a stronger, evidence-backed message.</p>

    <label class="sr-only" for="landlord-body">Message to the landlord</label>
    <textarea
      id="landlord-body"
      v-model="body"
      rows="9"
      class="w-full resize-y rounded-xl border bg-background px-3 py-2.5 text-sm leading-relaxed focus-visible:border-brand focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand/15"
      @input="touched = true"
    />

    <div class="flex flex-wrap gap-2">
      <a :href="mailto" class="inline-flex h-10 items-center gap-2 rounded-full bg-brand px-4 text-sm font-medium text-brand-foreground hover:bg-brand/90">
        <Mail class="size-4" /> Open in email
      </a>
      <button type="button" class="inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium hover:bg-muted" @click="copy">
        <component :is="copied ? Check : Copy" class="size-4" /> {{ copied ? 'Copied' : 'Copy' }}
      </button>
    </div>
    <p class="text-xs text-muted-foreground">
      mend.ai doesn't send anything.<template v-if="listing?.is_sample"> Sample listing: there's no real landlord to contact.</template>
    </p>
  </MapCard>
</template>

<script setup lang="ts">
import { Check, Copy, Mail } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import type { Analysis } from '~/types/api'
import { beds, eur, metres, period, propertyType } from '~/lib/format'

// Draft enquiry to the landlord, pre-filled from the evidence. RentCheck never sends anything:
// the renter edits it, then copies it or opens it in their own email app.
const props = defineProps<{ analysis: Analysis }>()

const { data: listing } = useListing(() => props.analysis.input.property_id ?? null)
const isSample = computed(() => listing.value?.is_sample ?? false)

const home = computed(() => {
  const i = props.analysis.input
  const size = i.bedrooms === 0 ? 'studio' : `${beds(i.bedrooms).replace(' beds', '-bed').replace(' bed', '-bed')} ${propertyType(i.property_type).toLowerCase()}`
  return `${size} at ${i.address}`
})

/** Midway between median and asking, rounded to €50. Only suggested when the rent is above market. */
const counter = computed(() => {
  const s = props.analysis.summary
  if (!s || s.verdict !== 'above_market') return null
  return Math.round((s.median + s.asking) / 2 / 50) * 50
})

function draft(): string {
  const s = props.analysis.summary
  const lines = [
    'Hi,',
    '',
    `I'm interested in the ${home.value}, listed at ${eur(props.analysis.input.monthly_rent)} a month.`,
  ]
  if (s) {
    lines.push('', `Similar homes nearby rent for a median of ${eur(s.median)} (${s.observations} recent registered tenancies within ${metres(s.radius_m)}, ${period(s.period.from, s.period.to)}).`)
    if (counter.value) lines.push(`Would you consider ${eur(counter.value)} a month?`)
    else lines.push('The asking rent looks in line with the area, and I\'d like to go ahead with a viewing.')
  }
  lines.push(
    '',
    'Could you also let me know:',
    '- the BER rating',
    '- the rent registered with the RTB for the previous tenancy',
    '- when the property is available to view',
    '',
    'Thanks,',
    '[Your name]',
  )
  return lines.join('\n')
}

const subject = computed(() => `Enquiry: ${home.value}`)
const body = ref(draft())
watch(() => props.analysis.id, () => (body.value = draft()))

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
const mailto = computed(() => `mailto:?subject=${encodeURIComponent(subject.value)}&body=${encodeURIComponent(body.value)}`)
</script>

<template>
  <div class="space-y-3">
    <p class="text-sm text-muted-foreground">
      A message built from this check. Edit it, then send it yourself. RentCheck doesn't send anything.
    </p>
    <p v-if="counter" class="text-sm">
      Suggested offer: <strong class="font-semibold text-foreground">{{ eur(counter) }}</strong>{{ ' ' }}<span class="text-muted-foreground">(midway between the median and the asking rent)</span>
    </p>
    <label class="sr-only" for="enquiry-body">Message to the landlord</label>
    <textarea
      id="enquiry-body"
      v-model="body"
      rows="12"
      class="w-full resize-y rounded-xl border border-hairline-strong bg-background px-4 py-3 text-sm leading-relaxed text-foreground focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/15 focus-visible:outline-none"
    />
    <div class="flex flex-wrap gap-2">
      <Button as-child class="rounded-full bg-brand text-brand-foreground hover:bg-brand/90">
        <a :href="mailto"><Mail class="size-4" /> Open in email</a>
      </Button>
      <Button variant="outline" class="rounded-full border-hairline-strong" @click="copy">
        <component :is="copied ? Check : Copy" class="size-4" /> {{ copied ? 'Copied' : 'Copy message' }}
      </Button>
    </div>
    <p v-if="isSample" class="text-xs text-muted-foreground">Sample listing: there's no real landlord to contact.</p>
  </div>
</template>

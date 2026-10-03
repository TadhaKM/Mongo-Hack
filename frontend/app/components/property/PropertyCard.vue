<script setup lang="ts">
import { Ruler, Sofa, Sparkles } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { beds, eur, pct, propertyType, walk } from '~/lib/format'
import { TRANSPORT_MODE } from '~/lib/transport'
import { VERDICT_STYLE } from '~/lib/verdict'
import ListingPhoto from './ListingPhoto.vue'
import PanelHeader from './PanelHeader.vue'

const props = defineProps<{ listingId: string }>()
const sel = useMapSelection()
const { data: listing, isPending, isError, refetch } = useListing(() => props.listingId)
const create = useCreateAnalysis()

const verdict = computed(() => (listing.value ? VERDICT_STYLE[listing.value.verdict] : null))
const diffEur = computed(() => (listing.value ? listing.value.rent - listing.value.area_median : 0))
const furnishedLabel = computed(() => ({ furnished: 'Furnished', unfurnished: 'Unfurnished', unknown: 'Furnishing not stated' })[listing.value?.furnished ?? 'unknown'])

async function runCheck() {
  try {
    const res = await create.mutateAsync({ property_id: props.listingId })
    sel.startAnalysis(res.id)
  }
  catch (err) {
    toast.error('Check didn\'t start', { description: err instanceof Error ? `${err.message} Try again.` : 'Try again.' })
  }
}
</script>

<template>
  <div>
    <PanelHeader :title="listing?.address ?? 'Rental'" :subtitle="listing?.area" />

    <div v-if="isPending" class="space-y-3 p-4">
      <Skeleton class="h-36 w-full rounded-lg" />
      <Skeleton class="h-8 w-40" />
      <Skeleton class="h-4 w-56" />
      <Skeleton class="h-10 w-full" />
    </div>

    <div v-else-if="isError || !listing" class="space-y-3 p-4 text-sm">
      <p>We couldn't load this listing.</p>
      <Button variant="outline" size="sm" @click="refetch()">Try again</Button>
    </div>

    <div v-else class="space-y-4 p-4">
      <!-- Illustrative photo (not the actual listing) -->
      <ListingPhoto :listing-id="listing.id" :type="listing.property_type" height="h-32 lg:h-44">
        <TooltipProvider v-if="listing.is_sample">
          <Tooltip>
            <TooltipTrigger as-child>
              <Badge variant="secondary" class="type-caption-upper absolute top-3 left-3 cursor-help rounded-full bg-background px-2.5 py-1 text-[11px]">Sample listing</Badge>
            </TooltipTrigger>
            <TooltipContent>Demo data based on RTB area medians, not a live advert. The photo is illustrative.</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </ListingPhoto>

      <div>
        <p class="type-display-md text-foreground tabular-nums">
          {{ eur(listing.rent) }}<span class="text-base font-normal text-muted-foreground"> /month</span>
        </p>
        <p class="mt-1 text-sm text-muted-foreground">
          {{ beds(listing.bedrooms) }} · {{ propertyType(listing.property_type) }} · {{ listing.area }}
        </p>
      </div>

      <!-- Quick verdict: numbers, not adjectives -->
      <div v-if="verdict" class="flex items-center gap-2 rounded-full bg-muted px-4 py-2 text-sm text-foreground">
        <component :is="verdict.icon" class="size-4 shrink-0" :class="verdict.text" />
        <span>
          <template v-if="listing.verdict === 'in_line'">In line with the area median of {{ eur(listing.area_median) }}</template>
          <template v-else>
            <strong class="font-semibold" :class="verdict.text">{{ eur(Math.abs(diffEur)) }} a month {{ diffEur > 0 ? 'above' : 'below' }}</strong>
            the area median ({{ pct(listing.diff_pct, { sign: true }) }})
          </template>
        </span>
      </div>

      <ul class="space-y-2 text-sm">
        <li class="flex items-center gap-2 text-muted-foreground">
          <Sofa class="size-4" /> {{ furnishedLabel }}
          <template v-if="listing.floor_area_m2">
            <span aria-hidden="true">·</span><Ruler class="size-4" /> {{ listing.floor_area_m2 }} m²
          </template>
        </li>
        <li v-if="listing.nearest_stop" class="flex items-center gap-2">
          <component :is="TRANSPORT_MODE[listing.nearest_stop.mode].icon" class="size-4" :class="TRANSPORT_MODE[listing.nearest_stop.mode].text" />
          <span>{{ TRANSPORT_MODE[listing.nearest_stop.mode].label }} · {{ listing.nearest_stop.name }} · {{ walk(listing.nearest_stop.walk_min) }}</span>
        </li>
      </ul>

      <div class="space-y-2">
        <Button class="h-11 w-full rounded-full bg-brand text-[15px] text-brand-foreground shadow-soft hover:bg-brand/90 active:bg-brand/80" :disabled="create.isPending.value" @click="runCheck">
          <Sparkles class="size-4" />
          {{ create.isPending.value ? 'Starting check…' : 'Check this rent' }}
        </Button>
        <p class="text-center text-xs text-muted-foreground">
          Compares it with RTB rents, then checks transport, census and planning nearby. Takes about 10 seconds.
        </p>
      </div>
    </div>
  </div>
</template>

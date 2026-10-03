<script setup lang="ts">
import { Building2, Ruler, Sofa, Sparkles } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { beds, eur, pct, propertyType, walk } from '~/lib/format'
import { TRANSPORT_MODE } from '~/lib/transport'
import { VERDICT_STYLE } from '~/lib/verdict'
import PanelHeader from './PanelHeader.vue'

const props = defineProps<{ listingId: string }>()
const sel = useMapSelection()
const { data: listing, isPending, isError, refetch } = useListing(() => props.listingId)
const create = useCreateAnalysis()

const verdict = computed(() => (listing.value ? VERDICT_STYLE[listing.value.verdict] : null))
const furnishedLabel = computed(() => ({ furnished: 'Furnished', unfurnished: 'Unfurnished', unknown: 'Furnishing not stated' })[listing.value?.furnished ?? 'unknown'])

async function runCheck() {
  try {
    const res = await create.mutateAsync({ property_id: props.listingId })
    sel.startAnalysis(res.id)
  }
  catch (err) {
    toast.error('Couldn\'t start the check', { description: err instanceof Error ? err.message : undefined })
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
      <!-- Photo placeholder -->
      <div class="relative flex h-24 items-center lg:h-36 justify-center overflow-hidden rounded-lg bg-gradient-to-br from-stone-100 via-stone-200 to-stone-300 dark:from-stone-800 dark:via-stone-800 dark:to-stone-700">
        <Building2 class="size-12 text-stone-400" />
        <TooltipProvider v-if="listing.is_sample">
          <Tooltip>
            <TooltipTrigger as-child>
              <Badge variant="secondary" class="absolute top-2 left-2 cursor-help">Sample listing</Badge>
            </TooltipTrigger>
            <TooltipContent>Demo data based on RTB area medians, not a live advert</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <div>
        <p class="font-heading text-3xl font-semibold tracking-tight">
          {{ eur(listing.rent) }}<span class="text-base font-normal text-muted-foreground"> /month</span>
        </p>
        <p class="mt-1 text-sm text-muted-foreground">
          {{ beds(listing.bedrooms) }} · {{ propertyType(listing.property_type) }} · {{ listing.area }}
        </p>
      </div>

      <!-- Quick verdict: numbers, not adjectives -->
      <div v-if="verdict" class="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm" :class="verdict.soft">
        <component :is="verdict.icon" class="size-4 shrink-0" />
        <span>
          <strong class="font-semibold">{{ pct(listing.diff_pct, { sign: true }) }}</strong>
          vs area median ({{ eur(listing.area_median) }})
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
        <Button class="h-11 w-full bg-brand text-brand-foreground hover:bg-brand/90" :disabled="create.isPending.value" @click="runCheck">
          <Sparkles class="size-4" />
          {{ create.isPending.value ? 'Starting…' : 'Run full check' }}
        </Button>
        <p class="text-center text-xs text-muted-foreground">
          Checks RTB rents, CSO census, NTA transport and planning data. About 10 seconds.
        </p>
      </div>
    </div>
  </div>
</template>

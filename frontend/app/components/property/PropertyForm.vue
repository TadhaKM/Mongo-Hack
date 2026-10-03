<script setup lang="ts">
import { toTypedSchema } from '@vee-validate/zod'
import { MapPin, Sparkles } from '@lucide/vue'
import { useForm } from 'vee-validate'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { DroppedPin } from '~/composables/useMapSelection'
import type { Furnished, GeocodeResult, PropertyType } from '~/types/api'
import { eur } from '~/lib/format'
import { RENT_SOFT_MAX, propertyFormSchema } from '~/lib/schemas'
import AddressAutocomplete from './AddressAutocomplete.vue'
import PanelHeader from './PanelHeader.vue'
import SegmentedControl from './SegmentedControl.vue'

const props = defineProps<{ initial: DroppedPin }>()
const sel = useMapSelection()
const create = useCreateAnalysis()

const { handleSubmit, defineField, errors, setFieldError, setFieldValue, values } = useForm({
  validationSchema: toTypedSchema(propertyFormSchema),
  initialValues: {
    address: props.initial.address ?? '',
    place_id: props.initial.place_id,
    location: props.initial.location,
    furnished: 'unknown' as Furnished,
  },
})

const onBlur = { validateOnModelUpdate: false, validateOnBlur: true }
const [address] = defineField('address', onBlur)
const [rent, rentAttrs] = defineField('monthly_rent', onBlur)
const [bedrooms] = defineField('bedrooms', { validateOnModelUpdate: true })
const [type] = defineField('property_type', { validateOnModelUpdate: true })
const [area, areaAttrs] = defineField('floor_area_m2', onBlur)
const [furnished] = defineField('furnished')
const [url, urlAttrs] = defineField('listing_url', onBlur)

// The address is shown read-only when the pin already resolved to one.
const editingAddress = ref(!props.initial.address)
const candidates = ref<GeocodeResult[]>([])
const confirmHighRent = ref(false)

function pickAddress(r: GeocodeResult) {
  setFieldValue('address', r.label)
  setFieldValue('place_id', r.place_id)
  setFieldValue('location', r.location)
  candidates.value = []
}

// Empty number inputs mean "not given", not 0.
const numberModel = (field: Ref<number | undefined>) => computed({
  get: () => field.value ?? '',
  set: (v: string | number) => { field.value = v === '' || v == null ? undefined : Number(v) },
})
const rentInput = numberModel(rent)
const areaInput = numberModel(area)

const BED_OPTIONS = [
  { value: 0, label: 'Studio' }, { value: 1, label: '1' }, { value: 2, label: '2' },
  { value: 3, label: '3' }, { value: 4, label: '4' }, { value: 5, label: '5+' },
]
const TYPE_OPTIONS: { value: PropertyType; label: string }[] = [
  { value: 'apartment', label: 'Apartment' }, { value: 'house', label: 'House' },
  { value: 'duplex', label: 'Duplex' }, { value: 'shared_room', label: 'Shared room' },
]
const FURNISHED_OPTIONS: { value: Furnished; label: string }[] = [
  { value: 'furnished', label: 'Furnished' }, { value: 'unfurnished', label: 'Unfurnished' }, { value: 'unknown', label: 'Not sure' },
]

const needsRentConfirm = computed(() => (values.monthly_rent ?? 0) > RENT_SOFT_MAX && !confirmHighRent.value)

function scrollToFirstError() {
  nextTick(() => document.querySelector('[data-form="property"] [aria-invalid="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
}

const submit = handleSubmit(async (form) => {
  if (needsRentConfirm.value) {
    scrollToFirstError()
    return
  }
  try {
    const res = await create.mutateAsync({
      address: form.address, place_id: form.place_id, location: form.location,
      monthly_rent: form.monthly_rent, bedrooms: form.bedrooms, property_type: form.property_type,
      floor_area_m2: form.floor_area_m2, furnished: form.furnished, listing_url: form.listing_url,
    })
    sel.startAnalysis(res.id)
  }
  catch (err) {
    if (err instanceof ApiRequestError && ['ADDRESS_NOT_FOUND', 'OUT_OF_COVERAGE', 'ADDRESS_AMBIGUOUS'].includes(err.code)) {
      editingAddress.value = true
      setFieldError('address', err.code === 'ADDRESS_AMBIGUOUS' ? 'That address matches several places. Pick one below.' : err.message)
      candidates.value = (err.details?.candidates as GeocodeResult[] | undefined) ?? []
      scrollToFirstError()
      return
    }
    toast.error('Check didn\'t start', { description: err instanceof Error ? `${err.message} Try again.` : 'Try again.' })
  }
}, scrollToFirstError)
</script>

<template>
  <div>
    <PanelHeader title="Check a rent" subtitle="Four details. RentCheck finds the rest." />

    <form class="space-y-5 p-4" data-form="property" novalidate @submit.prevent="submit">
      <!-- Address (required) -->
      <div class="space-y-1.5">
        <Label for="pf-address">Address</Label>
        <div v-if="!editingAddress" class="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <MapPin class="mt-0.5 size-4 shrink-0 text-brand" />
          <span class="flex-1">{{ address }}</span>
          <button type="button" class="text-xs font-medium text-brand hover:underline" @click="editingAddress = true">Change</button>
        </div>
        <AddressAutocomplete v-else id="pf-address" v-model="address" :invalid="!!errors.address" @select="pickAddress" />
        <p v-if="!editingAddress" class="sr-only">Address taken from the map pin.</p>
        <p v-if="errors.address" class="text-xs text-destructive">{{ errors.address }}</p>
        <ul v-if="candidates.length" class="divide-y rounded-md border text-sm">
          <li v-for="c in candidates" :key="c.place_id">
            <button type="button" class="w-full px-3 py-2 text-left hover:bg-muted" @click="pickAddress(c)">{{ c.label }}</button>
          </li>
        </ul>
        <p v-if="editingAddress && !address && initial.location" class="text-xs text-muted-foreground">
          Type the street to label your report. We'll use the exact spot of the pin you dropped.
        </p>
      </div>

      <!-- Rent (required) -->
      <div class="space-y-1.5">
        <Label for="pf-rent">Monthly rent</Label>
        <div class="relative">
          <span class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">€</span>
          <Input
            id="pf-rent" v-model="rentInput" v-bind="rentAttrs" type="number" inputmode="numeric" min="0" step="25"
            placeholder="2,200" class="h-10 pl-7" :aria-invalid="!!errors.monthly_rent || needsRentConfirm || undefined"
            @input="confirmHighRent = false"
          />
        </div>
        <p v-if="errors.monthly_rent" class="text-xs text-destructive">{{ errors.monthly_rent }}</p>
        <div v-else-if="needsRentConfirm" class="flex items-center justify-between gap-2 rounded-md border border-verdict-above/40 bg-verdict-above/10 px-3 py-2 text-xs">
          <span>{{ eur(values.monthly_rent ?? 0) }} is high for a monthly rent.</span>
          <button type="button" class="font-medium text-brand hover:underline" @click="confirmHighRent = true">Yes, it's monthly</button>
        </div>
      </div>

      <!-- Bedrooms (required) -->
      <div class="space-y-1.5">
        <Label>Bedrooms</Label>
        <SegmentedControl v-model="bedrooms" label="Bedrooms" :options="BED_OPTIONS" :invalid="!!errors.bedrooms" />
        <p v-if="errors.bedrooms" class="text-xs text-destructive">{{ errors.bedrooms }}</p>
      </div>

      <!-- Property type (required) -->
      <div class="space-y-1.5">
        <Label>Property type</Label>
        <SegmentedControl v-model="type" label="Property type" :options="TYPE_OPTIONS" :invalid="!!errors.property_type" />
        <p v-if="errors.property_type" class="text-xs text-destructive">{{ errors.property_type }}</p>
      </div>

      <div class="space-y-4 rounded-xl border border-dashed border-hairline-strong p-4">
        <p class="type-caption-upper text-muted-foreground">Optional · improves the match</p>

        <div class="space-y-1.5">
          <Label for="pf-area">Floor area</Label>
          <div class="relative">
            <Input id="pf-area" v-model="areaInput" v-bind="areaAttrs" type="number" inputmode="numeric" placeholder="68" class="h-10 pr-10" :aria-invalid="!!errors.floor_area_m2 || undefined" />
            <span class="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">m²</span>
          </div>
          <p v-if="errors.floor_area_m2" class="text-xs text-destructive">{{ errors.floor_area_m2 }}</p>
          <p v-else class="text-xs text-muted-foreground">Improves comparable matching</p>
        </div>

        <div class="space-y-1.5">
          <Label>Furnished</Label>
          <SegmentedControl v-model="furnished" label="Furnished" :options="FURNISHED_OPTIONS" />
        </div>

        <div class="space-y-1.5">
          <Label for="pf-url">Listing link</Label>
          <Input id="pf-url" v-model="url" v-bind="urlAttrs" type="url" inputmode="url" placeholder="https://" class="h-10" :aria-invalid="!!errors.listing_url || undefined" />
          <p v-if="errors.listing_url" class="text-xs text-destructive">{{ errors.listing_url }}</p>
          <p v-else class="text-xs text-muted-foreground">Kept for reference in your report</p>
        </div>
      </div>

      <Button type="submit" class="h-11 w-full rounded-full bg-brand text-[15px] text-brand-foreground shadow-soft hover:bg-brand/90 active:bg-brand/80" :disabled="create.isPending.value">
        <Sparkles class="size-4" />
        {{ create.isPending.value ? 'Starting check…' : 'Check this rent' }}
      </Button>
    </form>
  </div>
</template>

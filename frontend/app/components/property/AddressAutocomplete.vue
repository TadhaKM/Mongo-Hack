<script setup lang="ts">
import { MapPin } from '@lucide/vue'
import { Input } from '@/components/ui/input'
import type { GeocodeResult } from '~/types/api'

const props = defineProps<{ invalid?: boolean; id?: string }>()
const model = defineModel<string>({ default: '' })
const emit = defineEmits<{ select: [result: GeocodeResult]; blur: [] }>()

const open = ref(false)
const active = ref(-1)
const { data, error } = useGeocode(model)
const results = computed(() => (open.value ? data.value?.results ?? [] : []))
const coverageError = computed(() => (error.value instanceof ApiRequestError && error.value.code === 'OUT_OF_COVERAGE' ? error.value.message : null))

function choose(r: GeocodeResult) {
  model.value = r.label
  open.value = false
  emit('select', r)
}

function onKey(e: KeyboardEvent) {
  if (!results.value.length) return
  if (e.key === 'ArrowDown') { active.value = (active.value + 1) % results.value.length; e.preventDefault() }
  else if (e.key === 'ArrowUp') { active.value = (active.value - 1 + results.value.length) % results.value.length; e.preventDefault() }
  else if (e.key === 'Enter' && active.value >= 0) { choose(results.value[active.value]!); e.preventDefault() }
  else if (e.key === 'Escape') open.value = false
}

function onBlur() {
  // Let a click on a suggestion land before closing.
  setTimeout(() => { open.value = false; emit('blur') }, 150)
}
</script>

<template>
  <div class="relative">
    <Input
      :id="props.id"
      v-model="model"
      autocomplete="off"
      placeholder="Street address or Eircode"
      :aria-invalid="invalid || !!coverageError || undefined"
      role="combobox"
      :aria-expanded="results.length > 0"
      @focus="open = true"
      @input="open = true; active = -1"
      @keydown="onKey"
      @blur="onBlur"
    />
    <ul v-if="results.length" class="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-md border bg-popover shadow-lg" role="listbox">
      <li
        v-for="(r, i) in results"
        :key="r.place_id"
        role="option"
        :aria-selected="i === active"
        class="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-muted"
        :class="i === active ? 'bg-muted' : ''"
        @mousedown.prevent="choose(r)"
      >
        <MapPin class="size-4 shrink-0 text-muted-foreground" />
        <span class="truncate">{{ r.label }}</span>
      </li>
    </ul>
    <p v-if="coverageError" class="mt-1 text-xs text-destructive">{{ coverageError }}</p>
  </div>
</template>

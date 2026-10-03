<script setup lang="ts" generic="T extends string | number">
import { ToggleGroupItem, ToggleGroupRoot } from 'reka-ui'

const props = defineProps<{
  options: { value: T; label: string }[]
  label: string
  invalid?: boolean
}>()
const model = defineModel<T | undefined>()
const emit = defineEmits<{ blur: [] }>()

// reka works with strings; map back to the option's own value type.
const key = (v: T) => String(v)
const value = computed({
  get: () => (model.value === undefined ? '' : key(model.value)),
  set: (v: string) => {
    const opt = props.options.find(o => key(o.value) === v)
    if (opt) model.value = opt.value
  },
})
</script>

<template>
  <ToggleGroupRoot
    v-model="value"
    type="single"
    :aria-label="label"
    :aria-invalid="invalid || undefined"
    class="flex w-full flex-wrap gap-1.5"
    @focusout="emit('blur')"
  >
    <ToggleGroupItem
      v-for="opt in options"
      :key="key(opt.value)"
      :value="key(opt.value)"
      class="h-10 min-w-11 flex-1 rounded-md border px-3 text-sm font-medium transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none data-[state=on]:border-brand data-[state=on]:bg-brand/10 data-[state=on]:text-brand"
      :class="invalid ? 'border-destructive' : ''"
    >
      {{ opt.label }}
    </ToggleGroupItem>
  </ToggleGroupRoot>
</template>

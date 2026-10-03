<script setup lang="ts">
import { Building2 } from '@lucide/vue'
import type { PropertyType } from '~/types/api'
import { photoFor } from '~/lib/photos'

// Illustrative photo for a sample listing, always credited and labelled as illustrative.
const props = withDefaults(defineProps<{ listingId: string; type: PropertyType; height?: string }>(), { height: 'h-40' })
const photo = computed(() => photoFor(props.listingId, props.type))
const failed = ref(false)
</script>

<template>
  <figure class="relative overflow-hidden rounded-xl bg-canvas" :class="height">
    <img
      v-if="!failed"
      :src="photo.src"
      alt=""
      loading="lazy"
      decoding="async"
      class="size-full object-cover"
      @error="failed = true"
    >
    <div v-else class="flex size-full items-center justify-center">
      <Building2 class="size-10 text-hairline-strong" stroke-width="1.25" />
    </div>
    <slot />
    <figcaption
      v-if="!failed"
      class="absolute right-2 bottom-2 max-w-[75%] truncate rounded-full bg-black/55 px-2 py-0.5 text-[10px] text-white backdrop-blur-sm"
    >
      Illustrative photo ·
      <a :href="photo.source" target="_blank" rel="noopener" class="underline-offset-2 hover:underline" @click.stop>{{ photo.author }}, {{ photo.license }}</a>
    </figcaption>
  </figure>
</template>

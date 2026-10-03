<script setup lang="ts">
import type { Evidence, Source } from '~/types/api'
import { EVIDENCE_KEY } from './context'
import EvidenceDrawer from './EvidenceDrawer.vue'

const props = defineProps<{ evidence: Evidence[]; sources: Source[] }>()

const openIds = ref<string[]>([])
const heading = ref<string | undefined>()
const isOpen = ref(false)

provide(EVIDENCE_KEY, {
  open(ids, h) {
    openIds.value = ids
    heading.value = h
    isOpen.value = true
  },
  evidence: computed(() => props.evidence),
  sources: computed(() => props.sources),
})

const items = computed(() => openIds.value
  .map(id => props.evidence.find(e => e.id === id))
  .filter((e): e is Evidence => !!e))
</script>

<template>
  <slot />
  <EvidenceDrawer v-model:open="isOpen" :heading="heading" :items="items" :sources="sources" />
</template>

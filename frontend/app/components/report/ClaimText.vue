<script setup lang="ts">
import { Info } from '@lucide/vue'
import type { Claim } from '~/types/api'
import { useEvidence } from '../evidence/context'

const props = defineProps<{ claim: Claim }>()
const evidence = useEvidence()
// Guard: a claim with no evidence is never shown (brief A7).
const hasEvidence = computed(() => props.claim.evidence_ids.length > 0)
if (!hasEvidence.value && import.meta.dev) console.warn('[mend.ai] claim without evidence hidden:', props.claim)
</script>

<template>
  <p v-if="hasEvidence" class="text-sm leading-relaxed">
    {{ claim.text }}
    <button
      type="button"
      class="no-print ml-1 inline-flex translate-y-[-1px] items-center gap-1 rounded-full border px-2 py-0.5 align-middle text-[11px] font-medium text-brand transition-colors hover:bg-brand/10"
      @click="evidence.open(claim.evidence_ids, claim.text)"
    >
      <Info class="size-3" /> Evidence
    </button>
  </p>
</template>

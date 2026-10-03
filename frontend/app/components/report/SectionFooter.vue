<script setup lang="ts">
import { count, day } from '~/lib/format'
import { useEvidence } from '../evidence/context'

const props = defineProps<{ sourceIds: string[]; observations?: number }>()
const { sources } = useEvidence()
const shown = computed(() => props.sourceIds.map(id => sources.value.find(s => s.id === id)).filter(s => !!s))
</script>

<template>
  <footer v-if="shown.length" class="mt-3 space-y-0.5 border-t pt-2 text-[11px] text-muted-foreground">
    <p v-for="s in shown" :key="s!.id">
      Source: {{ s!.name }} · Data: {{ s!.data_period }}<template v-if="observations"> · {{ count(observations) }} observations</template> · Retrieved {{ day(s!.retrieved_at) }}
    </p>
  </footer>
</template>

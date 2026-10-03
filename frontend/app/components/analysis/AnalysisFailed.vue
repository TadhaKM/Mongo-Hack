<script setup lang="ts">
import { RotateCcw, TriangleAlert } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import type { Analysis } from '~/types/api'

const props = defineProps<{ analysis: Analysis }>()
const sel = useMapSelection()
const create = useCreateAnalysis()
const failedStage = computed(() => props.analysis.stages.find(s => s.status === 'failed'))

async function retry() {
  try {
    const res = await create.mutateAsync(props.analysis.input)
    sel.startAnalysis(res.id)
  }
  catch (err) {
    toast.error('Check didn\'t start', { description: err instanceof Error ? err.message : undefined })
  }
}

function edit() {
  sel.dropPin({ location: props.analysis.property.location, address: props.analysis.input.address, place_id: props.analysis.input.place_id })
}
</script>

<template>
  <div class="m-4 space-y-3 rounded-xl border bg-canvas-soft p-5">
    <p class="flex items-center gap-2 font-medium text-planning-refused"><TriangleAlert class="size-4" /> This check stopped<template v-if="failedStage"> at {{ failedStage.label.replace(/…$/, '').toLowerCase() }}</template></p>
    <p class="text-sm">{{ analysis.error?.message ?? 'A data source didn\'t respond, so there is no rating.' }} Try again, or change the details.</p>
    <p v-if="failedStage?.detail" class="text-xs text-muted-foreground">{{ failedStage.detail }}</p>
    <div class="flex gap-2">
      <Button size="sm" :disabled="create.isPending.value" @click="retry"><RotateCcw class="size-3.5" /> Try again</Button>
      <Button size="sm" variant="outline" @click="edit">Edit details</Button>
    </div>
  </div>
</template>

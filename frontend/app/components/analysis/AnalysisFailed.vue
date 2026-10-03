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
    toast.error('Retry failed', { description: err instanceof Error ? err.message : undefined })
  }
}

function edit() {
  sel.dropPin({ location: props.analysis.property.location, address: props.analysis.input.address, place_id: props.analysis.input.place_id })
}
</script>

<template>
  <div class="m-4 space-y-3 rounded-lg border border-planning-refused/30 bg-planning-refused/5 p-4">
    <p class="flex items-center gap-2 font-medium text-planning-refused"><TriangleAlert class="size-4" /> We couldn't finish this check</p>
    <p class="text-sm">{{ analysis.error?.message ?? 'Something went wrong while the agents were working.' }}</p>
    <p v-if="failedStage" class="text-xs text-muted-foreground">Failed at: {{ failedStage.label.replace(/…$/, '') }}<template v-if="failedStage.detail"> ({{ failedStage.detail }})</template></p>
    <div class="flex gap-2">
      <Button size="sm" :disabled="create.isPending.value" @click="retry"><RotateCcw class="size-3.5" /> Retry</Button>
      <Button size="sm" variant="outline" @click="edit">Edit details</Button>
    </div>
  </div>
</template>

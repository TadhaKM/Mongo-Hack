<script setup lang="ts">
import MapShell from '~/components/shell/MapShell.vue'

useMapSelectionUrlSync()
useHead({ title: 'RentCheck AI · Know before you rent' })
</script>

<template>
  <MapShell />
</template>

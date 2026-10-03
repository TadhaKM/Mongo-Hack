<script setup lang="ts">
// The database, live. Reads MongoDB Atlas through /api/db/* so the video can show real documents, real counts,
// the exact query and its timing, and which data is REAL versus SAMPLE.
useHead({ title: 'mend.ai · The database' })

interface Overview {
  connected: boolean; reason?: string; database?: string; serverVersion?: string; pingMs?: number
  totals?: { documents: number; collections: number }
  collections?: { name: string; purpose: string; count: number; classes: Record<string, number> }[]
  sources?: { id: string; title: string; organisation: string; url?: string; licence?: string; version?: string; dataClass: string }[]
  sample?: Record<string, unknown> | null
}
const { data: overview, pending } = await useFetch<Overview>('/api/db/overview')

const presets = [
  { label: 'Trinity College, Dublin', lng: -6.2546, lat: 53.3438 },
  { label: 'Dublin 8 (Cork Street)', lng: -6.283, lat: 53.338 },
  { label: 'Cork City', lng: -8.4756, lat: 51.8985 },
  { label: 'Galway City', lng: -9.0568, lat: 53.2707 },
  { label: 'Sligo', lng: -8.476, lat: 54.271 },
]
const choice = ref(0)
const bedrooms = ref(2)
const running = ref(false)
const result = ref<any>(null)
const error = ref('')
async function run() {
  running.value = true; error.value = ''
  try {
    const p = presets[choice.value]!
    result.value = await $fetch('/api/db/query', { query: { lng: p.lng, lat: p.lat, bedrooms: bedrooms.value, type: 'apartment' } })
  } catch (e: any) { error.value = e?.statusMessage ?? e?.message ?? 'Query failed'; result.value = null }
  finally { running.value = false }
}

const badge = (classes: Record<string, number>, count: number) => {
  if (!count) return { text: 'empty', cls: 'bg-stone-100 text-stone-500' }
  const keys = Object.keys(classes)
  if (!keys.length) return { text: 'records', cls: 'bg-stone-100 text-stone-600' }
  if (keys.every(k => k === 'real')) return { text: 'REAL', cls: 'bg-emerald-100 text-emerald-800' }
  if (keys.every(k => k !== 'real')) return { text: 'SAMPLE', cls: 'bg-amber-100 text-amber-800' }
  return { text: 'MIXED', cls: 'bg-sky-100 text-sky-800' }
}
const pretty = (v: unknown) => JSON.stringify(v, null, 2)
const n = (v: number) => v.toLocaleString('en-IE')
</script>

<template>
  <main class="mx-auto max-w-5xl space-y-8 px-5 py-10 text-stone-800">
    <header class="space-y-2">
      <NuxtLink to="/" class="text-sm text-stone-500 hover:text-stone-900">← mend.ai</NuxtLink>
      <h1 class="text-3xl font-light tracking-tight">The database behind every figure</h1>
      <p class="max-w-2xl text-stone-600">
        mend.ai keeps official rent data, its sources and the exact queries in MongoDB Atlas. Every number on a report traces back to a document you can open below.
      </p>
    </header>

    <p v-if="pending" class="text-stone-500">Connecting…</p>

    <section v-else-if="!overview?.connected" class="rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
      <p class="font-medium">Database not connected</p>
      <p class="text-sm">{{ overview?.reason }}</p>
      <p class="mt-2 text-sm">Set <code>MONGODB_URI</code> in the hosting environment (Vercel → Settings → Environment Variables) and redeploy.</p>
    </section>

    <template v-else>
      <section class="flex flex-wrap items-center gap-3 rounded-xl border border-stone-200 bg-white p-4">
        <span class="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-800"><span class="size-2 rounded-full bg-emerald-600" />Connected to MongoDB Atlas</span>
        <span class="text-sm text-stone-600">database <b>{{ overview.database }}</b> · MongoDB {{ overview.serverVersion }} · {{ overview.pingMs }} ms</span>
        <span class="ml-auto text-sm text-stone-600"><b>{{ n(overview.totals!.documents) }}</b> documents in <b>{{ overview.totals!.collections }}</b> collections</span>
      </section>

      <section class="space-y-3">
        <h2 class="text-xl font-light">What is in it</h2>
        <div class="overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <table class="w-full text-left text-sm">
            <thead class="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
              <tr><th class="px-4 py-2">Collection</th><th class="px-4 py-2 text-right">Documents</th><th class="px-4 py-2">Data</th><th class="px-4 py-2">What it holds</th></tr>
            </thead>
            <tbody>
              <tr v-for="c in overview.collections" :key="c.name" class="border-t border-stone-100">
                <td class="px-4 py-2 font-mono text-[13px]">{{ c.name }}</td>
                <td class="px-4 py-2 text-right tabular-nums">{{ n(c.count) }}</td>
                <td class="px-4 py-2"><span class="rounded-full px-2 py-0.5 text-xs font-medium" :class="badge(c.classes, c.count).cls">{{ badge(c.classes, c.count).text }}</span></td>
                <td class="px-4 py-2 text-stone-600">{{ c.purpose }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="text-sm text-stone-500"><b>REAL</b> = official published data (CSO / RTB). <b>SAMPLE</b> = clearly labelled demonstration data standing in for datasets not loaded yet. The engine refuses to present sample data as real.</p>
      </section>

      <section class="space-y-3 rounded-xl border border-stone-200 bg-white p-5">
        <h2 class="text-xl font-light">Run a live query</h2>
        <div class="flex flex-wrap items-end gap-3">
          <label class="text-sm">Address
            <select v-model.number="choice" class="mt-1 block rounded-md border border-stone-300 bg-white px-3 py-2">
              <option v-for="(p, i) in presets" :key="p.label" :value="i">{{ p.label }}</option>
            </select>
          </label>
          <label class="text-sm">Bedrooms
            <select v-model.number="bedrooms" class="mt-1 block rounded-md border border-stone-300 bg-white px-3 py-2"><option v-for="b in [1, 2, 3]" :key="b" :value="b">{{ b }}</option></select>
          </label>
          <button class="rounded-full bg-stone-900 px-5 py-2 text-sm text-white hover:bg-black disabled:opacity-50" :disabled="running" @click="run">{{ running ? 'Querying…' : 'Query the database' }}</button>
        </div>
        <p v-if="error" class="text-sm text-red-700">{{ error }}</p>
        <div v-if="result?.found" class="grid gap-4 md:grid-cols-2">
          <div class="space-y-2">
            <p class="text-sm text-stone-500">Result in {{ result.ms.nearestPlace + result.ms.trend }} ms</p>
            <p class="text-3xl font-light">€{{ n(Math.round(result.latest.averageRent)) }}<span class="text-base text-stone-500"> / month</span></p>
            <p class="text-sm text-stone-600">Average rent of new {{ bedrooms }}-bed apartment tenancies near <b>{{ result.place }}</b> ({{ n(result.distanceM) }} m away), {{ result.latest.period }}.</p>
            <ul class="text-sm text-stone-600"><li v-for="q in result.recentQuarters" :key="q.period" class="flex justify-between border-b border-stone-100 py-0.5"><span>{{ q.period }}</span><span class="tabular-nums">€{{ n(Math.round(q.averageRent)) }}</span></li></ul>
            <div class="rounded-lg bg-stone-50 p-3 text-xs text-stone-600">
              <p class="font-medium text-stone-800">Provenance of this figure</p>
              <p>source <b>{{ result.provenance.sourceId }}</b> · original record <code>{{ result.provenance.recordId }}</code></p>
              <p>version {{ result.provenance.version }} · ingested {{ String(result.provenance.ingestedAt).slice(0, 19) }} · {{ result.provenance.transform }}</p>
              <p>data class: <b>{{ result.provenance.dataClass }}</b></p>
            </div>
          </div>
          <div class="space-y-2">
            <p class="text-sm font-medium">The exact MongoDB query</p>
            <pre class="max-h-72 overflow-auto rounded-lg bg-stone-900 p-3 text-[11px] leading-relaxed text-stone-100">{{ pretty(result.pipeline) }}</pre>
          </div>
        </div>
        <p v-else-if="result && !result.found" class="text-sm text-stone-600">{{ result.message }}</p>
      </section>

      <section v-if="overview.sample" class="space-y-2">
        <h2 class="text-xl font-light">A real document, as stored</h2>
        <pre class="max-h-80 overflow-auto rounded-xl bg-stone-900 p-4 text-xs leading-relaxed text-stone-100">{{ pretty(overview.sample) }}</pre>
      </section>

      <section class="space-y-3">
        <h2 class="text-xl font-light">Source registry</h2>
        <div class="grid gap-3 md:grid-cols-2">
          <article v-for="s in overview.sources" :key="s.id" class="rounded-xl border border-stone-200 bg-white p-4 text-sm">
            <div class="flex items-start justify-between gap-2"><p class="font-medium">{{ s.title }}</p>
              <span class="rounded-full px-2 py-0.5 text-xs font-medium" :class="s.dataClass === 'real' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'">{{ s.dataClass === 'real' ? 'REAL' : 'SAMPLE' }}</span></div>
            <p class="text-stone-600">{{ s.organisation }}</p>
            <p class="text-stone-500">version {{ s.version }} · {{ s.licence }}</p>
            <a v-if="s.url && s.dataClass === 'real'" :href="s.url" target="_blank" rel="noopener" class="text-sky-700 underline">{{ s.url }}</a>
          </article>
        </div>
      </section>
    </template>
  </main>
</template>

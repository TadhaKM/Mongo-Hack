import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/vue-query'
import type { MaybeRefOrGetter } from 'vue'
import type {
  AnalyseRequest, AnalyseResponse, Analysis, AnalysisEvent, ComparablesResponse, LocationResponse,
  PlanningResponse, ReportResponse, StageKey,
} from '~/types/api'
import { ApiRequestError, apiBase, apiFetch } from './client'

export function useCreateAnalysis() {
  return useMutation({
    mutationFn: (body: AnalyseRequest) => apiFetch<AnalyseResponse>('/analyse', { method: 'POST', body }),
  })
}

export function analysisKey(id: string | null) {
  return ['analysis', id] as const
}

// ---------- live updates (one shared EventSource per analysis id) ----------

interface Subscription { refs: number; source: EventSource | null; errors: number; polling: Ref<boolean> }
const subscriptions = new Map<string, Subscription>()

function subscribe(id: string, client: QueryClient): Subscription {
  const existing = subscriptions.get(id)
  if (existing) {
    existing.refs++
    return existing
  }
  const sub: Subscription = { refs: 1, source: null, errors: 0, polling: ref(false) }
  subscriptions.set(id, sub)

  const source = new EventSource(`${apiBase()}/analysis/${id}/events`)
  sub.source = source
  source.onmessage = (message) => {
    sub.errors = 0
    const event = JSON.parse(message.data) as AnalysisEvent
    if (event.type === 'stage') {
      const { type: _type, at: _at, ...stage } = event
      client.setQueryData<Analysis>(analysisKey(id), old => old && {
        ...old,
        stages: old.stages.some(s => s.stage === stage.stage)
          ? old.stages.map(s => (s.stage === stage.stage ? stage : s))
          : [...old.stages, stage],
      })
    }
    else {
      // complete / failed: close before the server does, so EventSource doesn't auto-reconnect.
      source.close()
      sub.source = null
      // Poll from here on: if the refetch still says "running" (stream and state disagree), polling recovers it.
      sub.polling.value = true
      void client.invalidateQueries({ queryKey: analysisKey(id) })
    }
  }
  source.onerror = () => {
    sub.errors++
    if (sub.errors >= 2) {
      source.close()
      sub.source = null
      sub.polling.value = true // fall back to polling GET /analysis/{id}
    }
  }
  return sub
}

function unsubscribe(id: string) {
  const sub = subscriptions.get(id)
  if (!sub) return
  sub.refs--
  if (sub.refs <= 0) {
    sub.source?.close()
    subscriptions.delete(id)
  }
}

/** The analysis, kept live by SSE while running; falls back to 1.5 s polling if the stream drops. */
export function useAnalysis(id: MaybeRefOrGetter<string | null>) {
  const client = useQueryClient()
  const polling = ref(false)

  const query = useQuery({
    queryKey: computed(() => analysisKey(toValue(id))),
    queryFn: ({ signal }) => apiFetch<Analysis>(`/analysis/${toValue(id)}`, { signal }),
    enabled: computed(() => !!toValue(id)),
    staleTime: Infinity,
    refetchInterval: q => (polling.value && q.state.data?.status === 'running' ? 1500 : false),
  })

  if (import.meta.client) {
    let current: string | null = null
    const stopPollingWatch = ref<(() => void) | null>(null)
    watch(
      () => toValue(id),
      (next) => {
        if (current) unsubscribe(current)
        stopPollingWatch.value?.()
        current = next
        polling.value = false
        if (!next) return
        const sub = subscribe(next, client)
        stopPollingWatch.value = watch(sub.polling, v => (polling.value = v), { immediate: true })
      },
      { immediate: true },
    )
    onScopeDispose(() => {
      if (current) unsubscribe(current)
      stopPollingWatch.value?.()
    })
  }

  return Object.assign(query, { polling: readonly(polling) })
}

export function useStageDone(id: MaybeRefOrGetter<string | null>, stage: StageKey) {
  const { data } = useAnalysis(id)
  return computed(() => data.value?.stages.find(s => s.stage === stage)?.status === 'done')
}

function useSection<T>(name: string, id: MaybeRefOrGetter<string | null>, stage: StageKey) {
  const done = useStageDone(id, stage)
  return useQuery({
    queryKey: computed(() => [name, toValue(id)] as const),
    queryFn: ({ signal }) => apiFetch<T>(`/analysis/${toValue(id)}/${name}`, { signal }),
    enabled: computed(() => !!toValue(id) && done.value),
    staleTime: Infinity,
    // NOT_READY means the stage hasn't landed server-side yet: keep asking for a little while.
    retry: (count, err) => (err instanceof ApiRequestError && err.code === 'NOT_READY' ? count < 15 : count < 1),
    retryDelay: 1000,
  })
}

export const useComparables = (id: MaybeRefOrGetter<string | null>) => useSection<ComparablesResponse>('comparables', id, 'comparables')
export const useLocationData = (id: MaybeRefOrGetter<string | null>) => useSection<LocationResponse>('location', id, 'transport')
export const usePlanning = (id: MaybeRefOrGetter<string | null>) => useSection<PlanningResponse>('planning', id, 'planning')

export function useReport(id: MaybeRefOrGetter<string | null>) {
  const { data } = useAnalysis(id)
  return useQuery({
    queryKey: computed(() => ['report', toValue(id)] as const),
    queryFn: ({ signal }) => apiFetch<ReportResponse>(`/analysis/${toValue(id)}/report`, { signal }),
    enabled: computed(() => !!toValue(id) && data.value?.status === 'complete'),
    staleTime: Infinity,
  })
}

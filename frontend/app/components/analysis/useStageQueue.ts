import type { Analysis, Stage, StageKey } from '~/types/api'

const MIN_RUNNING_MS = 400
const ORDER: StageKey[] = ['geocode', 'market', 'comparables', 'transport', 'area', 'planning', 'report']

/**
 * Smooths backend stage updates for display: every stage is shown as "running"
 * for at least 400 ms before it turns done/failed, so fast stages still read as work.
 * If the analysis is already finished when we mount (reload, shared link), it shows the end state at once.
 */
export function useStageQueue(analysis: Ref<Analysis | undefined>) {
  const shown = ref<Stage[]>([])
  const since = new Map<StageKey, number>()
  let skipAnimation: boolean | null = null
  let timer: ReturnType<typeof setInterval> | undefined

  function targets(): Stage[] {
    const byKey = new Map((analysis.value?.stages ?? []).map(s => [s.stage, s]))
    return ORDER.map((k): Stage => byKey.get(k) ?? { stage: k, status: 'pending', label: '' }).filter(s => s.label || byKey.has(s.stage))
  }

  function tick() {
    const target = targets()
    if (skipAnimation === null && analysis.value) skipAnimation = analysis.value.status !== 'running'
    if (skipAnimation) { shown.value = target; return }

    const now = Date.now()
    shown.value = target.map((t) => {
      const current = shown.value.find(s => s.stage === t.stage)
      const finished = t.status === 'done' || t.status === 'failed'
      // First sighting or still pending on screen: always pass through "running" first.
      if (!current || current.status === 'pending') {
        if (t.status === 'running' || finished) since.set(t.stage, now)
        return finished ? toRunning(t) : t
      }
      if (current.status === t.status) return t
      if (current.status === 'running' && finished)
        return now - (since.get(t.stage) ?? 0) >= MIN_RUNNING_MS ? t : current
      return t
    })
  }

  function toRunning(t: Stage): Stage {
    return { stage: t.stage, status: 'running', label: runningLabel(t.stage) }
  }

  const settled = computed(() => {
    const target = targets()
    return target.length > 0 && shown.value.length === target.length
      && shown.value.every((s, i) => s.status === target[i]!.status && s.label === target[i]!.label)
  })

  onMounted(() => {
    tick()
    timer = setInterval(tick, 100)
  })
  onBeforeUnmount(() => clearInterval(timer))

  return { stages: shown, settled, animated: computed(() => skipAnimation === false) }
}

const RUNNING: Record<StageKey, string> = {
  geocode: 'Locating property…', market: 'Retrieving rental market data…', comparables: 'Finding comparable properties…',
  transport: 'Analysing transport…', area: 'Reading census data…', planning: 'Checking planning applications…', report: 'Generating report…',
}
function runningLabel(k: StageKey) { return RUNNING[k] }

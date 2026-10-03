import { eventTimeline, getStored } from '../../../fixtures/analysis'

// GET /api/analysis/{id}/events (SSE). Replays the mock pipeline in real time.
// A late subscriber first receives everything that already happened, then the rest on schedule.
export default defineEventHandler(async (event) => {
  const analysis = getStored(getRouterParam(event, 'id')!)
  const stream = createEventStream(event)
  const timers: ReturnType<typeof setTimeout>[] = []
  const elapsed = Date.now() - analysis.startedAt

  for (const { at, event: payload } of eventTimeline(analysis)) {
    const send = () => {
      const data = payload.type === 'stage' ? { ...payload, at: new Date(analysis.startedAt + at).toISOString() } : payload
      void stream.push(JSON.stringify(data))
      if (payload.type !== 'stage') timers.push(setTimeout(() => void stream.close(), 250))
    }
    timers.push(setTimeout(send, Math.max(0, at - elapsed)))
  }

  stream.onClosed(() => timers.forEach(clearTimeout))
  return stream.send()
})

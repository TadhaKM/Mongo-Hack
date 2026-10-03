import type { AnalyseRequest, AnalyseResponse } from '../../app/types/api'
import { createAnalysis } from '../fixtures/analysis'

// POST /api/analyse
export default defineEventHandler(async (event): Promise<AnalyseResponse | ReturnType<typeof apiError>> => {
  const body = await readBody<AnalyseRequest>(event)
  const created = createAnalysis(body ?? {})
  if ('error' in created) return apiError(event, created.error.code === 'VALIDATION' ? 400 : 404, created.error.code, created.error.message)
  setResponseStatus(event, 202)
  return { id: created.id, status: 'running', events_url: `/analysis/${created.id}/events` }
})

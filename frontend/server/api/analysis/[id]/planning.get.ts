import { buildPlanning, getStored, isStageDone } from '../../../fixtures/analysis'

// GET /api/analysis/{id}/planning (available once stage "planning" is done)
export default defineEventHandler((event) => {
  const analysis = getStored(getRouterParam(event, 'id')!)
  if (!isStageDone(analysis, 'planning')) return apiError(event, 409, 'NOT_READY', 'Stage "planning" has not finished yet.')
  return buildPlanning(analysis)
})

import { buildComparables, getStored, isStageDone } from '../../../fixtures/analysis'

// GET /api/analysis/{id}/comparables (available once stage "comparables" is done)
export default defineEventHandler((event) => {
  const analysis = getStored(getRouterParam(event, 'id')!)
  if (!isStageDone(analysis, 'comparables')) return apiError(event, 409, 'NOT_READY', 'Stage "comparables" has not finished yet.')
  return buildComparables(analysis)
})

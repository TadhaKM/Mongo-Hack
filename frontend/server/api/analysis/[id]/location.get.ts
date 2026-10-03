import { buildLocation, getStored, isStageDone } from '../../../fixtures/analysis'

// GET /api/analysis/{id}/location (available once stage "transport" is done)
export default defineEventHandler((event) => {
  const analysis = getStored(getRouterParam(event, 'id')!)
  if (!isStageDone(analysis, 'transport')) return apiError(event, 409, 'NOT_READY', 'Stage "transport" has not finished yet.')
  return buildLocation(analysis)
})

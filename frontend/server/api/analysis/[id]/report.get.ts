import { buildAnalysis, buildReport, getStored } from '../../../fixtures/analysis'

// GET /api/analysis/{id}/report (available once the analysis is complete)
export default defineEventHandler((event) => {
  const analysis = getStored(getRouterParam(event, 'id')!)
  if (buildAnalysis(analysis).status !== 'complete') return apiError(event, 409, 'NOT_READY', 'The report is not ready yet.')
  return buildReport(analysis)
})

import { buildAnalysis, getStored } from '../../../fixtures/analysis'

// GET /api/analysis/{id}
export default defineEventHandler(event => buildAnalysis(getStored(getRouterParam(event, 'id')!)))

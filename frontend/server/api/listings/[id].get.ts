import { LISTINGS } from '../../fixtures/data'

// GET /api/listings/{id}
export default defineEventHandler((event) => {
  const listing = LISTINGS.find(l => l.id === getRouterParam(event, 'id'))
  return listing ?? apiError(event, 404, 'NOT_FOUND', 'Listing not found')
})

import type { H3Event } from 'h3'
import type { ApiError } from '../../app/types/api'

/** Sends the contract's ApiError body (docs/agents 1.5) with an HTTP status. */
export function apiError(event: H3Event, status: number, code: string, message: string, details?: Record<string, unknown>): ApiError {
  setResponseStatus(event, status)
  return { error: { code, message, ...(details ? { details } : {}) } }
}

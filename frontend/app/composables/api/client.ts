import { FetchError } from 'ofetch'
import type { ApiError } from '~/types/api'

/** Error thrown by every API composable. `code` is the contract error code (docs/agents 1.5). */
export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

export function apiBase(): string {
  return useRuntimeConfig().public.apiBase as string
}

/** Typed wrapper over $fetch. Components never call $fetch directly. */
type FetchOptions = NonNullable<Parameters<typeof $fetch>[1]>
// Plain signature: Nitro's typed-route inference is too deep for a dynamic path.
const rawFetch = $fetch as unknown as (path: string, opts: FetchOptions) => Promise<unknown>

export async function apiFetch<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  try {
    return (await rawFetch(path, { baseURL: apiBase(), ...opts })) as T
  }
  catch (err) {
    if (err instanceof FetchError) {
      const body = err.data as Partial<ApiError> | undefined
      throw new ApiRequestError(
        err.statusCode ?? 0,
        body?.error?.code ?? (err.statusCode ? `HTTP_${err.statusCode}` : 'NETWORK'),
        body?.error?.message ?? 'Something went wrong talking to the server.',
        body?.error?.details,
      )
    }
    throw err
  }
}

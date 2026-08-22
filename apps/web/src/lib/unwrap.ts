import axios from 'axios'
import type { ApiResponse } from '@otomate/shared'

/**
 * Unwraps the { data, error } envelope into a value or a thrown Error.
 *
 * The catch block is the important part: axios REJECTS its promise on any 4xx or
 * 5xx, so the success path never sees the body. Without digging the server's
 * message out of `err.response.data`, every considered error message the API
 * produces ("1 user(s) still have this role…") is replaced by axios's generic
 * "Request failed with status code 409".
 */
export async function unwrap<T>(promise: Promise<{ data: ApiResponse<T> }>): Promise<T> {
  try {
    const { data } = await promise
    if (data.error) throw new Error(data.error.message)
    return data.data
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const body = err.response?.data as ApiResponse<unknown> | undefined
      if (body?.error?.message) throw new Error(body.error.message)
      // Bodies can be missing entirely — a proxy timeout, or an upload rejected
      // before the route ran.
      if (err.response?.status === 413) throw new Error('That file is too large')
      if (!err.response) throw new Error('Could not reach the server. Check your connection.')
      throw new Error(`Request failed (${err.response.status})`)
    }
    throw err
  }
}

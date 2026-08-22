import type {
  CreateDsirInput,
  DsirReport,
  DsirSummary,
  SaveDsirInput,
} from '@otomate/shared'
import { api } from './api'
import { unwrap } from './unwrap'

export interface DsirListFilters {
  branchId?: string | null
  from?: string | null
  to?: string | null
  status?: string | null
}

export const dsirApi = {
  list: (f: DsirListFilters = {}) => {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(f)) if (v) params.set(k, v)
    const qs = params.toString()
    return unwrap<DsirSummary[]>(api.get(`/api/admin/dsir${qs ? `?${qs}` : ''}`))
  },
  get: (id: string) => unwrap<DsirReport>(api.get(`/api/admin/dsir/${id}`)),
  create: (input: CreateDsirInput) => unwrap<DsirReport>(api.post('/api/admin/dsir', input)),
  save: (id: string, input: SaveDsirInput) =>
    unwrap<DsirReport>(api.put(`/api/admin/dsir/${id}`, input)),
  finalize: (id: string) => unwrap<DsirReport>(api.post(`/api/admin/dsir/${id}/finalize`)),
  reopen: (id: string) => unwrap<DsirReport>(api.post(`/api/admin/dsir/${id}/reopen`)),
  remove: (id: string) => unwrap<{ success: boolean }>(api.delete(`/api/admin/dsir/${id}`)),
}

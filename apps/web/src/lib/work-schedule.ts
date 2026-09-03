import type {
  CreateWorkScheduleInput,
  UpdateEntriesInput,
  UpdateWorkScheduleInput,
  WorkSchedule,
} from '@otomate/shared'
import { api } from './api'
import { unwrap } from './unwrap'

/** The list omits rows; only the detail response carries the grid. */
export type WorkScheduleSummary = Omit<WorkSchedule, 'rows'> & { entryCount: number }

export const workScheduleApi = {
  list: () => unwrap<WorkScheduleSummary[]>(api.get('/api/admin/work-schedule')),
  get: (id: string) => unwrap<WorkSchedule>(api.get(`/api/admin/work-schedule/${id}`)),
  create: (input: CreateWorkScheduleInput) =>
    unwrap<WorkSchedule>(api.post('/api/admin/work-schedule', input)),
  /** Batched: a request per cell would be 581 of them for a full cutoff. */
  saveEntries: (id: string, input: UpdateEntriesInput) =>
    unwrap<WorkSchedule>(api.patch(`/api/admin/work-schedule/${id}/entries`, input)),
  update: (id: string, input: UpdateWorkScheduleInput) =>
    unwrap<WorkSchedule>(api.patch(`/api/admin/work-schedule/${id}`, input)),
  remove: (id: string) => unwrap<{ success: boolean }>(api.delete(`/api/admin/work-schedule/${id}`)),
  /** Marks a branch as finished planning for this cutoff, or unmarks it. */
  setBranchPlanned: (id: string, branchId: string, planned: boolean) =>
    unwrap<WorkSchedule>(api.put(`/api/admin/work-schedule/${id}/branches/${branchId}/planned`, { planned })),

  /**
   * Downloads the workbook.
   *
   * Bypasses unwrap(): the response is a file, not the {data, error} envelope.
   * And it cannot be a plain link — auth is a Bearer token in localStorage, not
   * a cookie, so the browser would fetch it logged out and get a 401.
   */
  async download(id: string, branch: string, filenameHint: string) {
    const res = await api.get(`/api/admin/work-schedule/${id}/export`, {
      params: { branch },
      responseType: 'blob',
    })
    // The server names the file; the hint is only for the case where a proxy
    // strips the header.
    const disposition = String(res.headers['content-disposition'] ?? '')
    const named = /filename="([^"]+)"/.exec(disposition)?.[1]

    const url = URL.createObjectURL(res.data as Blob)
    const link = document.createElement('a')
    link.href = url
    link.download = named ?? filenameHint
    document.body.appendChild(link)
    link.click()
    link.remove()
    // Revoked on the next tick: revoking immediately can cancel the download in
    // some browsers before it has started reading the blob.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  },
}

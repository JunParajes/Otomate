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
}

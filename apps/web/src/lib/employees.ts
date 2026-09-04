import type {
  CreateEmployeeInput,
  RehireEmployeeInput,
  SeparateEmployeeInput,
  CreatePositionInput,
  EmployeePositionRecord,
  UpdatePositionInput,
  CreateSalaryInput,
  Employee,
  UpdateEmployeeHrInput,
  UpdateEmployeeInput,
} from '@otomate/shared'
import { api } from './api'
import { unwrap } from './unwrap'


export const employeeApi = {
  list: () => unwrap<Employee[]>(api.get('/api/admin/employees')),
  // The list omits pay; the detail record carries it.
  get: (id: string) => unwrap<Employee>(api.get(`/api/admin/employees/${id}`)),
  create: (input: CreateEmployeeInput) => unwrap<Employee>(api.post('/api/admin/employees', input)),
  update: (id: string, input: UpdateEmployeeInput) =>
    unwrap<Employee>(api.patch(`/api/admin/employees/${id}`, input)),
  deactivate: (id: string) => unwrap<Employee>(api.delete(`/api/admin/employees/${id}`)),

  /**
   * The same edit applied to many people.
   *
   * Deliberately N calls to the ordinary update endpoint rather than a new bulk
   * route: every record goes through the same validation and permission check
   * as a single edit, so nothing can be written this way that could not be
   * typed. Assigning a position to eighty people is a one-off migration job,
   * not a hot path worth its own API surface.
   *
   * Runs a few at a time. All at once floods a server that also serves eleven
   * branches; strictly one at a time makes eighty edits feel like a hang.
   *
   * Returns what failed rather than throwing, because a partial result is the
   * useful answer: seventy-eight saved and two refused is something to act on,
   * and rolling the lot back would lose the seventy-eight.
   */
  updateMany: async (
    ids: string[],
    input: UpdateEmployeeInput,
    onProgress?: (done: number, total: number) => void
  ): Promise<{ updated: number; failures: { id: string; message: string }[] }> => {
    const failures: { id: string; message: string }[] = []
    let done = 0
    const BATCH = 5
    for (let i = 0; i < ids.length; i += BATCH) {
      const slice = ids.slice(i, i + BATCH)
      await Promise.all(slice.map(async id => {
        try {
          await unwrap<Employee>(api.patch(`/api/admin/employees/${id}`, input))
        } catch (e) {
          failures.push({ id, message: e instanceof Error ? e.message : 'Failed' })
        } finally {
          onProgress?.(++done, ids.length)
        }
      }))
    }
    return { updated: ids.length - failures.length, failures }
  },

  // The 201 file and pay are separate endpoints, not fields on update(): they
  // carry their own permissions, so `employees:write` alone must not reach them.
  updateHr: (id: string, input: UpdateEmployeeHrInput) =>
    unwrap<Employee>(api.patch(`/api/admin/employees/${id}/hr`, input)),
  /**
   * Leaving and returning are EVENTS, not field edits.
   *
   * Separating closes the spell and takes them off the roster together; a rehire
   * files the old spell and resets the clock. Both would be two or three
   * separate field updates otherwise, and any one of them could be forgotten.
   */
  separate: (id: string, input: SeparateEmployeeInput) =>
    unwrap<Employee>(api.post(`/api/admin/employees/${id}/separate`, input)),
  rehire: (id: string, input: RehireEmployeeInput) =>
    unwrap<Employee>(api.post(`/api/admin/employees/${id}/rehire`, input)),

  setSalary: (id: string, input: CreateSalaryInput) =>
    unwrap<Employee>(api.post(`/api/admin/employees/${id}/salary`, input)),
  removeSalary: (id: string, salaryId: string) =>
    unwrap<Employee>(api.delete(`/api/admin/employees/${id}/salary/${salaryId}`)),
}

/**
 * Job positions.
 *
 * Reading is gated on `employees:read` server-side — the picker on the employee
 * form needs it — while changing the list needs `positions:write`.
 */
export const positionApi = {
  list: () => unwrap<EmployeePositionRecord[]>(api.get('/api/admin/positions')),
  create: (input: CreatePositionInput) =>
    unwrap<EmployeePositionRecord>(api.post('/api/admin/positions', input)),
  update: (id: string, input: UpdatePositionInput) =>
    unwrap<EmployeePositionRecord>(api.patch(`/api/admin/positions/${id}`, input)),
  remove: (id: string) => unwrap<{ success: boolean }>(api.delete(`/api/admin/positions/${id}`)),
}

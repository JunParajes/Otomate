import type {
  CreateEmployeeInput,
  CreateSalaryInput,
  Employee,
  UpdateEmployeeHrInput,
  UpdateEmployeeInput,
} from '@otomate/shared'
import { api } from './api'
import { unwrap } from './unwrap'


export const employeeApi = {
  list: () => unwrap<Employee[]>(api.get('/api/admin/employees')),
  create: (input: CreateEmployeeInput) => unwrap<Employee>(api.post('/api/admin/employees', input)),
  update: (id: string, input: UpdateEmployeeInput) =>
    unwrap<Employee>(api.patch(`/api/admin/employees/${id}`, input)),
  deactivate: (id: string) => unwrap<Employee>(api.delete(`/api/admin/employees/${id}`)),

  // The 201 file and pay are separate endpoints, not fields on update(): they
  // carry their own permissions, so `employees:write` alone must not reach them.
  updateHr: (id: string, input: UpdateEmployeeHrInput) =>
    unwrap<Employee>(api.patch(`/api/admin/employees/${id}/hr`, input)),
  setSalary: (id: string, input: CreateSalaryInput) =>
    unwrap<Employee>(api.post(`/api/admin/employees/${id}/salary`, input)),
  removeSalary: (id: string, salaryId: string) =>
    unwrap<Employee>(api.delete(`/api/admin/employees/${id}/salary/${salaryId}`)),
}

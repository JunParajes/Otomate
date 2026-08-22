import type {
  CreateEmployeeInput,
  Employee,
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
}

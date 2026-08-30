import type {
  Branch,
  CreateBranchInput,
  CreateRoleInput,
  CreateUserInput,
  Permission,
  Role,
  RoleWithUsage,
  UpdateBranchInput,
  UpdateBranchLeaseInput,
  CreatePermitInput,
  CreateBranchRentInput,
  UpdateRoleInput,
  UpdateUserInput,
  User,
} from '@otomate/shared'
import { api } from './api'
import { unwrap } from './unwrap'


export type BranchWithUsage = Branch & { userCount: number }

export const adminApi = {
  permissions: () => unwrap<Permission[]>(api.get('/api/admin/permissions')),

  listUsers: () => unwrap<User[]>(api.get('/api/admin/users')),
  createUser: (input: CreateUserInput) => unwrap<User>(api.post('/api/admin/users', input)),
  updateUser: (id: string, input: UpdateUserInput) =>
    unwrap<User>(api.patch(`/api/admin/users/${id}`, input)),
  deactivateUser: (id: string) => unwrap<User>(api.delete(`/api/admin/users/${id}`)),
  resetPassword: (id: string, password: string, mustChangePassword: boolean) =>
    unwrap<{ success: boolean }>(
      api.post(`/api/admin/users/${id}/reset-password`, { password, mustChangePassword })
    ),

  listRoles: () => unwrap<RoleWithUsage[]>(api.get('/api/admin/roles')),
  createRole: (input: CreateRoleInput) => unwrap<RoleWithUsage>(api.post('/api/admin/roles', input)),
  updateRole: (id: string, input: UpdateRoleInput) =>
    unwrap<RoleWithUsage>(api.patch(`/api/admin/roles/${id}`, input)),
  deleteRole: (id: string, reassignToRoleId?: string) =>
    unwrap<{ success: boolean; reassigned: number }>(
      api.delete(`/api/admin/roles/${id}`, { data: reassignToRoleId ? { reassignToRoleId } : {} })
    ),

  listBranches: () => unwrap<BranchWithUsage[]>(api.get('/api/admin/branches')),
  createBranch: (input: CreateBranchInput) =>
    unwrap<BranchWithUsage>(api.post('/api/admin/branches', input)),
  updateBranch: (id: string, input: UpdateBranchInput) =>
    unwrap<BranchWithUsage>(api.patch(`/api/admin/branches/${id}`, input)),
  deleteBranch: (id: string) => unwrap<{ success: boolean }>(api.delete(`/api/admin/branches/${id}`)),

  // The list carries permits but no lease; the detail record carries both.
  getBranch: (id: string) => unwrap<Branch>(api.get(`/api/admin/branches/${id}`)),
  updateLease: (id: string, input: UpdateBranchLeaseInput) =>
    unwrap<Branch>(api.patch(`/api/admin/branches/${id}/lease`, input)),
  addPermit: (id: string, input: CreatePermitInput) =>
    unwrap<Branch>(api.post(`/api/admin/branches/${id}/permits`, input)),
  updatePermit: (id: string, permitId: string, input: CreatePermitInput) =>
    unwrap<Branch>(api.patch(`/api/admin/branches/${id}/permits/${permitId}`, input)),
  removePermit: (id: string, permitId: string) =>
    unwrap<Branch>(api.delete(`/api/admin/branches/${id}/permits/${permitId}`)),
  setRent: (id: string, input: CreateBranchRentInput) =>
    unwrap<Branch>(api.post(`/api/admin/branches/${id}/rent`, input)),
  removeRent: (id: string, rentId: string) =>
    unwrap<Branch>(api.delete(`/api/admin/branches/${id}/rent/${rentId}`)),

  changeOwnPassword: (currentPassword: string, newPassword: string) =>
    unwrap<{ success: boolean }>(
      api.post('/api/auth/change-password', { currentPassword, newPassword })
    ),
}

export type { Role, User, Permission }

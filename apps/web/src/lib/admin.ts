import type {
  Branch,
  CreateBranchInput,
  CreateRoleInput,
  CreateUserInput,
  Permission,
  Role,
  RoleWithUsage,
  UpdateBranchInput,
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

  changeOwnPassword: (currentPassword: string, newPassword: string) =>
    unwrap<{ success: boolean }>(
      api.post('/api/auth/change-password', { currentPassword, newPassword })
    ),
}

export type { Role, User, Permission }

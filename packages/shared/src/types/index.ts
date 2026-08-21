import type { PermissionName } from '../permissions.js'

export interface Branch {
  id: string
  name: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface Permission {
  id: string
  name: PermissionName
  category: string | null
  description: string | null
}

export interface Role {
  id: string
  name: string
  description: string | null
  isSystem: boolean
  permissions: Permission[]
  createdAt: string
  updatedAt: string
}

/** A role as it appears nested inside a user — no permission list. */
export interface RoleSummary {
  id: string
  name: string
  isSystem: boolean
}

export interface User {
  id: string
  email: string
  name: string
  isActive: boolean
  mustChangePassword: boolean
  lastLoginAt: string | null
  role: RoleSummary
  branch: Branch | null
  createdAt: string
  updatedAt: string
}

/** Role rows carry a user count so the UI can warn before deleting one. */
export interface RoleWithUsage extends Role {
  userCount: number
}

export type ApiResponse<T> =
  | { data: T; error: null }
  | { data: null; error: { message: string; code?: string } }

/**
 * The JWT payload carries identity ONLY. Permissions are re-read from the
 * database on every request, so a role change or deactivation takes effect
 * immediately instead of waiting for the token to expire.
 */
export interface AuthTokenPayload {
  userId: string
}

/** What the auth middleware attaches to the request, straight from the DB. */
export interface AuthContext {
  userId: string
  roleId: string
  roleName: string
  isSuperAdmin: boolean
  permissions: PermissionName[]
  branchId: string | null
  mustChangePassword: boolean
}

export interface LoginResponse {
  token: string
  user: User
}

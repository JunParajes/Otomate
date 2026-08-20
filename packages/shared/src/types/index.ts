export interface Branch {
  id: string
  name: string
}

export interface Permission {
  id: string
  name: string
}

export interface Role {
  id: string
  name: string
  permissions: Permission[]
}

export interface User {
  id: string
  email: string
  name: string
  isActive: boolean
  role: Role
  branch: Branch | null
  createdAt: string
  updatedAt: string
}

export type ApiResponse<T> =
  | { data: T; error: null }
  | { data: null; error: { message: string; code?: string } }

export interface AuthTokenPayload {
  userId: string
  roleId: string
  permissions: string[]
}

export interface LoginResponse {
  token: string
  user: Omit<User, 'role'> & { role: { id: string; name: string } }
}

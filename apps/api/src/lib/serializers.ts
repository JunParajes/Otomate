import type { Branch, Prisma, Role, User } from '@prisma/client'
import type {
  Branch as BranchDto,
  Permission as PermissionDto,
  PermissionName,
  Role as RoleDto,
  User as UserDto,
} from '@otomate/shared'

type UserWithRelations = User & { role: Role; branch: Branch | null }
type RoleWithPermissions = Prisma.RoleGetPayload<{ include: { permissions: true } }>

export function toBranchDto(branch: Branch): BranchDto {
  return {
    id: branch.id,
    name: branch.name,
    isActive: branch.isActive,
    createdAt: branch.createdAt.toISOString(),
    updatedAt: branch.updatedAt.toISOString(),
  }
}

/** Never returns the password hash — the only place user rows become responses. */
export function toUserDto(user: UserWithRelations): UserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    role: { id: user.role.id, name: user.role.name, isSystem: user.role.isSystem },
    branch: user.branch ? toBranchDto(user.branch) : null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  }
}

export function toPermissionDto(permission: {
  id: string
  name: string
  category: string | null
  description: string | null
}): PermissionDto {
  return {
    id: permission.id,
    name: permission.name as PermissionName,
    category: permission.category,
    description: permission.description,
  }
}

export function toRoleDto(role: RoleWithPermissions): RoleDto {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    permissions: role.permissions.map(toPermissionDto),
    createdAt: role.createdAt.toISOString(),
    updatedAt: role.updatedAt.toISOString(),
  }
}

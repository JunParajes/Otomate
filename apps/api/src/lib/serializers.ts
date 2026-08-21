import type { Branch, Prisma, Role, User } from '@prisma/client'
import { imageUrl } from './images'
import type {
  Category as CategoryDto,
  Product as ProductDto,
  ProductUnit,
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

type ProductWithCategory = Prisma.ProductGetPayload<{ include: { category: true } }>

export function toCategoryDto(category: {
  id: string
  name: string
  description: string | null
  isActive: boolean
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}): CategoryDto {
  return {
    id: category.id,
    name: category.name,
    description: category.description,
    isActive: category.isActive,
    sortOrder: category.sortOrder,
    createdAt: category.createdAt.toISOString(),
    updatedAt: category.updatedAt.toISOString(),
  }
}

/**
 * `costCents` is OMITTED unless the caller holds products:cost. Absent means
 * "not permitted to see"; null means "not recorded". Never send it and hide it
 * client-side — that just puts your margins in the network tab.
 */
export function toProductDto(product: ProductWithCategory, canSeeCost: boolean): ProductDto {
  const dto: ProductDto = {
    id: product.id,
    sku: product.sku,
    name: product.name,
    description: product.description,
    priceCents: product.priceCents,
    unit: product.unit as ProductUnit,
    imageUrl: imageUrl(product.imageFile),
    isActive: product.isActive,
    sortOrder: product.sortOrder,
    category: { id: product.category.id, name: product.category.name },
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  }
  if (canSeeCost) dto.costCents = product.costCents
  return dto
}

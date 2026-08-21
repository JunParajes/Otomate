/**
 * The permission catalog — the single source of truth.
 *
 * Permissions are defined HERE, in code, not in the admin GUI. `requirePermission()`
 * matches these strings literally, so letting a web form rename or delete one would
 * silently break enforcement. The GUI assigns these to roles; it cannot invent them.
 *
 * `prisma db seed` syncs this list into the Permission table.
 */
export const PERMISSIONS = [
  { name: 'users:read', category: 'Users', description: 'View users and their details' },
  { name: 'users:write', category: 'Users', description: 'Create, edit, activate and deactivate users' },
  { name: 'roles:read', category: 'Roles', description: 'View roles and their assigned permissions' },
  { name: 'roles:write', category: 'Roles', description: 'Create, edit and delete roles' },
  { name: 'branches:read', category: 'Branches', description: 'View branches' },
  { name: 'branches:write', category: 'Branches', description: 'Create, edit and delete branches' },
  { name: 'products:read', category: 'Products', description: 'View products and categories' },
  { name: 'products:write', category: 'Products', description: 'Create, edit and deactivate products' },
  { name: 'products:cost', category: 'Products', description: 'See cost price and profit margin' },
  { name: 'categories:write', category: 'Products', description: 'Create, edit and delete product categories' },
  { name: 'reports:read', category: 'Reports', description: 'View reports and dashboards' },
] as const

export type PermissionName = (typeof PERMISSIONS)[number]['name']

export const PERMISSION_NAMES: readonly PermissionName[] = PERMISSIONS.map(p => p.name)

/**
 * The one role the GUI may never delete, rename, or strip of permissions.
 * Holders bypass individual permission checks entirely, so adding a new
 * permission to the catalog can never lock the owner out of their own panel.
 */
export const SUPER_ADMIN_ROLE = 'super_admin'

export function isPermissionName(value: string): value is PermissionName {
  return (PERMISSION_NAMES as readonly string[]).includes(value)
}

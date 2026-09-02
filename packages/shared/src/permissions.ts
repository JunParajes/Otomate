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
  // Split from branches:* the same way HR is split from employees:*. Permit
  // expiry is operational — a manager needs to see it. Rent and lease terms are
  // commercial and are not their business.
  { name: 'branches:permits:read', category: 'Branches', description: 'View branch permits and expiry dates' },
  { name: 'branches:permits:write', category: 'Branches', description: 'Record and renew branch permits' },
  // Separate from lease: a manager can act on a spike in electricity or an
  // unpaid bill, and none of that requires knowing the rent.
  { name: 'branches:utilities:read', category: 'Branches', description: 'View utility accounts and bills' },
  { name: 'branches:utilities:write', category: 'Branches', description: 'Record utility accounts and bills' },
  { name: 'branches:lease:read', category: 'Branches', description: 'View rent, lessor and lease terms' },
  { name: 'branches:lease:write', category: 'Branches', description: 'Set rent and lease terms' },
  { name: 'employees:read', category: 'Employees', description: 'View employee records' },
  { name: 'employees:write', category: 'Employees', description: 'Create, edit and deactivate employees' },
  // Separate from employees:write: adding a job role changes what every branch
  // can pick from, which is administration rather than an everyday staff edit.
  { name: 'positions:write', category: 'Employees', description: 'Add, rename and remove employee positions' },
  { name: 'schedule:read', category: 'Employees', description: 'View work schedules' },
  { name: 'schedule:write', category: 'Employees', description: 'Draft and edit the work schedule' },
  // The General Manager approves; drafting it is not the same as signing it off.
  { name: 'schedule:approve', category: 'Employees', description: 'Approve or return a submitted work schedule' },
  // Separate from employees:* so a branch manager can see who works for them
  // without seeing government IDs or pay. Salary is split again because it is
  // the more sensitive of the two socially, and far fewer people need it.
  { name: 'hr:read', category: 'HR', description: 'View HR records — government IDs, hire and employment dates' },
  { name: 'hr:write', category: 'HR', description: 'Edit HR records' },
  { name: 'hr:salary:read', category: 'HR', description: 'View pay rates and salary history' },
  { name: 'hr:salary:write', category: 'HR', description: 'Set pay rates' },
  { name: 'dsir:read', category: 'DSIR', description: 'View daily sales and inventory reports' },
  { name: 'dsir:write', category: 'DSIR', description: 'Create and edit daily reports' },
  { name: 'dsir:finalize', category: 'DSIR', description: 'Finalise a report, locking it from further edits' },
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

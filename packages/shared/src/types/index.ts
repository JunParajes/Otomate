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

// ─── Product catalogue ────────────────────────────────────────────────────
import type { ProductUnit } from '../schemas/catalog.js'

export interface Category {
  id: string
  name: string
  description: string | null
  isActive: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface CategoryWithUsage extends Category {
  productCount: number
}

/**
 * `priceCents` and `costCents` are INTEGER CENTAVOS, not pesos.
 * `costCents` is omitted entirely unless the caller holds products:cost —
 * absent means "not permitted to see", null means "not recorded".
 */
export interface Product {
  id: string
  sku: string | null
  name: string
  description: string | null
  priceCents: number
  costCents?: number | null
  unit: ProductUnit
  imageUrl: string | null
  isActive: boolean
  sortOrder: number
  category: { id: string; name: string }
  createdAt: string
  updatedAt: string
}

// ─── Employees ────────────────────────────────────────────────────────────
import type { EmployeePosition } from '../schemas/employee.js'

/**
 * A person who works at a branch. Most have no login — an Employee is a staff
 * record, a User is an account. `linkedUser` is set only for the few who are both.
 */
export interface Employee {
  id: string
  employeeCode: string | null
  name: string
  position: EmployeePosition
  branch: { id: string; name: string } | null
  linkedUser: { id: string; email: string } | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

// ─── DSIR ─────────────────────────────────────────────────────────────────
import type { DsirStatus } from '../schemas/dsir.js'

export interface DsirLine {
  productId: string
  product: { id: string; name: string; sku: string | null; unit: string; category: { id: string; name: string } }
  /** Snapshot taken when the report was encoded, not the product's price today. */
  unitPriceCents: number
  begBal: number
  produced: number
  overEnd: number
  pulledOut: number
  endBal: number
  /** Derived, computed server-side from the same shared formula the UI uses. */
  transferredOut: number
  charged: number
  preTotal: number
  sold: number
  salesCents: number
}

export interface DsirCharge {
  id: string
  productId: string
  productName: string
  employeeId: string
  employeeName: string
  quantity: number
  valueCents: number
}

export interface DsirTransfer {
  id: string
  productId: string
  productName: string
  toBranchId: string
  toBranchName: string
  quantity: number
}

export interface DsirCollection {
  id: string
  employeeId: string | null
  employeeName: string | null
  label: string | null
  amountCents: number
}

/** Row shape for the report list — no lines, so it stays cheap. */
export interface DsirSummary {
  id: string
  branch: { id: string; name: string }
  reportDate: string
  status: DsirStatus
  salesCents: number
  collectionsCents: number
  varianceCents: number
  lineCount: number
  updatedAt: string
}

export interface DsirReport extends DsirSummary {
  usesCharges: boolean
  usesPullOuts: boolean
  usesTransfers: boolean
  usesOverEnd: boolean
  openedBy: { id: string; name: string } | null
  closedBy: { id: string; name: string } | null
  encodedBy: { id: string; name: string } | null
  finalizedAt: string | null
  notes: string | null
  lines: DsirLine[]
  charges: DsirCharge[]
  transfers: DsirTransfer[]
  collections: DsirCollection[]
  pulledOutCents: number
  chargedCents: number
  producedValueCents: number
}

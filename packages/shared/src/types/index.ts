import type { PermissionName } from '../permissions.js'
import type { BranchPermitRecord, BranchRentRecord, UtilityAccountRecord } from '../schemas/branch-records.js'

export interface BranchLease {
  address: string | null
  lessorName: string | null
  lessorContact: string | null
  lessorAddress: string | null
  contractStart: string | null
  contractEnd: string | null
  renewalNoticeDays: number | null
  depositCents: number | null
  advanceCents: number | null
}

/**
 * `permits` requires branches:permits:read; `lease` and `rentHistory` require
 * branches:lease:read. All three are OMITTED rather than nulled when the caller
 * lacks the permission, as with the employee record.
 */
export interface Branch {
  id: string
  name: string
  /** Short form for the schedule grid — "TRD", "Km11". Null until someone sets it. */
  abbreviation: string | null
  isActive: boolean
  permits?: BranchPermitRecord[]
  /** Requires `branches:utilities:read`. */
  utilities?: UtilityAccountRecord[]
  lease?: BranchLease
  /** Newest first. */
  rentHistory?: BranchRentRecord[]
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
import type {
  CivilStatus, EducationLevel, EmployeeContactRecord, EmployeeSalaryRecord,
  EmploymentType, Gender, PayoutMethod,
} from '../schemas/employee.js'

/**
 * The 201 file. Dates are YYYY-MM-DD, not timestamps — a hire date has no time
 * of day, and sending one invites a timezone to shift it across midnight.
 */
export interface EmployeeHr {
  birthDate: string | null
  birthPlace: string | null
  gender: Gender | null
  civilStatus: CivilStatus | null
  religion: string | null
  email: string | null
  /** Whole centimetres. */
  heightCm: number | null
  /** Grams — divide by 1000 to display kilos. Integer units, as with money. */
  weightGrams: number | null
  educationLevel: EducationLevel | null
  /** The course or strand, e.g. "BS Hotel and Restaurant Management". */
  educationDetail: string | null
  remarks: string | null

  /**
   * Document checks, held as the date the document was signed or produced
   * rather than a yes/no. A tick tells you nothing six months later; the date
   * answers "signed under which contract?" and still reads as "yes" when set.
   */
  confidentialityAgreementOn: string | null
  authorityToDeductOn: string | null
  birthCertificateOn: string | null
  marriageContractOn: string | null

  address: string | null
  /** In the order to try them. Empty when none are recorded. */
  contacts: EmployeeContactRecord[]
  emergencyName: string | null
  emergencyRelation: string | null
  emergencyContact: string | null

  sssNumber: string | null
  philhealthNumber: string | null
  pagibigNumber: string | null
  tin: string | null

  dateHired: string | null
  employmentType: EmploymentType
  probationEndDate: string | null
  /** Set when probation was extended; the original date above is left intact. */
  probationExtendedTo: string | null
  probationExtensionReason: string | null
  regularizedAt: string | null
  separatedAt: string | null
  separationReason: string | null

  payoutMethod: PayoutMethod
  payoutAccount: string | null
}

/**
 * A person who works at a branch. Most have no login — an Employee is a staff
 * record, a User is an account. `linkedUser` is set only for the few who are both.
 *
 * `hr` and `salary` are OMITTED — not nulled — for callers without the matching
 * permission, so an unauthorised response carries no trace of the values rather
 * than a shape suggesting they exist. The UI keys off their presence.
 */
export interface Employee {
  id: string
  employeeCode: string | null
  firstName: string
  middleName: string | null
  lastName: string
  suffix: string | null
  /** Derived from the parts by the API, so callers never have to assemble it. */
  name: string
  /** The position as stored, so a rename shows everywhere at once. */
  position: { id: string; name: string }
  branch: { id: string; name: string } | null
  linkedUser: { id: string; email: string } | null
  isActive: boolean
  /** Requires `hr:read`. */
  hr?: EmployeeHr
  /** Requires `hr:salary:read`. Newest first. */
  salaryHistory?: EmployeeSalaryRecord[]
  createdAt: string
  updatedAt: string
}

// ─── DSIR ─────────────────────────────────────────────────────────────────
import type { DsirStatus } from '../schemas/dsir.js'

export interface DsirLine {
  productId: string
  /** True when the opening was recounted rather than carried forward. */
  begBalRecounted: boolean
  /**
   * How a figure was counted, where it was counted rather than typed:
   * { endBal: '4*5+3*4' }. Absent keys were entered as plain numbers.
   */
  enteredAs: Partial<Record<'begBal' | 'produced' | 'overEnd' | 'pulledOut' | 'endBal', string>> | null
  /**
   * The opening this line inherits from the branch's previous finalised report,
   * so a recount can be shown against what it replaced. Null when the branch has
   * no finalised history yet.
   */
  carriedBegBal: number | null
  product: { id: string; name: string; sku: string | null; unit: string; category: { id: string; name: string } }
  /** Snapshot taken when the report was encoded, not the product's price today. */
  unitPriceCents: number
  begBal: number
  produced: number
  overEnd: number
  pulledOut: number
  endBal: number
  /** Derived, computed server-side from the same shared formula the UI uses. */
  transferredIn: number
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

/**
 * Stock received from another branch on the same date. Read-only here — it is
 * the sending branch's record, surfaced so both sides reconcile automatically.
 */
export interface DsirInboundTransfer {
  id: string
  productId: string
  productName: string
  fromBranchId: string
  fromBranchName: string
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
/**
 * One row on the finalised-report archive landing page.
 *
 * Branches with no finalised reports are still listed: "this branch has nothing
 * yet" is information, and a branch silently missing from the page looks like a
 * bug.
 */
export interface DsirArchiveBranch {
  branch: { id: string; name: string }
  finalizedCount: number
  earliestDate: string | null
  latestDate: string | null
}

/** A month that actually has finalised reports, for the archive's month picker. */
export interface DsirArchiveMonth {
  /** YYYY-MM */
  month: string
  count: number
}

export interface DsirSummary {
  id: string
  branch: { id: string; name: string }
  reportDate: string
  status: DsirStatus
  salesCents: number
  collectionsCents: number
  varianceCents: number
  lineCount: number
  /**
   * Value of stock found in excess of what the books allow. The primary signal
   * that undeclared stock exists, so it is carried on the LIST row too — a
   * pattern of over-ends is only visible if you can see them without opening
   * every report.
   */
  overEndCents: number
  overEndUnits: number
  updatedAt: string
}

export interface DsirReport extends DsirSummary {
  /**
   * Which report the opening balances were carried from, as YYYY-MM-DD. Null
   * when the branch has no finalised report before this date — a first report,
   * or a run that has never been finalised.
   */
  carriedFromDate: string | null
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
  inboundTransfers: DsirInboundTransfer[]
  collections: DsirCollection[]
  /** Value of what this branch discarded — the only true loss. */
  pulledOutCents: number
  /** Value of employee charges — recoverable via payroll, not a loss. */
  chargedCents: number
  /** Retail value of what this branch actually PRODUCED. Excludes stock received
   *  from other branches, which the old spreadsheet lumped in under PROD'c. */
  producedValueCents: number
  /** Retail value of stock received from other branches. */
  receivedValueCents: number
}

import type { Branch, Prisma, Role, User } from '@prisma/client'
import { imageUrl } from './images'
import { computeLineTotals, formatEmployeeName } from '@otomate/shared'
import type {
  DsirReport as DsirReportDto,
  DsirLine as DsirLineDto,
  DsirSummary as DsirSummaryDto,
  DsirStatus,
  PermitType,
  UtilityType,
  Employee as EmployeeDto,
  CivilStatus,
  Gender,
  EducationLevel,
  EmploymentType,
  PayoutMethod,
  SalaryRateType,
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

type BranchWithRecords = Branch & {
  permits?: Prisma.BranchPermitGetPayload<{}>[]
  rents?: Prisma.BranchRentGetPayload<{ include: { recordedBy: true } }>[]
  utilityAccounts?: Prisma.BranchUtilityAccountGetPayload<{ include: { bills: true } }>[]
}

/**
 * `access` omits the permit and lease sections rather than nulling them, the
 * same rule as costCents on products and hr/salary on employees: an
 * unauthorised response carries no trace of what it is not allowed to show.
 */
export function toBranchDto(
  branch: BranchWithRecords,
  access: { permits?: boolean; utilities?: boolean; lease?: boolean } = {}
): BranchDto {
  const dto: BranchDto = {
    id: branch.id,
    name: branch.name,
    abbreviation: branch.abbreviation,
    isActive: branch.isActive,
    createdAt: branch.createdAt.toISOString(),
    updatedAt: branch.updatedAt.toISOString(),
  }

  if (access.permits && branch.permits) {
    // Soonest expiry first — what needs renewing is the reason to open this.
    // Permits with no expiry recorded sort last rather than first, since a
    // missing date is not urgent, only unknown.
    dto.permits = [...branch.permits]
      .sort((a, b) => {
        if (!a.expiresOn) return 1
        if (!b.expiresOn) return -1
        return a.expiresOn.getTime() - b.expiresOn.getTime()
      })
      .map(p => ({
        id: p.id,
        type: p.type as PermitType,
        label: p.label,
        number: p.number,
        issuedOn: dateOnly(p.issuedOn),
        expiresOn: dateOnly(p.expiresOn),
        authority: p.authority,
        note: p.note,
      }))
  }

  if (access.utilities && branch.utilityAccounts) {
    dto.utilities = [...branch.utilityAccounts]
      // Active accounts first, then by type, so a closed meter does not sit
      // above the one being paid every month.
      .sort((a, b) => (a.isActive === b.isActive ? a.type.localeCompare(b.type) : a.isActive ? -1 : 1))
      .map(a => ({
        id: a.id,
        type: a.type as UtilityType,
        label: a.label,
        provider: a.provider,
        accountNumber: a.accountNumber,
        meterNumber: a.meterNumber,
        isActive: a.isActive,
        // Newest period first: this month's bill is the one being looked for.
        bills: [...a.bills]
          .sort((x, y) => y.periodStart.getTime() - x.periodStart.getTime())
          .map(b => ({
            id: b.id,
            periodStart: dateOnly(b.periodStart)!,
            periodEnd: dateOnly(b.periodEnd)!,
            amountCents: b.amountCents,
            dueDate: dateOnly(b.dueDate),
            paidOn: dateOnly(b.paidOn),
            consumption: b.consumption,
            referenceNo: b.referenceNo,
            note: b.note,
          })),
      }))
  }

  if (access.lease) {
    dto.lease = {
      address: branch.address,
      lessorName: branch.lessorName,
      lessorContact: branch.lessorContact,
      lessorAddress: branch.lessorAddress,
      contractStart: dateOnly(branch.contractStart),
      contractEnd: dateOnly(branch.contractEnd),
      renewalNoticeDays: branch.renewalNoticeDays,
      depositCents: branch.depositCents,
      advanceCents: branch.advanceCents,
    }
    if (branch.rents) {
      dto.rentHistory = [...branch.rents]
        .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))
        .map(r => ({
          id: r.id,
          amountCents: r.amountCents,
          effectiveFrom: dateOnly(r.effectiveFrom)!,
          note: r.note,
          recordedBy: r.recordedBy ? { id: r.recordedBy.id, name: r.recordedBy.name } : null,
          createdAt: r.createdAt.toISOString(),
        }))
    }
  }

  return dto
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

type EmployeeWithRelations = Prisma.EmployeeGetPayload<{
  include: { branch: true; user: true; position: true }
}> & {
  contacts?: Prisma.EmployeeContactGetPayload<{}>[]
  pastEmployment?: Prisma.EmploymentPeriodGetPayload<{}>[]
  // Present only when the caller asked for salary and may see it.
  salaries?: Prisma.EmployeeSalaryGetPayload<{ include: { recordedBy: true } }>[]
}

/**
 * A DATE column as YYYY-MM-DD.
 *
 * `toISOString()` would be wrong here: it converts to UTC first, so a hire date
 * stored as 2026-08-30 comes back as the 29th for anyone east of Greenwich —
 * which is everyone using this app.
 */
function dateOnly(value: Date | null): string | null {
  if (!value) return null
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`
}

/**
 * `canSeeHr` and `canSeeSalary` OMIT their sections rather than nulling them, so
 * an unauthorised response carries no trace of the values — same approach as
 * `costCents` on the product DTO above.
 */
export function toEmployeeDto(
  employee: EmployeeWithRelations,
  access: { hr?: boolean; salary?: boolean } = {}
): EmployeeDto {
  const dto: EmployeeDto = {
    id: employee.id,
    employeeCode: employee.employeeCode,
    firstName: employee.firstName,
    middleName: employee.middleName,
    lastName: employee.lastName,
    suffix: employee.suffix,
    // Assembled here so no caller has to, and so every screen shows the same
    // thing. The parts are still sent, for anything that needs them apart.
    name: formatEmployeeName(employee),
    // The whole row, not a code: a position renamed in the UI then reads
    // correctly everywhere without a second lookup.
    position: { id: employee.position.id, name: employee.position.name },
    branch: employee.branch ? { id: employee.branch.id, name: employee.branch.name } : null,
    // Only the identifying bits of the linked account — never the password hash.
    linkedUser: employee.user ? { id: employee.user.id, email: employee.user.email } : null,
    isActive: employee.isActive,
    createdAt: employee.createdAt.toISOString(),
    updatedAt: employee.updatedAt.toISOString(),
  }

  if (access.hr) {
    dto.hr = {
      birthDate: dateOnly(employee.birthDate),
      birthPlace: employee.birthPlace,
      gender: employee.gender as Gender | null,
      civilStatus: employee.civilStatus as CivilStatus | null,
      religion: employee.religion,
      email: employee.email,
      heightCm: employee.heightCm,
      weightGrams: employee.weightGrams,
      educationLevel: employee.educationLevel as EducationLevel | null,
      educationDetail: employee.educationDetail,
      remarks: employee.remarks,
      confidentialityAgreement: employee.confidentialityAgreement,
      confidentialityAgreementOn: dateOnly(employee.confidentialityAgreementOn),
      authorityToDeduct: employee.authorityToDeduct,
      authorityToDeductOn: dateOnly(employee.authorityToDeductOn),
      birthCertificate: employee.birthCertificate,
      birthCertificateOn: dateOnly(employee.birthCertificateOn),
      marriageContract: employee.marriageContract,
      marriageContractOn: dateOnly(employee.marriageContractOn),
      address: employee.address,
      contacts: [...(employee.contacts ?? [])]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(c => ({ id: c.id, number: c.number, label: c.label })),
      emergencyName: employee.emergencyName,
      emergencyRelation: employee.emergencyRelation,
      emergencyContact: employee.emergencyContact,
      sssNumber: employee.sssNumber,
      philhealthNumber: employee.philhealthNumber,
      pagibigNumber: employee.pagibigNumber,
      tin: employee.tin,
      dateHired: dateOnly(employee.dateHired),
      employmentType: employee.employmentType as EmploymentType,
      probationEndDate: dateOnly(employee.probationEndDate),
      probationExtendedTo: dateOnly(employee.probationExtendedTo),
      probationExtensionReason: employee.probationExtensionReason,
      regularizedAt: dateOnly(employee.regularizedAt),
      separatedAt: dateOnly(employee.separatedAt),
      separationReason: employee.separationReason,
      // Newest first: "have they worked here before" is answered by the most
      // recent spell, not the oldest.
      pastEmployment: [...(employee.pastEmployment ?? [])]
        .sort((a, b) => (a.hiredOn < b.hiredOn ? 1 : -1))
        .map(p => ({
          id: p.id,
          hiredOn: dateOnly(p.hiredOn)!,
          separatedOn: dateOnly(p.separatedOn)!,
          separationReason: p.separationReason,
          employmentType: p.employmentType as EmploymentType,
          regularizedAt: dateOnly(p.regularizedAt),
        })),
      payoutMethod: employee.payoutMethod as PayoutMethod,
      payoutAccount: employee.payoutAccount,
    }
  }

  if (access.salary && employee.salaries) {
    // Newest first: the current rate is what a reader wants, and history is
    // context below it.
    dto.salaryHistory = [...employee.salaries]
      .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))
      .map(s => ({
        id: s.id,
        basicCents: s.basicCents,
        allowanceCents: s.allowanceCents,
        rateType: s.rateType as SalaryRateType,
        effectiveFrom: dateOnly(s.effectiveFrom)!,
        note: s.note,
        recordedBy: s.recordedBy ? { id: s.recordedBy.id, name: s.recordedBy.name } : null,
        createdAt: s.createdAt.toISOString(),
      }))
  }

  return dto
}

/** Everything the DSIR serializers need loaded. */
export const dsirInclude = {
  branch: true,
  openedBy: true,
  closedBy: true,
  encodedBy: true,
  lines: { include: { product: { include: { category: true } } } },
  charges: { include: { product: true, employee: true } },
  transfers: { include: { product: true, toBranch: true } },
  collections: { include: { employee: true } },
} as const

type DsirWithRelations = Prisma.DsirReportGetPayload<{ include: typeof dsirInclude }>

/** Transfers sent TO this branch, on this date, by other branches. */
/**
 * Stock received from another branch, as this serializer needs it.
 *
 * Structural rather than a Prisma payload, because it has two sources: live rows
 * off the sending report while a report is a draft, and frozen rows off
 * DsirInboundSnapshot once it is finalised. Declaring the six fields actually
 * used lets both satisfy it without either pretending to be the other.
 */
export interface InboundTransfer {
  id: string
  productId: string
  product: { name: string }
  quantity: number
  report: { branchId: string; branch: { name: string } }
}

/**
 * Computes every derived figure from the SHARED formula, so the encoder's screen
 * and the server can never disagree about what a day's sales were.
 */
export function toDsirDto(
  report: DsirWithRelations,
  inbound: InboundTransfer[] = [],
  /** Openings inherited from the branch's previous finalised report. */
  carried: { balances: Map<string, number>; fromDate: string | null } = { balances: new Map(), fromDate: null }
): DsirReportDto {
  const chargedBy = new Map<string, number>()
  for (const c of report.charges) {
    chargedBy.set(c.productId, (chargedBy.get(c.productId) ?? 0) + c.quantity)
  }
  const transferredBy = new Map<string, number>()
  for (const t of report.transfers) {
    transferredBy.set(t.productId, (transferredBy.get(t.productId) ?? 0) + t.quantity)
  }
  const receivedBy = new Map<string, number>()
  for (const t of inbound) {
    receivedBy.set(t.productId, (receivedBy.get(t.productId) ?? 0) + t.quantity)
  }

  let salesCents = 0
  let pulledOutCents = 0
  let producedValueCents = 0
  let receivedValueCents = 0
  let overEndCents = 0
  let overEndUnits = 0

  const lines = report.lines.map(l => {
    const charged = chargedBy.get(l.productId) ?? 0
    const transferredOut = transferredBy.get(l.productId) ?? 0
    const transferredIn = receivedBy.get(l.productId) ?? 0
    const totals = computeLineTotals(
      {
        begBal: l.begBal,
        produced: l.produced,
        transferredIn,
        transferredOut,
        overEnd: l.overEnd,
        charged,
        pulledOut: l.pulledOut,
        endBal: l.endBal,
      },
      l.unitPriceCents
    )
    salesCents += totals.salesCents
    pulledOutCents += l.pulledOut * l.unitPriceCents
    producedValueCents += l.produced * l.unitPriceCents
    receivedValueCents += transferredIn * l.unitPriceCents
    overEndCents += l.overEnd * l.unitPriceCents
    overEndUnits += l.overEnd

    return {
      productId: l.productId,
      product: {
        id: l.product.id,
        name: l.product.name,
        sku: l.product.sku,
        unit: l.product.unit as string,
        category: { id: l.product.category.id, name: l.product.category.name },
      },
      unitPriceCents: l.unitPriceCents,
      begBal: l.begBal,
      begBalRecounted: l.begBalRecounted,
      // Stored as JSON; the shape is enforced by the Zod schema on the way in.
      enteredAs: (l.enteredAs as DsirLineDto['enteredAs']) ?? null,
      // Sent even when it matches, so the screen can show what a recount
      // replaced without asking for the previous report.
      carriedBegBal: carried.fromDate === null ? null : (carried.balances.get(l.productId) ?? 0),
      produced: l.produced,
      overEnd: l.overEnd,
      pulledOut: l.pulledOut,
      endBal: l.endBal,
      transferredIn,
      transferredOut,
      charged,
      ...totals,
    }
  })

  const priceOf = new Map(report.lines.map(l => [l.productId, l.unitPriceCents]))
  const charges = report.charges.map(c => ({
    id: c.id,
    productId: c.productId,
    productName: c.product.name,
    employeeId: c.employeeId,
    employeeName: formatEmployeeName(c.employee),
    quantity: c.quantity,
    // Charges are paid at full selling price, so the snapshot is the right basis.
    valueCents: c.quantity * (priceOf.get(c.productId) ?? c.product.priceCents),
  }))
  const chargedCents = charges.reduce((sum, c) => sum + c.valueCents, 0)
  const collectionsCents = report.collections.reduce((sum, c) => sum + c.amountCents, 0)

  return {
    id: report.id,
    branch: { id: report.branch.id, name: report.branch.name },
    reportDate: report.reportDate.toISOString().slice(0, 10),
    status: report.status as DsirStatus,
    carriedFromDate: carried.fromDate,
    usesCharges: report.usesCharges,
    usesPullOuts: report.usesPullOuts,
    usesTransfers: report.usesTransfers,
    usesOverEnd: report.usesOverEnd,
    openedBy: report.openedBy ? { id: report.openedBy.id, name: formatEmployeeName(report.openedBy) } : null,
    closedBy: report.closedBy ? { id: report.closedBy.id, name: formatEmployeeName(report.closedBy) } : null,
    encodedBy: report.encodedBy ? { id: report.encodedBy.id, name: report.encodedBy.name } : null,
    finalizedAt: report.finalizedAt?.toISOString() ?? null,
    notes: report.notes,
    lines,
    charges,
    transfers: report.transfers.map(t => ({
      id: t.id,
      productId: t.productId,
      productName: t.product.name,
      toBranchId: t.toBranchId,
      toBranchName: t.toBranch.name,
      quantity: t.quantity,
    })),
    inboundTransfers: inbound.map(t => ({
      id: t.id,
      productId: t.productId,
      productName: t.product.name,
      fromBranchId: t.report.branchId,
      fromBranchName: t.report.branch.name,
      quantity: t.quantity,
    })),
    collections: report.collections.map(c => ({
      id: c.id,
      employeeId: c.employeeId,
      employeeName: c.employee ? formatEmployeeName(c.employee) : null,
      label: c.label,
      amountCents: c.amountCents,
    })),
    salesCents,
    collectionsCents,
    varianceCents: collectionsCents - salesCents,
    pulledOutCents,
    chargedCents,
    producedValueCents,
    receivedValueCents,
    overEndCents,
    overEndUnits,
    lineCount: lines.length,
    updatedAt: report.updatedAt.toISOString(),
  }
}

export function toDsirSummary(report: DsirWithRelations, inbound: InboundTransfer[] = []): DsirSummaryDto {
  const full = toDsirDto(report, inbound)
  return {
    id: full.id,
    branch: full.branch,
    reportDate: full.reportDate,
    status: full.status,
    salesCents: full.salesCents,
    collectionsCents: full.collectionsCents,
    varianceCents: full.varianceCents,
    lineCount: full.lineCount,
    overEndCents: full.overEndCents,
    overEndUnits: full.overEndUnits,
    updatedAt: full.updatedAt,
  }
}

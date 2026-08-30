import { z } from 'zod'
import { currentlyEffective, deadlineStatus, effectiveOn, todayIso } from '../lib/effective-dated.js'

/**
 * Government paper a branch has to hold and keep current.
 *
 * Nearly all of these renew annually, and several are prerequisites for the
 * Mayor's Permit rather than independent of it — the Barangay Clearance and the
 * Fire Safety Inspection Certificate are needed before the Mayor's Permit can be
 * issued. That is why an expiry that has quietly passed matters: it can block
 * the renewal of something else months later.
 */
export const PERMIT_TYPES = [
  'MAYORS_PERMIT',
  'BARANGAY_CLEARANCE',
  'BIR_REGISTRATION',
  'SANITARY_PERMIT',
  'FIRE_SAFETY',
  'OCCUPANCY_PERMIT',
  'ZONING_CLEARANCE',
  'ENVIRONMENTAL',
  'OTHER',
] as const
export type PermitType = (typeof PERMIT_TYPES)[number]

export const PERMIT_TYPE_LABELS: Record<PermitType, string> = {
  MAYORS_PERMIT: "Mayor's Permit",
  BARANGAY_CLEARANCE: 'Barangay Clearance',
  BIR_REGISTRATION: 'BIR Registration (2303)',
  SANITARY_PERMIT: 'Sanitary Permit',
  FIRE_SAFETY: 'Fire Safety Certificate',
  OCCUPANCY_PERMIT: 'Occupancy Permit',
  ZONING_CLEARANCE: 'Zoning / Locational Clearance',
  ENVIRONMENTAL: 'Environmental Clearance',
  OTHER: 'Other',
}

/**
 * Which permits renew every year, for the "what needs doing" view.
 *
 * The Occupancy Permit is issued once for the premises and BIR registration does
 * not lapse on a date, so neither should nag. Everything else is annual.
 */
export const ANNUAL_PERMITS: readonly PermitType[] = [
  'MAYORS_PERMIT',
  'BARANGAY_CLEARANCE',
  'SANITARY_PERMIT',
  'FIRE_SAFETY',
  'ZONING_CLEARANCE',
  'ENVIRONMENTAL',
]

const dateOnly = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker')
  .nullable()
  .optional()

/** The lease. Every field optional — records get built up over time. */
export const updateBranchLeaseSchema = z.object({
  address: z.string().trim().max(300, 'Address is too long').nullable().optional(),
  lessorName: z.string().trim().max(120, 'Name is too long').nullable().optional(),
  lessorContact: z.string().trim().max(80, 'Contact is too long').nullable().optional(),
  lessorAddress: z.string().trim().max(300, 'Address is too long').nullable().optional(),
  contractStart: dateOnly,
  contractEnd: dateOnly,
  renewalNoticeDays: z
    .number()
    .int('Enter a whole number of days')
    .min(0, 'Cannot be negative')
    .max(365, 'More than a year of notice looks like a typo')
    .nullable()
    .optional(),
  depositCents: z.number().int().min(0, 'Cannot be negative').nullable().optional(),
  advanceCents: z.number().int().min(0, 'Cannot be negative').nullable().optional(),
})
export type UpdateBranchLeaseInput = z.infer<typeof updateBranchLeaseSchema>

export const createPermitSchema = z
  .object({
    type: z.enum(PERMIT_TYPES),
    label: z.string().trim().max(80, 'Label is too long').nullable().optional(),
    number: z.string().trim().max(60, 'Number is too long').nullable().optional(),
    issuedOn: dateOnly,
    expiresOn: dateOnly,
    authority: z.string().trim().max(120, 'Authority is too long').nullable().optional(),
    note: z.string().trim().max(300, 'Note is too long').nullable().optional(),
  })
  // An unlabelled "Other" is an unidentifiable row six months later.
  .refine(v => v.type !== 'OTHER' || Boolean(v.label?.trim()), {
    message: 'Name the permit when the type is Other',
    path: ['label'],
  })
export type CreatePermitInput = z.infer<typeof createPermitSchema>

export const updatePermitSchema = createPermitSchema
export type UpdatePermitInput = CreatePermitInput

/** One rent figure from a date onward. Centavos, as everywhere. */
export const createBranchRentSchema = z.object({
  amountCents: z.number().int('Enter a whole amount').positive('Rent must be more than zero'),
  effectiveFrom: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the date this rent starts'),
  note: z.string().trim().max(200, 'Note is too long').nullable().optional(),
})
export type CreateBranchRentInput = z.infer<typeof createBranchRentSchema>

export interface BranchPermitRecord {
  id: string
  type: PermitType
  label: string | null
  number: string | null
  issuedOn: string | null
  expiresOn: string | null
  authority: string | null
  note: string | null
}

export interface BranchRentRecord {
  id: string
  amountCents: number
  effectiveFrom: string
  note: string | null
  recordedBy: { id: string; name: string } | null
  createdAt: string
}

/** What to call a permit, honouring the free label on OTHER. */
export function permitName(permit: Pick<BranchPermitRecord, 'type' | 'label'>): string {
  if (permit.type === 'OTHER') return permit.label?.trim() || 'Other permit'
  return PERMIT_TYPE_LABELS[permit.type]
}

/**
 * Whether a permit needs renewing, and how urgently.
 *
 * Sixty days rather than the thirty used for probation: renewals here mean
 * queuing at a city office, often with another agency's certificate as a
 * prerequisite, and January is when every business in Davao is doing the same
 * thing. A month's warning is not enough time.
 *
 * A permit with no expiry recorded is not "fine", it is unknown — but it is also
 * not actionable, so it returns 'none' and the UI flags the missing date instead.
 */
export function permitStatus(
  permit: Pick<BranchPermitRecord, 'expiresOn'>,
  today: string = todayIso()
): { state: 'none' | 'due' | 'overdue'; daysLeft: number | null } {
  return deadlineStatus(permit.expiresOn, 60, today)
}

/** The rent applying on a date — see effectiveOn. */
export function rentOn(history: BranchRentRecord[], onDate: string): BranchRentRecord | null {
  return effectiveOn(history, onDate)
}

/** The rent in force today, or null if none has been recorded. */
export function currentRent(history: BranchRentRecord[]): BranchRentRecord | null {
  return currentlyEffective(history)
}

/**
 * The worst permit state across a branch, for a badge on the branch list.
 *
 * "Worst" because a list row has room for one signal, and an expired permit
 * matters more than five current ones.
 */
export function branchPermitStatus(
  permits: BranchPermitRecord[],
  today: string = todayIso()
): { state: 'none' | 'due' | 'overdue'; count: number } {
  let overdue = 0
  let due = 0
  for (const p of permits) {
    const { state } = permitStatus(p, today)
    if (state === 'overdue') overdue++
    else if (state === 'due') due++
  }
  if (overdue > 0) return { state: 'overdue', count: overdue }
  if (due > 0) return { state: 'due', count: due }
  return { state: 'none', count: 0 }
}

/**
 * Whether the lease needs attention.
 *
 * Uses the contract's own notice period rather than a fixed window: a lease
 * requiring 90 days' notice has to be acted on three months out, and the date
 * that matters is the deadline to give notice, not the end of the term.
 */
export function leaseStatus(
  lease: { contractEnd: string | null; renewalNoticeDays: number | null },
  today: string = todayIso()
): { state: 'none' | 'due' | 'overdue'; daysLeft: number | null } {
  return deadlineStatus(lease.contractEnd, lease.renewalNoticeDays ?? 60, today)
}

// ─── Utilities ──────────────────────────────────────────────────────────────

export const UTILITY_TYPES = ['ELECTRIC', 'WATER', 'INTERNET', 'OTHER'] as const
export type UtilityType = (typeof UTILITY_TYPES)[number]

export const UTILITY_TYPE_LABELS: Record<UtilityType, string> = {
  ELECTRIC: 'Electricity',
  WATER: 'Water',
  INTERNET: 'Internet',
  OTHER: 'Other',
}

/**
 * What a meter reading is measured in.
 *
 * Derived from the type rather than stored per bill: a kWh figure on a water
 * account is a data-entry error, not a variant worth supporting.
 */
export const CONSUMPTION_UNITS: Record<UtilityType, string | null> = {
  ELECTRIC: 'kWh',
  WATER: 'm³',
  INTERNET: null,
  OTHER: null,
}

export const createUtilityAccountSchema = z
  .object({
    type: z.enum(UTILITY_TYPES),
    label: z.string().trim().max(80, 'Label is too long').nullable().optional(),
    provider: z.string().trim().max(120, 'Provider is too long').nullable().optional(),
    accountNumber: z.string().trim().max(60, 'Account number is too long').nullable().optional(),
    meterNumber: z.string().trim().max(60, 'Meter number is too long').nullable().optional(),
    isActive: z.boolean().optional().default(true),
  })
  .refine(v => v.type !== 'OTHER' || Boolean(v.label?.trim()), {
    message: 'Name the utility when the type is Other',
    path: ['label'],
  })
export type CreateUtilityAccountInput = z.infer<typeof createUtilityAccountSchema>

export const createUtilityBillSchema = z
  .object({
    periodStart: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the start of the billing period'),
    periodEnd: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the end of the billing period'),
    amountCents: z.number().int('Enter a whole amount').positive('The amount must be more than zero'),
    dueDate: dateOnly,
    paidOn: dateOnly,
    // Zero is legitimate — a closed branch still gets a bill with no usage.
    consumption: z.number().int('Enter a whole number').min(0, 'Cannot be negative').nullable().optional(),
    referenceNo: z.string().trim().max(60, 'Reference is too long').nullable().optional(),
    note: z.string().trim().max(300, 'Note is too long').nullable().optional(),
  })
  .refine(v => v.periodStart <= v.periodEnd, {
    message: 'The period ends before it starts — check the dates',
    path: ['periodEnd'],
  })
export type CreateUtilityBillInput = z.infer<typeof createUtilityBillSchema>

export interface UtilityBillRecord {
  id: string
  periodStart: string
  periodEnd: string
  amountCents: number
  dueDate: string | null
  paidOn: string | null
  consumption: number | null
  referenceNo: string | null
  note: string | null
}

export interface UtilityAccountRecord {
  id: string
  type: UtilityType
  label: string | null
  provider: string | null
  accountNumber: string | null
  meterNumber: string | null
  isActive: boolean
  /** Newest period first. */
  bills: UtilityBillRecord[]
}

export function utilityName(a: Pick<UtilityAccountRecord, 'type' | 'label'>): string {
  if (a.type === 'OTHER') return a.label?.trim() || 'Other utility'
  return UTILITY_TYPE_LABELS[a.type]
}

/**
 * Where a bill stands.
 *
 * 'paid' once settled, regardless of whether it was late — the record of a late
 * payment is `paidOn` against `dueDate`, and nagging about a bill already paid
 * would train people to ignore the warnings.
 *
 * Seven days' notice: unlike a permit renewal this is one payment, and the
 * consequence of missing it (disconnection, reconnection fees, a branch that
 * cannot open) arrives quickly.
 */
export function billStatus(
  bill: Pick<UtilityBillRecord, 'dueDate' | 'paidOn'>,
  today: string = todayIso()
): { state: 'paid' | 'none' | 'due' | 'overdue'; daysLeft: number | null } {
  if (bill.paidOn) return { state: 'paid', daysLeft: null }
  const { state, daysLeft } = deadlineStatus(bill.dueDate, 7, today)
  return { state, daysLeft }
}

/**
 * Unpaid bills across a branch.
 *
 * Counts EVERY bill with no payment date, not only the ones past a due date. A
 * bill entered without a due date is still money owed, and an earlier version of
 * this skipped them — a ₱26,500 electricity bill sat unpaid while the badge
 * reported ₱3,400, because only the one with a due date was counted.
 *
 * `state` reports the worst urgency for colouring; `count` and `totalCents`
 * cover everything outstanding either way.
 */
export function unpaidSummary(
  accounts: UtilityAccountRecord[],
  today: string = todayIso()
): { state: 'none' | 'unpaid' | 'due' | 'overdue'; count: number; overdueCount: number; totalCents: number } {
  let overdueCount = 0
  let dueCount = 0
  let count = 0
  let totalCents = 0
  for (const a of accounts) {
    for (const b of a.bills) {
      const { state } = billStatus(b, today)
      if (state === 'paid') continue
      count++
      totalCents += b.amountCents
      if (state === 'overdue') overdueCount++
      else if (state === 'due') dueCount++
    }
  }
  if (count === 0) return { state: 'none', count: 0, overdueCount: 0, totalCents: 0 }
  if (overdueCount > 0) return { state: 'overdue', count, overdueCount, totalCents }
  if (dueCount > 0) return { state: 'due', count, overdueCount, totalCents }
  return { state: 'unpaid', count, overdueCount, totalCents }
}

/**
 * How this bill's consumption compares with the same period a year earlier.
 *
 * A year back rather than last month because usage is seasonal — a bakery uses
 * more power in the hot months, and comparing August with July would flag that
 * every year. What is worth seeing is August against last August: a jump with no
 * tariff change is a failing compressor, a leak, or a door left open.
 *
 * Null when there is nothing to compare against, which is the normal case for
 * the first year of records.
 */
export function consumptionChange(
  bills: UtilityBillRecord[],
  bill: UtilityBillRecord
): { percent: number; previous: number } | null {
  if (bill.consumption == null) return null
  const target = new Date(`${bill.periodStart}T00:00:00Z`)
  target.setUTCFullYear(target.getUTCFullYear() - 1)
  const wanted = target.toISOString().slice(0, 10)

  // Within a fortnight either side — billing periods drift by a few days.
  const MS_PER_DAY = 86_400_000
  const near = bills.filter(b => {
    if (b.id === bill.id || b.consumption == null) return false
    const gap = Math.abs(Date.parse(b.periodStart) - Date.parse(wanted)) / MS_PER_DAY
    return gap <= 14
  })
  if (near.length === 0) return null

  const previous = near[0].consumption!
  if (previous === 0) return null
  return { percent: Math.round(((bill.consumption - previous) / previous) * 100), previous }
}

import { z } from 'zod'
import { currentlyEffective, deadlineStatus, effectiveOn, todayIso } from '../lib/effective-dated.js'

/** Job role on the shop floor — distinct from Role, which governs system access. */
export const EMPLOYEE_POSITIONS = [
  'MANAGER',
  'BAKER',
  'FRONTLINER',
  'CASHIER',
  'HELPER',
  'DRIVER',
  'OTHER',
] as const
export type EmployeePosition = (typeof EMPLOYEE_POSITIONS)[number]

export const POSITION_LABELS: Record<EmployeePosition, string> = {
  MANAGER: 'Manager',
  BAKER: 'Baker',
  FRONTLINER: 'Frontliner',
  CASHIER: 'Cashier',
  HELPER: 'Helper',
  DRIVER: 'Driver',
  OTHER: 'Other',
}

/**
 * Names are stored in parts rather than as one string.
 *
 * Splitting a stored full name back into parts is guesswork, and it gets
 * Philippine names wrong in exactly the cases that matter: "Ethelredo Parajes
 * Jr" naively splits to a surname of "Jr", and a middle name (the mother's
 * maiden surname) is indistinguishable from a two-word given name. Payroll and
 * official documents need the parts separately, so they are captured separately.
 *
 * Only the given name and surname are required — plenty of records have no
 * middle name, and suffixes are rare.
 */
export const createEmployeeSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(60, 'First name is too long'),
  middleName: z.string().trim().max(60, 'Middle name is too long').nullable().optional(),
  lastName: z.string().trim().min(1, 'Surname is required').max(60, 'Surname is too long'),
  suffix: z.string().trim().max(20, 'Suffix is too long').nullable().optional(),
  // Optional and unique. Nullable-unique works in Postgres: many NULLs allowed.
  employeeCode: z
    .string()
    .trim()
    .max(30, 'Code is too long')
    .regex(/^[A-Za-z0-9_-]*$/, 'Use letters, numbers, hyphens and underscores only')
    .nullable()
    .optional(),
  position: z.enum(EMPLOYEE_POSITIONS).optional().default('OTHER'),
  // Current assignment only — staff transfer between branches and trading names.
  branchId: z.string().min(1).nullable().optional(),
  // Set only for the few staff who also hold an Otomate login.
  userId: z.string().min(1).nullable().optional(),
  isActive: z.boolean().optional().default(true),
})

export const updateEmployeeSchema = createEmployeeSchema.partial()

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>

export const CIVIL_STATUSES = ['SINGLE', 'MARRIED', 'WIDOWED', 'SEPARATED'] as const
export type CivilStatus = (typeof CIVIL_STATUSES)[number]

export const EMPLOYMENT_TYPES = ['PROBATIONARY', 'REGULAR', 'CONTRACTUAL', 'PART_TIME'] as const
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number]

export const SALARY_RATE_TYPES = ['DAILY', 'MONTHLY', 'HOURLY'] as const
export type SalaryRateType = (typeof SALARY_RATE_TYPES)[number]

export const PAYOUT_METHODS = ['CASH', 'BANK', 'EWALLET'] as const
export type PayoutMethod = (typeof PAYOUT_METHODS)[number]

export const CIVIL_STATUS_LABELS: Record<CivilStatus, string> = {
  SINGLE: 'Single', MARRIED: 'Married', WIDOWED: 'Widowed', SEPARATED: 'Separated',
}
export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  PROBATIONARY: 'Probationary', REGULAR: 'Regular', CONTRACTUAL: 'Contractual', PART_TIME: 'Part-time',
}
export const SALARY_RATE_LABELS: Record<SalaryRateType, string> = {
  DAILY: 'per day', MONTHLY: 'per month', HOURLY: 'per hour',
}
export const PAYOUT_METHOD_LABELS: Record<PayoutMethod, string> = {
  CASH: 'Cash', BANK: 'Bank transfer', EWALLET: 'E-wallet',
}

/** YYYY-MM-DD, the form the API exchanges dates in. Empty string means "not set". */
const dateOnly = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker')
  .nullable()
  .optional()

/**
 * Government IDs are stored as typed rather than normalised.
 *
 * SSS, PhilHealth, Pag-IBIG and TIN each have a conventional grouping
 * (34-1234567-8 and so on), but they are transcribed from physical cards where
 * the spacing varies, and the filings expect them to match the card. Validating
 * the shape would reject legitimate cards; a length cap is enough to catch a
 * finger on the keyboard.
 */
const govId = z.string().trim().max(30, 'That looks too long for an ID number').nullable().optional()

/**
 * One phone number. `label` is the network or where it reaches them — free text
 * rather than an enum, because networks come and go and people label a number
 * however they think of it.
 */
export const contactSchema = z.object({
  number: z.string().trim().min(1, 'Enter the number').max(40, 'That number is too long'),
  label: z.string().trim().max(30, 'Label is too long').nullable().optional(),
})
export type ContactInput = z.infer<typeof contactSchema>

/** Suggestions only — the field accepts anything. */
export const CONTACT_LABEL_SUGGESTIONS = ['Globe', 'Smart', 'DITO', 'TNT', 'Sun', 'Home'] as const

export interface EmployeeContactRecord {
  id: string
  number: string
  label: string | null
}

/** The 201 file. Every field optional: records are built up over time, not in one sitting. */
export const updateEmployeeHrSchema = z.object({
  birthDate: dateOnly,
  civilStatus: z.enum(CIVIL_STATUSES).nullable().optional(),
  address: z.string().trim().max(300, 'Address is too long').nullable().optional(),
  /**
   * Replaces the whole set when present. Omitted entirely, the existing numbers
   * are left alone — so a caller updating only an address cannot silently wipe
   * them.
   */
  contacts: z.array(contactSchema).max(5, 'That is a lot of phone numbers').optional(),
  emergencyName: z.string().trim().max(120, 'Name is too long').nullable().optional(),
  emergencyRelation: z.string().trim().max(60, 'Relationship is too long').nullable().optional(),
  emergencyContact: z.string().trim().max(40, 'Contact number is too long').nullable().optional(),

  sssNumber: govId,
  philhealthNumber: govId,
  pagibigNumber: govId,
  tin: govId,

  dateHired: dateOnly,
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  probationEndDate: dateOnly,
  regularizedAt: dateOnly,
  separatedAt: dateOnly,
  separationReason: z.string().trim().max(300, 'Reason is too long').nullable().optional(),

  payoutMethod: z.enum(PAYOUT_METHODS).optional(),
  payoutAccount: z.string().trim().max(80, 'Account is too long').nullable().optional(),
})
export type UpdateEmployeeHrInput = z.infer<typeof updateEmployeeHrSchema>

/**
 * One pay rate from a date onward.
 *
 * Amounts are in CENTAVOS, as everywhere else. Zero is allowed for allowance and
 * refused for basic: a rate of nothing is a data-entry slip, not a wage.
 */
export const createSalarySchema = z.object({
  basicCents: z.number().int('Enter a whole amount').positive('Basic pay must be more than zero'),
  allowanceCents: z.number().int('Enter a whole amount').min(0, 'Allowance cannot be negative').optional().default(0),
  rateType: z.enum(SALARY_RATE_TYPES).optional().default('DAILY'),
  effectiveFrom: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the date this rate starts'),
  note: z.string().trim().max(200, 'Note is too long').nullable().optional(),
})
export type CreateSalaryInput = z.infer<typeof createSalarySchema>

export interface EmployeeSalaryRecord {
  id: string
  basicCents: number
  allowanceCents: number
  rateType: SalaryRateType
  effectiveFrom: string
  note: string | null
  recordedBy: { id: string; name: string } | null
  createdAt: string
}

/** Which rate applied on a given date — see effectiveOn. */
export function salaryOn(
  history: EmployeeSalaryRecord[],
  onDate: string
): EmployeeSalaryRecord | null {
  return effectiveOn(history, onDate)
}

/** The rate in force today, or null if pay has never been set. */
export function currentSalary(history: EmployeeSalaryRecord[]): EmployeeSalaryRecord | null {
  return currentlyEffective(history)
}

/**
 * Whether a probation deadline needs attention, and how urgently.
 *
 * Probation caps at six months under the Labor Code: an employee not acted on by
 * the deadline becomes regular by operation of law, whether or not anyone
 * intended it. A date sitting unread in a field is exactly how that happens, so
 * the record carries its own warning.
 *
 * Only PROBATIONARY staff are considered — a regularised or separated record has
 * no deadline left to miss.
 */
export function probationStatus(
  employee: {
    employmentType: EmploymentType
    probationEndDate: string | null
    separatedAt: string | null
    isActive: boolean
  },
  today: string = new Date().toISOString().slice(0, 10)
): { state: 'none' | 'due' | 'overdue'; daysLeft: number | null } {
  const { employmentType, probationEndDate, separatedAt, isActive } = employee
  if (employmentType !== 'PROBATIONARY' || !probationEndDate || separatedAt || !isActive) {
    return { state: 'none', daysLeft: null }
  }
  const MS_PER_DAY = 86_400_000
  const daysLeft = Math.round((Date.parse(probationEndDate) - Date.parse(today)) / MS_PER_DAY)
  if (daysLeft < 0) return { state: 'overdue', daysLeft }
  // A month's notice is enough to hold the conversation and file the paperwork.
  if (daysLeft <= 30) return { state: 'due', daysLeft }
  return { state: 'none', daysLeft }
}

/** The four parts, as stored. */
export interface EmployeeName {
  firstName: string
  middleName?: string | null
  lastName: string
  suffix?: string | null
}

/**
 * Natural reading order: "Ethelredo Santos Parajes Jr."
 * Used wherever a person is named in a sentence or a picker.
 */
export function formatEmployeeName(n: EmployeeName): string {
  return [n.firstName, n.middleName, n.lastName, n.suffix]
    .map(part => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(' ')
}

/**
 * Filing order: "Parajes, Ethelredo S. Jr."
 * The middle name is reduced to an initial, which is how it appears on payroll
 * and government forms. Used for lists that are scanned rather than read.
 */
export function formatEmployeeNameFiled(n: EmployeeName): string {
  const initial = n.middleName?.trim() ? `${n.middleName.trim().charAt(0).toUpperCase()}.` : ''
  const given = [n.firstName.trim(), initial, n.suffix?.trim()].filter(Boolean).join(' ')
  return `${n.lastName.trim()}, ${given}`
}

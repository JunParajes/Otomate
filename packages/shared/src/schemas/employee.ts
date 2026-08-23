import { z } from 'zod'

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

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

export const createEmployeeSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120, 'Name is too long'),
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

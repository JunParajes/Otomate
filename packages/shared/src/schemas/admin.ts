import { z } from 'zod'
import { PERMISSION_NAMES } from '../permissions.js'

/**
 * Shared by the API routes and the Mantine admin forms, so client-side
 * validation and server-side validation can never disagree.
 */

const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')

const name = z.string().trim().min(1, 'Name is required').max(120, 'Name is too long')

/** Role names are used as identifiers, so keep them predictable. */
const roleName = z
  .string()
  .trim()
  .min(2, 'Role name must be at least 2 characters')
  .max(40, 'Role name is too long')
  .regex(/^[a-z0-9_]+$/, 'Use lowercase letters, numbers and underscores only')

const permissionNames = z
  .array(z.enum(PERMISSION_NAMES as unknown as [string, ...string[]]))
  .max(PERMISSION_NAMES.length)

// ─── Users ────────────────────────────────────────────────────────────────
export const createUserSchema = z.object({
  email: z.email('Enter a valid email address'),
  name,
  password,
  roleId: z.string().min(1, 'Select a role'),
  branchId: z.string().min(1).nullable().optional(),
  mustChangePassword: z.boolean().optional().default(true),
})

export const updateUserSchema = z.object({
  email: z.email('Enter a valid email address').optional(),
  name: name.optional(),
  roleId: z.string().min(1).optional(),
  branchId: z.string().min(1).nullable().optional(),
  isActive: z.boolean().optional(),
})

export const resetPasswordSchema = z.object({
  password,
  mustChangePassword: z.boolean().optional().default(true),
})

export const changeOwnPasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword: password,
})

// ─── Roles ────────────────────────────────────────────────────────────────
export const createRoleSchema = z.object({
  name: roleName,
  description: z.string().trim().max(200).nullable().optional(),
  permissions: permissionNames.default([]),
})

export const updateRoleSchema = z.object({
  name: roleName.optional(),
  description: z.string().trim().max(200).nullable().optional(),
  permissions: permissionNames.optional(),
})

/** Deleting a role requires somewhere for its users to go. */
export const deleteRoleSchema = z.object({
  reassignToRoleId: z.string().min(1).optional(),
})

// ─── Branches ─────────────────────────────────────────────────────────────
/**
 * The short form shown in a work-schedule cell.
 *
 * Capped hard at six characters: the grid cell it has to fit is under a hundred
 * pixels wide, and an abbreviation that needs truncating is not an abbreviation.
 * Letters and digits only — "Km11", "TRD", "Pan".
 */
const abbreviation = z
  .string()
  .trim()
  .min(1, 'Give it at least one character')
  .max(6, 'Six characters at most — it has to fit a schedule cell')
  .regex(/^[A-Za-z0-9]+$/, 'Letters and numbers only')
  .nullable()
  .optional()

export const createBranchSchema = z.object({
  name: name,
  abbreviation,
  isActive: z.boolean().optional().default(true),
})

export const updateBranchSchema = z.object({
  name: name.optional(),
  abbreviation,
  isActive: z.boolean().optional(),
})

export type CreateUserInput = z.infer<typeof createUserSchema>
export type UpdateUserInput = z.infer<typeof updateUserSchema>
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>
export type ChangeOwnPasswordInput = z.infer<typeof changeOwnPasswordSchema>
export type CreateRoleInput = z.infer<typeof createRoleSchema>
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>
export type DeleteRoleInput = z.infer<typeof deleteRoleSchema>
export type CreateBranchInput = z.infer<typeof createBranchSchema>
export type UpdateBranchInput = z.infer<typeof updateBranchSchema>

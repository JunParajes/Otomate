import { z } from 'zod'

/**
 * Shared by the API routes and the Mantine catalogue forms.
 * All money crosses the wire as INTEGER CENTAVOS.
 */

export const PRODUCT_UNITS = ['PIECE', 'PACK', 'KILO', 'TRAY', 'BOX'] as const
export type ProductUnit = (typeof PRODUCT_UNITS)[number]

const name = z.string().trim().min(1, 'Name is required').max(120, 'Name is too long')
const description = z.string().trim().max(500, 'Description is too long').nullable().optional()

// A price of ₱0 is legal (giveaways, samples); negative is not. The ceiling is
// ₱10,000,000.00 — high enough for any bakery item, low enough to catch a
// misplaced decimal before it reaches the database.
const money = z
  .int('Enter a valid amount')
  .min(0, 'Cannot be negative')
  .max(1_000_000_000, 'That price looks wrong — check the decimal point')

export const createCategorySchema = z.object({
  name,
  description,
  isActive: z.boolean().optional().default(true),
  sortOrder: z.int().min(0).max(9999).optional().default(0),
})

export const updateCategorySchema = createCategorySchema.partial()

export const createProductSchema = z.object({
  name,
  sku: z
    .string()
    .trim()
    .max(40, 'Code is too long')
    .regex(/^[A-Za-z0-9_-]*$/, 'Use letters, numbers, hyphens and underscores only')
    .nullable()
    .optional(),
  description,
  categoryId: z.string().min(1, 'Select a category'),
  priceCents: money,
  costCents: money.nullable().optional(),
  unit: z.enum(PRODUCT_UNITS).optional().default('PIECE'),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.int().min(0).max(9999).optional().default(0),
})

export const updateProductSchema = createProductSchema.partial()

export type CreateCategoryInput = z.infer<typeof createCategorySchema>
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>
export type CreateProductInput = z.infer<typeof createProductSchema>
export type UpdateProductInput = z.infer<typeof updateProductSchema>

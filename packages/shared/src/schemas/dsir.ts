import { z } from 'zod'

/** Counts are whole units and never negative. */
const qty = z.int('Enter a whole number').min(0, 'Cannot be negative').max(1_000_000, 'That looks too large')

export const DSIR_STATUSES = ['DRAFT', 'FINALIZED'] as const
export type DsirStatus = (typeof DSIR_STATUSES)[number]

export const dsirLineSchema = z.object({
  productId: z.string().min(1),
  begBal: qty.optional().default(0),
  /**
   * True when the opening is the opener's own recount rather than the figure
   * carried from the previous finalised report. While false the server ignores
   * whatever begBal is sent and uses the carry, so the lock cannot be bypassed
   * by posting straight to the API.
   */
  begBalRecounted: z.boolean().optional().default(false),
  /**
   * How each figure was counted, for the ones that were counted rather than
   * typed. Keys are the quantity fields; an absent key means the figure was
   * entered as a plain number and there is nothing to explain.
   */
  enteredAs: z
    .object({
      begBal: z.string().max(80).optional(),
      produced: z.string().max(80).optional(),
      overEnd: z.string().max(80).optional(),
      pulledOut: z.string().max(80).optional(),
      endBal: z.string().max(80).optional(),
    })
    .nullable()
    .optional(),
  produced: qty.optional().default(0),
  overEnd: qty.optional().default(0),
  pulledOut: qty.optional().default(0),
  endBal: qty.optional().default(0),
})

export const dsirChargeSchema = z.object({
  productId: z.string().min(1, 'Select a product'),
  employeeId: z.string().min(1, 'Select who is charged'),
  quantity: qty.min(1, 'Quantity must be at least 1'),
})

export const dsirTransferSchema = z.object({
  productId: z.string().min(1, 'Select a product'),
  toBranchId: z.string().min(1, 'Select the destination branch'),
  quantity: qty.min(1, 'Quantity must be at least 1'),
})

export const dsirCollectionSchema = z
  .object({
    employeeId: z.string().min(1).nullable().optional(),
    label: z.string().trim().max(60).nullable().optional(),
    amountCents: z.int().min(0, 'Cannot be negative').max(1_000_000_000),
  })
  // A collection row must identify who turned the cash in, one way or the other.
  .refine(v => Boolean(v.employeeId) || Boolean(v.label?.trim()), {
    message: 'Choose a cashier, or type a label',
    path: ['employeeId'],
  })

export const createDsirSchema = z.object({
  branchId: z.string().min(1, 'Select a branch'),
  /** Back-dated entry is normal — forms reach HQ days late. */
  reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
})

/** The whole document. Saving replaces lines, charges, transfers and collections. */
export const saveDsirSchema = z.object({
  usesCharges: z.boolean().optional().default(false),
  usesPullOuts: z.boolean().optional().default(false),
  usesTransfers: z.boolean().optional().default(false),
  usesOverEnd: z.boolean().optional().default(false),
  openedById: z.string().min(1).nullable().optional(),
  closedById: z.string().min(1).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  lines: z.array(dsirLineSchema).max(500),
  charges: z.array(dsirChargeSchema).max(200).optional().default([]),
  transfers: z.array(dsirTransferSchema).max(200).optional().default([]),
  collections: z.array(dsirCollectionSchema).max(20).optional().default([]),
})

export type DsirLineInput = z.infer<typeof dsirLineSchema>
export type DsirChargeInput = z.infer<typeof dsirChargeSchema>
export type DsirTransferInput = z.infer<typeof dsirTransferSchema>
export type DsirCollectionInput = z.infer<typeof dsirCollectionSchema>
export type CreateDsirInput = z.infer<typeof createDsirSchema>
export type SaveDsirInput = z.infer<typeof saveDsirSchema>

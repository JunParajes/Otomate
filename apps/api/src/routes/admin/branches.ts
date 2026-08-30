import { Router, type Request } from 'express'
import {
  createBranchSchema, updateBranchSchema, updateBranchLeaseSchema,
  createPermitSchema, updatePermitSchema, createBranchRentSchema,
} from '@otomate/shared'
import { prisma } from '../../prisma/client'
import { can, requirePermission } from '../../middleware/auth'
import { asyncHandler } from '../../middleware/async-handler'
import { HttpError } from '../../middleware/error-handler'
import { firstIssue, pathParam } from '../../lib/http'
import { toBranchDto } from '../../lib/serializers'
import { rethrowUniqueViolation } from './guards'

const router = Router()

/** What this caller may see of a branch record. */
function access(req: Request) {
  return { permits: can(req, 'branches:permits:read'), lease: can(req, 'branches:lease:read') }
}

/**
 * The LIST carries permits but never the lease.
 *
 * Permits are what the list is for — a branch whose Mayor's Permit lapsed needs
 * to be visible without opening it, and a branch holds a handful of them, not a
 * history. Rent and lessor terms are commercial, belong to one screen, and are
 * fetched with the record that is actually being looked at.
 */
function listAccess(req: Request) {
  return { permits: can(req, 'branches:permits:read'), lease: false }
}

/** '' and undefined both mean "not set". */
function cleanDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined
  const trimmed = value?.trim()
  return trimmed ? new Date(`${trimmed}T00:00:00.000Z`) : null
}

function cleanText(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

async function branchOr404(id: string) {
  const branch = await prisma.branch.findUnique({ where: { id } })
  if (!branch) throw new HttpError(404, 'Branch not found', 'NOT_FOUND')
  return branch
}

/** Re-reads a branch with everything the caller is allowed to see. */
async function reload(req: Request, id: string) {
  const branch = await prisma.branch.findUniqueOrThrow({
    where: { id },
    include: {
      permits: true,
      rents: { include: { recordedBy: true } },
    },
  })
  return toBranchDto(branch, access(req))
}


router.get(
  '/',
  requirePermission('branches:read'),
  asyncHandler(async (req, res) => {
    const branches = await prisma.branch.findMany({
      include: {
        _count: { select: { users: true } },
        ...(can(req, 'branches:permits:read') ? { permits: true } : {}),
      },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    })
    res.json({
      data: branches.map(b => ({ ...toBranchDto(b, listAccess(req)), userCount: b._count.users })),
      error: null,
    })
  })
)

router.post(
  '/',
  requirePermission('branches:write'),
  asyncHandler(async (req, res) => {
    const parsed = createBranchSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed.error), 'VALIDATION_ERROR')
    try {
      const branch = await prisma.branch.create({ data: parsed.data })
      res.status(201).json({ data: { ...toBranchDto(branch), userCount: 0 }, error: null })
    } catch (error) {
      rethrowUniqueViolation(error, 'name', 'A branch with that name already exists')
    }
  })
)

router.patch(
  '/:id',
  requirePermission('branches:write'),
  asyncHandler(async (req, res) => {
    const parsed = updateBranchSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed.error), 'VALIDATION_ERROR')

    const existing = await prisma.branch.findUnique({ where: { id: pathParam(req, 'id') } })
    if (!existing) throw new HttpError(404, 'Branch not found', 'NOT_FOUND')

    try {
      const branch = await prisma.branch.update({
        where: { id: existing.id },
        data: parsed.data,
        include: { _count: { select: { users: true } } },
      })
      res.json({ data: { ...toBranchDto(branch), userCount: branch._count.users }, error: null })
    } catch (error) {
      rethrowUniqueViolation(error, 'name', 'A branch with that name already exists')
    }
  })
)

/**
 * Branch.branchId is ON DELETE SET NULL, so deleting would silently unassign
 * every user. Refuse instead and let the caller move them deliberately.
 */
router.delete(
  '/:id',
  requirePermission('branches:write'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.branch.findUnique({
      where: { id: pathParam(req, 'id') },
      include: { _count: { select: { users: true } } },
    })
    if (!existing) throw new HttpError(404, 'Branch not found', 'NOT_FOUND')

    if (existing._count.users > 0) {
      throw new HttpError(
        409,
        `${existing._count.users} user(s) are assigned to this branch. Reassign them, or deactivate the branch instead.`,
        'BRANCH_IN_USE'
      )
    }

    await prisma.branch.delete({ where: { id: existing.id } })
    res.json({ data: { success: true }, error: null })
  })
)

/** One branch, with permits and — for those allowed — the lease and rent history. */
router.get(
  '/:id',
  requirePermission('branches:read'),
  asyncHandler(async (req, res) => {
    await branchOr404(pathParam(req, 'id'))
    res.json({ data: await reload(req, pathParam(req, 'id')), error: null })
  })
)

/** The lease. Separate from PATCH /:id so branches:write cannot reach rent terms. */
router.patch(
  '/:id/lease',
  requirePermission('branches:lease:write'),
  asyncHandler(async (req, res) => {
    const parsed = updateBranchLeaseSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed.error), 'VALIDATION_ERROR')
    const branch = await branchOr404(pathParam(req, 'id'))
    const d = parsed.data

    // A contract that ends before it starts is a transposed pair of dates, and
    // it would make every renewal warning nonsense.
    const start = d.contractStart !== undefined ? cleanDate(d.contractStart) : branch.contractStart
    const end = d.contractEnd !== undefined ? cleanDate(d.contractEnd) : branch.contractEnd
    if (start && end && start > end) {
      throw new HttpError(400, 'The contract ends before it starts — check the dates', 'VALIDATION_ERROR')
    }

    await prisma.branch.update({
      where: { id: branch.id },
      data: {
        ...(d.address !== undefined && { address: cleanText(d.address) ?? null }),
        ...(d.lessorName !== undefined && { lessorName: cleanText(d.lessorName) ?? null }),
        ...(d.lessorContact !== undefined && { lessorContact: cleanText(d.lessorContact) ?? null }),
        ...(d.lessorAddress !== undefined && { lessorAddress: cleanText(d.lessorAddress) ?? null }),
        ...(d.contractStart !== undefined && { contractStart: cleanDate(d.contractStart) }),
        ...(d.contractEnd !== undefined && { contractEnd: cleanDate(d.contractEnd) }),
        ...(d.renewalNoticeDays !== undefined && { renewalNoticeDays: d.renewalNoticeDays }),
        ...(d.depositCents !== undefined && { depositCents: d.depositCents }),
        ...(d.advanceCents !== undefined && { advanceCents: d.advanceCents }),
      },
    })
    res.json({ data: await reload(req, branch.id), error: null })
  })
)

router.post(
  '/:id/permits',
  requirePermission('branches:permits:write'),
  asyncHandler(async (req, res) => {
    const parsed = createPermitSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed.error), 'VALIDATION_ERROR')
    const branch = await branchOr404(pathParam(req, 'id'))
    const d = parsed.data

    await prisma.branchPermit.create({
      data: {
        branchId: branch.id,
        type: d.type,
        // The free label only means anything on OTHER; storing it elsewhere
        // would leave a stale name behind if the type were later corrected.
        label: d.type === 'OTHER' ? (cleanText(d.label) ?? null) : null,
        number: cleanText(d.number) ?? null,
        issuedOn: cleanDate(d.issuedOn) ?? null,
        expiresOn: cleanDate(d.expiresOn) ?? null,
        authority: cleanText(d.authority) ?? null,
        note: cleanText(d.note) ?? null,
      },
    })
    res.status(201).json({ data: await reload(req, branch.id), error: null })
  })
)

/**
 * Edits a permit in place — used for renewals, which is the common case: the
 * same permit comes back with a new number and a new expiry.
 */
router.patch(
  '/:id/permits/:permitId',
  requirePermission('branches:permits:write'),
  asyncHandler(async (req, res) => {
    const parsed = updatePermitSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed.error), 'VALIDATION_ERROR')
    const permitId = pathParam(req, 'permitId')
    const existing = await prisma.branchPermit.findUnique({ where: { id: permitId } })
    if (!existing || existing.branchId !== pathParam(req, 'id')) {
      throw new HttpError(404, 'Permit not found', 'NOT_FOUND')
    }
    const d = parsed.data

    await prisma.branchPermit.update({
      where: { id: permitId },
      data: {
        type: d.type,
        label: d.type === 'OTHER' ? (cleanText(d.label) ?? null) : null,
        number: cleanText(d.number) ?? null,
        issuedOn: cleanDate(d.issuedOn) ?? null,
        expiresOn: cleanDate(d.expiresOn) ?? null,
        authority: cleanText(d.authority) ?? null,
        note: cleanText(d.note) ?? null,
      },
    })
    res.json({ data: await reload(req, existing.branchId), error: null })
  })
)

router.delete(
  '/:id/permits/:permitId',
  requirePermission('branches:permits:write'),
  asyncHandler(async (req, res) => {
    const permitId = pathParam(req, 'permitId')
    const existing = await prisma.branchPermit.findUnique({ where: { id: permitId } })
    if (!existing || existing.branchId !== pathParam(req, 'id')) {
      throw new HttpError(404, 'Permit not found', 'NOT_FOUND')
    }
    await prisma.branchPermit.delete({ where: { id: permitId } })
    res.json({ data: await reload(req, existing.branchId), error: null })
  })
)

/**
 * Records rent from a date onward.
 *
 * Upsert on (branch, effectiveFrom): re-entering a date corrects that figure
 * rather than adding a rival for the same day. Older rows are never touched —
 * that is the point of keeping history.
 */
router.post(
  '/:id/rent',
  requirePermission('branches:lease:write'),
  asyncHandler(async (req, res) => {
    const parsed = createBranchRentSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed.error), 'VALIDATION_ERROR')
    const branch = await branchOr404(pathParam(req, 'id'))

    const effectiveFrom = new Date(`${parsed.data.effectiveFrom}T00:00:00.000Z`)
    const fields = {
      amountCents: parsed.data.amountCents,
      note: cleanText(parsed.data.note) ?? null,
      recordedById: req.auth?.userId ?? null,
    }
    await prisma.branchRent.upsert({
      where: { branchId_effectiveFrom: { branchId: branch.id, effectiveFrom } },
      create: { branchId: branch.id, effectiveFrom, ...fields },
      update: fields,
    })
    res.status(201).json({ data: await reload(req, branch.id), error: null })
  })
)

/** For a figure entered against the wrong date or branch — a mistake, not a fact. */
router.delete(
  '/:id/rent/:rentId',
  requirePermission('branches:lease:write'),
  asyncHandler(async (req, res) => {
    const rentId = pathParam(req, 'rentId')
    const existing = await prisma.branchRent.findUnique({ where: { id: rentId } })
    if (!existing || existing.branchId !== pathParam(req, 'id')) {
      throw new HttpError(404, 'Rent record not found', 'NOT_FOUND')
    }
    await prisma.branchRent.delete({ where: { id: rentId } })
    res.json({ data: await reload(req, existing.branchId), error: null })
  })
)

export default router

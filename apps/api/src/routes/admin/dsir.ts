import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { createDsirSchema, saveDsirSchema } from '@otomate/shared'
import { prisma } from '../../prisma/client'
import { requirePermission } from '../../middleware/auth'
import { asyncHandler } from '../../middleware/async-handler'
import { HttpError } from '../../middleware/error-handler'
import { firstIssue, pathParam } from '../../lib/http'
import { dsirInclude, toDsirDto, toDsirSummary } from '../../lib/serializers'

const router = Router()

/** How far back to look for the products a branch actually carries. */
const PREFILL_LOOKBACK_REPORTS = 7

function parseDate(value: string): Date {
  // Stored as a DATE; anchor at UTC midnight so no timezone can shift the day.
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, 'Invalid date', 'VALIDATION_ERROR')
  }
  return date
}

async function loadOr404(id: string) {
  const report = await prisma.dsirReport.findUnique({ where: { id }, include: dsirInclude })
  if (!report) throw new HttpError(404, 'Report not found', 'NOT_FOUND')
  return report
}

/**
 * Stock other branches sent TO this one on this date.
 *
 * Read live rather than stored, so a receiving branch encoded before the sending
 * branch's report simply picks the transfer up once that report is entered —
 * forms arrive in batches and the encoding order is arbitrary.
 */
async function loadInbound(branchId: string, reportDate: Date) {
  return prisma.dsirTransfer.findMany({
    where: { toBranchId: branchId, report: { reportDate } },
    include: { product: true, report: { include: { branch: true } } },
  })
}

function assertEditable(report: { status: string }): void {
  if (report.status === 'FINALIZED') {
    throw new HttpError(
      409,
      'This report is finalised. Reopen it before making changes.',
      'REPORT_FINALIZED'
    )
  }
}

/**
 * Seeds a new report with the products this branch actually carries.
 *
 * Deliberately NOT "products that had stock yesterday": measured against a real
 * sheet, 15 of 52 active products had no beginning balance but were produced
 * that day — the daily bakes that always sell out. That rule silently drops the
 * highest-volume lines. See docs/DOMAIN.md.
 */
async function prefillLines(branchId: string, reportDate: Date) {
  const history = await prisma.dsirReport.findMany({
    where: { branchId, reportDate: { lt: reportDate } },
    orderBy: { reportDate: 'desc' },
    take: PREFILL_LOOKBACK_REPORTS,
    include: { lines: { select: { productId: true, endBal: true } } },
  })

  // Products arriving from another branch today must have a line, even with no
  // history: a branch that only ever RECEIVES cakes has never "carried" them.
  const inboundProductIds = [
    ...new Set(
      (
        await prisma.dsirTransfer.findMany({
          where: { toBranchId: branchId, report: { reportDate } },
          select: { productId: true },
        })
      ).map(t => t.productId)
    ),
  ]

  if (history.length === 0 && inboundProductIds.length === 0) return []

  // Carry yesterday's closing figure forward. Zero is a real value — a product
  // that sold out closes at 0 and legitimately opens at 0.
  const previous = history[0]
  const closingBalance = new Map((previous?.lines ?? []).map(l => [l.productId, l.endBal]))

  const productIds = [
    ...new Set([...history.flatMap(r => r.lines.map(l => l.productId)), ...inboundProductIds]),
  ]
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, priceCents: true, sortOrder: true, name: true },
  })
  products.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))

  return products.map(p => ({
    productId: p.id,
    unitPriceCents: p.priceCents,
    begBal: closingBalance.get(p.id) ?? 0,
    produced: 0,
    overEnd: 0,
    pulledOut: 0,
    endBal: 0,
  }))
}

router.get(
  '/',
  requirePermission('dsir:read'),
  asyncHandler(async (req, res) => {
    const { branchId, from, to, status } = req.query
    const where: Prisma.DsirReportWhereInput = {}
    if (typeof branchId === 'string' && branchId) where.branchId = branchId
    if (status === 'DRAFT' || status === 'FINALIZED') where.status = status
    if (typeof from === 'string' && from) where.reportDate = { gte: parseDate(from) }
    if (typeof to === 'string' && to) {
      where.reportDate = { ...(where.reportDate as object), lte: parseDate(to) }
    }

    const reports = await prisma.dsirReport.findMany({
      where,
      include: dsirInclude,
      orderBy: [{ reportDate: 'desc' }, { branchId: 'asc' }],
      take: 200,
    })

    // Batch-load inbound for the whole page: a receiving branch's sales are
    // wrong without it, and one query beats N.
    const inboundRows = await prisma.dsirTransfer.findMany({
      where: {
        toBranchId: { in: [...new Set(reports.map(r => r.branchId))] },
        report: { reportDate: { in: [...new Set(reports.map(r => r.reportDate.getTime()))].map(t => new Date(t)) } },
      },
      include: { product: true, report: { include: { branch: true } } },
    })
    const inboundByReport = new Map<string, typeof inboundRows>()
    for (const r of reports) {
      inboundByReport.set(
        r.id,
        inboundRows.filter(
          t => t.toBranchId === r.branchId && t.report.reportDate.getTime() === r.reportDate.getTime()
        )
      )
    }
    res.json({ data: reports.map(r => toDsirSummary(r, inboundByReport.get(r.id) ?? [])), error: null })
  })
)

router.get(
  '/:id',
  requirePermission('dsir:read'),
  asyncHandler(async (req, res) => {
    const report = await loadOr404(pathParam(req, 'id'))
    const inbound = await loadInbound(report.branchId, report.reportDate)
    res.json({ data: toDsirDto(report, inbound), error: null })
  })
)

router.post(
  '/',
  requirePermission('dsir:write'),
  asyncHandler(async (req, res) => {
    const parsed = createDsirSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed.error), 'VALIDATION_ERROR')

    const reportDate = parseDate(parsed.data.reportDate)
    const branch = await prisma.branch.findUnique({ where: { id: parsed.data.branchId } })
    if (!branch) throw new HttpError(400, 'Selected branch does not exist', 'VALIDATION_ERROR')

    const existing = await prisma.dsirReport.findUnique({
      where: { branchId_reportDate: { branchId: branch.id, reportDate } },
    })
    if (existing) {
      throw new HttpError(
        409,
        `A report for ${branch.name} on ${parsed.data.reportDate} already exists`,
        'DUPLICATE'
      )
    }

    const lines = await prefillLines(branch.id, reportDate)
    const report = await prisma.dsirReport.create({
      data: {
        branchId: branch.id,
        reportDate,
        encodedById: req.auth!.userId,
        lines: { create: lines },
      },
      include: dsirInclude,
    })
    res.status(201).json({
      data: toDsirDto(report, await loadInbound(branch.id, reportDate)),
      error: null,
    })
  })
)

/**
 * Saves the whole document. Lines, charges, transfers and collections are
 * replaced atomically — a half-saved DSIR would produce a wrong sales figure,
 * and wrong sales figures come out of someone's wages.
 */
router.put(
  '/:id',
  requirePermission('dsir:write'),
  asyncHandler(async (req, res) => {
    const parsed = saveDsirSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed.error), 'VALIDATION_ERROR')
    const input = parsed.data

    const report = await loadOr404(pathParam(req, 'id'))
    assertEditable(report)

    // Every referenced record must exist, checked before we touch anything.
    const productIds = [
      ...new Set([
        ...input.lines.map(l => l.productId),
        ...input.charges.map(c => c.productId),
        ...input.transfers.map(t => t.productId),
      ]),
    ]
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, priceCents: true },
    })
    if (products.length !== productIds.length) {
      throw new HttpError(400, 'One or more products no longer exist', 'VALIDATION_ERROR')
    }

    const employeeIds = [
      ...new Set([
        ...input.charges.map(c => c.employeeId),
        ...input.collections.map(c => c.employeeId).filter((v): v is string => Boolean(v)),
        ...[input.openedById, input.closedById].filter((v): v is string => Boolean(v)),
      ]),
    ]
    if (employeeIds.length > 0) {
      const found = await prisma.employee.count({ where: { id: { in: employeeIds } } })
      if (found !== employeeIds.length) {
        throw new HttpError(400, 'One or more employees no longer exist', 'VALIDATION_ERROR')
      }
    }

    const branchIds = [...new Set(input.transfers.map(t => t.toBranchId))]
    if (branchIds.length > 0) {
      const found = await prisma.branch.count({ where: { id: { in: branchIds } } })
      if (found !== branchIds.length) {
        throw new HttpError(400, 'One or more destination branches no longer exist', 'VALIDATION_ERROR')
      }
    }
    if (branchIds.includes(report.branchId)) {
      throw new HttpError(400, 'A branch cannot transfer stock to itself', 'VALIDATION_ERROR')
    }

    // Keep the price already snapshotted on a line; only price NEW lines at the
    // product's current price. Re-saving a draft must never re-price it.
    const existingPrice = new Map(report.lines.map(l => [l.productId, l.unitPriceCents]))
    const currentPrice = new Map(products.map(p => [p.id, p.priceCents]))

    await prisma.$transaction([
      prisma.dsirLine.deleteMany({ where: { reportId: report.id } }),
      prisma.dsirCharge.deleteMany({ where: { reportId: report.id } }),
      prisma.dsirTransfer.deleteMany({ where: { reportId: report.id } }),
      prisma.dsirCollection.deleteMany({ where: { reportId: report.id } }),
      prisma.dsirLine.createMany({
        data: input.lines.map(l => ({
          reportId: report.id,
          productId: l.productId,
          unitPriceCents: existingPrice.get(l.productId) ?? currentPrice.get(l.productId) ?? 0,
          begBal: l.begBal,
          produced: l.produced,
          overEnd: l.overEnd,
          pulledOut: l.pulledOut,
          endBal: l.endBal,
        })),
      }),
      prisma.dsirCharge.createMany({
        data: input.charges.map(c => ({ reportId: report.id, ...c })),
      }),
      prisma.dsirTransfer.createMany({
        data: input.transfers.map(t => ({ reportId: report.id, ...t })),
      }),
      prisma.dsirCollection.createMany({
        data: input.collections.map(c => ({
          reportId: report.id,
          employeeId: c.employeeId ?? null,
          label: c.label ?? null,
          amountCents: c.amountCents,
        })),
      }),
      prisma.dsirReport.update({
        where: { id: report.id },
        data: {
          usesCharges: input.usesCharges,
          usesPullOuts: input.usesPullOuts,
          usesTransfers: input.usesTransfers,
          usesOverEnd: input.usesOverEnd,
          openedById: input.openedById ?? null,
          closedById: input.closedById ?? null,
          notes: input.notes ?? null,
          encodedById: req.auth!.userId,
        },
      }),
    ])

    const saved = await loadOr404(report.id)
    res.json({ data: toDsirDto(saved, await loadInbound(saved.branchId, saved.reportDate)), error: null })
  })
)

router.post(
  '/:id/finalize',
  requirePermission('dsir:finalize'),
  asyncHandler(async (req, res) => {
    const report = await loadOr404(pathParam(req, 'id'))
    if (report.status === 'FINALIZED') {
      throw new HttpError(409, 'This report is already finalised', 'ALREADY_FINALIZED')
    }
    if (report.lines.length === 0) {
      throw new HttpError(400, 'Cannot finalise a report with no products', 'EMPTY_REPORT')
    }
    await prisma.dsirReport.update({
      where: { id: report.id },
      data: { status: 'FINALIZED', finalizedAt: new Date() },
    })
    const saved = await loadOr404(report.id)
    res.json({ data: toDsirDto(saved, await loadInbound(saved.branchId, saved.reportDate)), error: null })
  })
)

router.post(
  '/:id/reopen',
  requirePermission('dsir:finalize'),
  asyncHandler(async (req, res) => {
    const report = await loadOr404(pathParam(req, 'id'))
    if (report.status !== 'FINALIZED') {
      throw new HttpError(409, 'This report is not finalised', 'NOT_FINALIZED')
    }
    await prisma.dsirReport.update({
      where: { id: report.id },
      data: { status: 'DRAFT', finalizedAt: null },
    })
    const saved = await loadOr404(report.id)
    res.json({ data: toDsirDto(saved, await loadInbound(saved.branchId, saved.reportDate)), error: null })
  })
)

/** Drafts only — a finalised report is a record and must not vanish. */
router.delete(
  '/:id',
  requirePermission('dsir:write'),
  asyncHandler(async (req, res) => {
    const report = await loadOr404(pathParam(req, 'id'))
    if (report.status === 'FINALIZED') {
      throw new HttpError(409, 'Finalised reports cannot be deleted. Reopen it first.', 'REPORT_FINALIZED')
    }
    await prisma.dsirReport.delete({ where: { id: report.id } })
    res.json({ data: { success: true }, error: null })
  })
)

export default router

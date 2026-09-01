import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { createDsirSchema, saveDsirSchema } from '@otomate/shared'
import { prisma } from '../../prisma/client'
import { requirePermission } from '../../middleware/auth'
import { asyncHandler } from '../../middleware/async-handler'
import { HttpError } from '../../middleware/error-handler'
import { firstIssue, pathParam } from '../../lib/http'
import { dsirInclude, toDsirDto, toDsirSummary, type InboundTransfer } from '../../lib/serializers'

const router = Router()

/** How far back to look for the products a branch actually carries. */
const PREFILL_LOOKBACK_REPORTS = 7

/** Matches the serializers: a DATE column rendered as YYYY-MM-DD, anchored UTC. */
function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function parseDate(value: string): Date {
  // Stored as a DATE; anchor at UTC midnight so no timezone can shift the day.
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, 'Invalid date', 'VALIDATION_ERROR')
  }
  return date
}

/**
 * Brings a draft's carried openings up to date with its predecessor.
 *
 * Corrections flow forward while a day is still in progress, and stop at
 * finalised ones: recomputing those would rewrite the derived sales of every
 * later day from a single edit, and finalised figures may already have been
 * acted on for payroll.
 *
 * Persisting here rather than overriding at serialisation keeps one version of
 * the truth — the list, the totals and the entry screen all read the same
 * stored numbers.
 */
async function refreshCarriedOpenings<T extends { id: string; status: string; branchId: string; reportDate: Date; lines: { productId: string; begBal: number; begBalRecounted: boolean }[] }>(
  report: T
): Promise<boolean> {
  if (report.status !== 'DRAFT') return false

  const carry = await carriedOpening(report.branchId, report.reportDate)
  const stale = report.lines.filter(
    l => !l.begBalRecounted && l.begBal !== (carry.balances.get(l.productId) ?? 0)
  )
  if (stale.length === 0) return false

  await prisma.$transaction(
    stale.map(l =>
      prisma.dsirLine.updateMany({
        where: { reportId: report.id, productId: l.productId },
        data: { begBal: carry.balances.get(l.productId) ?? 0 },
      })
    )
  )
  return true
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
/**
 * What a branch received on a date, read live from the senders' reports.
 *
 * Correct for a DRAFT: the sender may still be typing, and both sides should see
 * the same current picture. Wrong for a finalised report, which is what
 * `inboundFor` below exists to handle.
 */
async function loadLiveInbound(branchId: string, reportDate: Date) {
  return prisma.dsirTransfer.findMany({
    where: { toBranchId: branchId, report: { reportDate } },
    include: { product: true, report: { include: { branch: true } } },
  })
}

/**
 * What a report received — frozen if it is finalised, live if it is not.
 *
 * A finalised report reads its snapshot, so editing a sender can no longer move
 * a closed report's sales. A draft reads live, because it is still being worked
 * on and should see current reality.
 *
 * The fallback to live for a FINALIZED report with no snapshot exists for the
 * window between deploying this and the migration's backfill running, and for a
 * report finalised by an older build. It is the previous behaviour, which is
 * wrong but is what those reports have always shown — better than silently
 * reading zero and rewriting their sales to something nobody has seen.
 */
async function inboundFor(report: { id: string; branchId: string; reportDate: Date; status: string }) {
  if (report.status !== 'FINALIZED') return loadLiveInbound(report.branchId, report.reportDate)

  const frozen = await prisma.dsirInboundSnapshot.findMany({
    where: { reportId: report.id },
    include: { product: true, fromBranch: true },
  })
  if (frozen.length === 0) return loadLiveInbound(report.branchId, report.reportDate)

  // Shaped like the live rows so the serializer cannot tell them apart.
  return frozen.map(f => ({
    id: f.id,
    productId: f.productId,
    product: { name: f.product.name },
    quantity: f.quantity,
    report: { branchId: f.fromBranchId, branch: { name: f.fromBranch.name } },
  }))
}

/**
 * Copies the current inbound rows onto the report being finalised.
 *
 * Replaces rather than adds: finalise, reopen, edit, finalise again must end
 * with what is true at the second finalisation, not both sets.
 */
async function freezeInbound(report: { id: string; branchId: string; reportDate: Date }): Promise<void> {
  const live = await loadLiveInbound(report.branchId, report.reportDate)
  await prisma.$transaction([
    prisma.dsirInboundSnapshot.deleteMany({ where: { reportId: report.id } }),
    prisma.dsirInboundSnapshot.createMany({
      data: live.map(t => ({
        reportId: report.id,
        productId: t.productId,
        fromBranchId: t.report.branch.id,
        quantity: t.quantity,
      })),
    }),
  ])
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

export interface CarriedOpening {
  /** productId -> the ending balance being carried forward. */
  balances: Map<string, number>
  /** Which report it came from, so the screen can say where the figure is from. */
  fromDate: string | null
}

/**
 * The opening figures a branch inherits: the ending balances of its most recent
 * FINALISED report before this date.
 *
 * Finalised only, and "most recent" rather than strictly yesterday. Branches
 * close, and forms reach the office days late (docs/DOMAIN.md), so insisting on
 * the previous calendar day would leave openings blank whenever a day was
 * skipped — and carrying from a draft means the figure can move while that
 * earlier day is still being worked on.
 */
export async function carriedOpening(branchId: string, reportDate: Date): Promise<CarriedOpening> {
  const previous = await prisma.dsirReport.findFirst({
    where: { branchId, status: 'FINALIZED', reportDate: { lt: reportDate } },
    orderBy: { reportDate: 'desc' },
    include: { lines: { select: { productId: true, endBal: true } } },
  })

  if (!previous) return { balances: new Map(), fromDate: null }

  return {
    // Zero is a real value: a product that sold out closes at 0 and legitimately
    // opens at 0. Absent from the map means the product was not on that report.
    balances: new Map(previous.lines.map(l => [l.productId, l.endBal])),
    fromDate: toDateString(previous.reportDate),
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

  // Openings come from the previous FINALISED report, not merely the previous
  // one: an opening carried from a draft can move while that earlier day is
  // still being encoded. The 7-report lookback above is a separate question —
  // which products this branch carries — and still spans drafts, because a
  // product appearing on an unfinished day is still a product it stocks.
  const { balances: closingBalance } = await carriedOpening(branchId, reportDate)

  const productIds = [
    ...new Set([...history.flatMap(r => r.lines.map(l => l.productId)), ...inboundProductIds]),
  ]
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, priceCents: true, sortOrder: true, name: true },
  })
  products.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))

  return products.map((p, index) => ({
    position: index,
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
    // Finalised rows must use their frozen figures here too, or the list and the
    // report itself disagree about the same day's sales — and the list is where
    // a variance is noticed.
    const snapshots = await prisma.dsirInboundSnapshot.findMany({
      where: { reportId: { in: reports.filter(r => r.status === 'FINALIZED').map(r => r.id) } },
      include: { product: true, fromBranch: true },
    })
    const frozenByReport = new Map<string, InboundTransfer[]>()
    for (const f of snapshots) {
      const rows = frozenByReport.get(f.reportId) ?? []
      rows.push({
        id: f.id,
        productId: f.productId,
        product: { name: f.product.name },
        quantity: f.quantity,
        report: { branchId: f.fromBranchId, branch: { name: f.fromBranch.name } },
      })
      frozenByReport.set(f.reportId, rows)
    }

    const inboundByReport = new Map<string, InboundTransfer[]>()
    for (const r of reports) {
      const frozen = frozenByReport.get(r.id)
      inboundByReport.set(
        r.id,
        // Same fallback as inboundFor: a finalised report with no snapshot keeps
        // reading live, which is what it has always shown.
        frozen && frozen.length > 0
          ? frozen
          : inboundRows.filter(
              t => t.toBranchId === r.branchId && t.report.reportDate.getTime() === r.reportDate.getTime()
            )
      )
    }
    res.json({ data: reports.map(r => toDsirSummary(r, inboundByReport.get(r.id) ?? [])), error: null })
  })
)

/**
 * Archive landing: one row per branch, counting only FINALISED reports.
 *
 * Declared before '/:id' on purpose — Express matches in order, and '/archive'
 * would otherwise be swallowed as a report id.
 */
router.get(
  '/archive',
  requirePermission('dsir:read'),
  asyncHandler(async (_req, res) => {
    const [branches, grouped] = await Promise.all([
      prisma.branch.findMany({ orderBy: { name: 'asc' } }),
      prisma.dsirReport.groupBy({
        by: ['branchId'],
        where: { status: 'FINALIZED' },
        _count: { _all: true },
        _min: { reportDate: true },
        _max: { reportDate: true },
      }),
    ])

    const byBranch = new Map(grouped.map(g => [g.branchId, g]))
    const data = branches.map(b => {
      const g = byBranch.get(b.id)
      return {
        branch: { id: b.id, name: b.name },
        finalizedCount: g?._count._all ?? 0,
        earliestDate: g?._min.reportDate ? toDateString(g._min.reportDate) : null,
        latestDate: g?._max.reportDate ? toDateString(g._max.reportDate) : null,
      }
    })
    res.json({ data, error: null })
  })
)

/**
 * Which months this branch actually has finalised reports in, so the archive's
 * month picker only offers months with something in them.
 *
 * Grouped in JS rather than SQL: Prisma cannot group by a derived month without
 * raw SQL, and selecting just the date column is a few KB even after years of
 * daily reports.
 */
router.get(
  '/archive/:branchId/months',
  requirePermission('dsir:read'),
  asyncHandler(async (req, res) => {
    const branchId = pathParam(req, 'branchId')
    const rows = await prisma.dsirReport.findMany({
      where: { branchId, status: 'FINALIZED' },
      select: { reportDate: true },
      orderBy: { reportDate: 'desc' },
    })

    const counts = new Map<string, number>()
    for (const r of rows) {
      const month = toDateString(r.reportDate).slice(0, 7)
      counts.set(month, (counts.get(month) ?? 0) + 1)
    }
    const data = [...counts.entries()]
      .map(([month, count]) => ({ month, count }))
      .sort((a, b) => b.month.localeCompare(a.month))

    res.json({ data, error: null })
  })
)

router.get(
  '/:id',
  requirePermission('dsir:read'),
  asyncHandler(async (req, res) => {
    const loaded = await loadOr404(pathParam(req, 'id'))
    // Opening a draft is the moment its carried openings are brought up to
    // date, so a correction to the previous day is already applied by the time
    // anyone starts typing.
    const changed = await refreshCarriedOpenings(loaded)
    const report = changed ? await loadOr404(loaded.id) : loaded

    const inbound = await inboundFor(report)
    const carried = await carriedOpening(report.branchId, report.reportDate)
    res.json({ data: toDsirDto(report, inbound, carried), error: null })
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
      data: toDsirDto(report, await inboundFor(report), await carriedOpening(branch.id, reportDate)),
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

    // The opening lock lives here, not just in the UI: unless a line is flagged
    // as the opener's own recount, its opening IS the carried figure and
    // whatever the client submitted for it is ignored.
    const carry = await carriedOpening(report.branchId, report.reportDate)
    const openingFor = (l: { productId: string; begBal: number; begBalRecounted?: boolean }) =>
      l.begBalRecounted ? l.begBal : (carry.balances.get(l.productId) ?? 0)

    await prisma.$transaction([
      prisma.dsirLine.deleteMany({ where: { reportId: report.id } }),
      prisma.dsirCharge.deleteMany({ where: { reportId: report.id } }),
      prisma.dsirTransfer.deleteMany({ where: { reportId: report.id } }),
      prisma.dsirCollection.deleteMany({ where: { reportId: report.id } }),
      prisma.dsirLine.createMany({
        data: input.lines.map((l, index) => ({
          reportId: report.id,
          productId: l.productId,
          // The client sends lines in the order they appear on screen.
          position: index,
          unitPriceCents: existingPrice.get(l.productId) ?? currentPrice.get(l.productId) ?? 0,
          begBal: openingFor(l),
          begBalRecounted: l.begBalRecounted ?? false,
          enteredAs: l.enteredAs ?? Prisma.DbNull,
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
    res.json({ data: toDsirDto(saved, await inboundFor(saved), await carriedOpening(saved.branchId, saved.reportDate)), error: null })
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
    // Freeze against the latest carry: from here the openings stop tracking the
    // previous day, so they must be current at the moment they stop moving.
    await refreshCarriedOpenings(report)
    // Freeze what was received, for the same reason the openings are frozen:
    // from here the figures stop tracking other reports.
    await freezeInbound(report)
    await prisma.dsirReport.update({
      where: { id: report.id },
      data: { status: 'FINALIZED', finalizedAt: new Date() },
    })
    const saved = await loadOr404(report.id)
    res.json({ data: toDsirDto(saved, await inboundFor(saved), await carriedOpening(saved.branchId, saved.reportDate)), error: null })
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
    // Hygiene, not correctness: `inboundFor` already reads live for a DRAFT, and
    // `freezeInbound` replaces these rows at the next finalisation, so removing
    // them changes no figure — a mutation test confirmed nothing fails without
    // it. Kept because leaving rows that describe a state the report is no longer
    // in is exactly the kind of stale data this whole change exists to stop.
    await prisma.dsirInboundSnapshot.deleteMany({ where: { reportId: report.id } })
    await prisma.dsirReport.update({
      where: { id: report.id },
      data: { status: 'DRAFT', finalizedAt: null },
    })
    const saved = await loadOr404(report.id)
    res.json({ data: toDsirDto(saved, await inboundFor(saved), await carriedOpening(saved.branchId, saved.reportDate)), error: null })
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

    // Keeps a closed report's record readable, rather than its figures correct.
    //
    // This guard predates the inbound snapshot. Its original reason — that
    // deleting the sender would move the receiver's sales — no longer holds: a
    // finalised report reads frozen quantities and does not move. The figures
    // are safe without this.
    //
    // It stays for a different reason. A finalised report says "received 20
    // Pandesal from Branch A", and that claim should be checkable. Deleting
    // Branch A's report for that date leaves the receiver asserting a movement
    // with no counterpart anywhere in the system — the closed report still adds
    // up, but nobody can ever verify it again.
    //
    // Reopening the receiver first is still the way through, and it now does
    // something meaningful: it un-freezes the receiver, so whoever owns that
    // report sees the change rather than inheriting it silently.
    const closedReceivers = report.transfers.length
      ? await prisma.dsirReport.findMany({
          where: {
            reportDate: report.reportDate,
            status: 'FINALIZED',
            branchId: { in: [...new Set(report.transfers.map(t => t.toBranchId))] },
          },
          include: { branch: true },
        })
      : []

    if (closedReceivers.length > 0) {
      const names = closedReceivers.map(r => r.branch.name).join(', ')
      throw new HttpError(
        409,
        `This draft sends stock to ${names}, whose report for ${toDateString(report.reportDate)} is already finalised. ` +
          `That report records stock received from this one, so deleting it would leave a claim ` +
          `nobody can check. Reopen ${closedReceivers.length === 1 ? 'it' : 'them'} first, ` +
          `or remove the transfers from this draft.`,
        'RECEIVER_FINALIZED'
      )
    }

    await prisma.dsirReport.delete({ where: { id: report.id } })
    res.json({ data: { success: true }, error: null })
  })
)

export default router

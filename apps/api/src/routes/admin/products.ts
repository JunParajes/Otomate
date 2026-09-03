import { Router } from 'express'
import multer from 'multer'
import { createProductSchema, updateProductSchema } from '@otomate/shared'
import { prisma } from '../../prisma/client'
import { requirePermission } from '../../middleware/auth'
import { asyncHandler } from '../../middleware/async-handler'
import { HttpError } from '../../middleware/error-handler'
import { firstIssue, pathParam } from '../../lib/http'
import { toProductDto } from '../../lib/serializers'
import { MAX_UPLOAD_BYTES, deleteProductImage, saveProductImage } from '../../lib/images'
import { rethrowUniqueViolation } from './guards'

const router = Router()
const withCategory = { category: true } as const

/** Buffered in memory: sharp re-encodes it, so nothing untrusted hits the disk. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      cb(new HttpError(400, 'That file is not an image', 'INVALID_FILE'))
      return
    }
    cb(null, true)
  },
})

const canSeeCost = (req: { auth?: { isSuperAdmin: boolean; permissions: string[] } }): boolean =>
  Boolean(req.auth?.isSuperAdmin) || Boolean(req.auth?.permissions.includes('products:cost'))

/** Strips costCents from writes when the caller may not set it. */
function guardCost<T extends { costCents?: number | null }>(data: T, allowed: boolean): T {
  if (!allowed && data.costCents !== undefined) {
    throw new HttpError(403, 'You do not have permission to set cost price', 'FORBIDDEN')
  }
  return data
}

router.get(
  '/',
  requirePermission('products:read'),
  asyncHandler(async (req, res) => {
    const products = await prisma.product.findMany({
      include: withCategory,
      orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    })
    res.json({ data: products.map(p => toProductDto(p, canSeeCost(req))), error: null })
  })
)

router.get(
  '/:id',
  requirePermission('products:read'),
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findUnique({
      where: { id: pathParam(req, 'id') },
      include: withCategory,
    })
    if (!product) throw new HttpError(404, 'Product not found', 'NOT_FOUND')
    res.json({ data: toProductDto(product, canSeeCost(req)), error: null })
  })
)

router.post(
  '/',
  requirePermission('products:write'),
  asyncHandler(async (req, res) => {
    const parsed = createProductSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed.error), 'VALIDATION_ERROR')
    const data = guardCost(parsed.data, canSeeCost(req))

    const category = await prisma.category.findUnique({ where: { id: data.categoryId } })
    if (!category) throw new HttpError(400, 'Selected category does not exist', 'VALIDATION_ERROR')

    try {
      const product = await prisma.product.create({
        data: {
          ...data,
          sku: data.sku?.trim() ? data.sku.trim() : null,
          description: data.description ?? null,
          costCents: data.costCents ?? null,
        },
        include: withCategory,
      })
      res.status(201).json({ data: toProductDto(product, canSeeCost(req)), error: null })
    } catch (error) {
      rethrowUniqueViolation(error, ['sku', 'A product with that code already exists'])
    }
  })
)

router.patch(
  '/:id',
  requirePermission('products:write'),
  asyncHandler(async (req, res) => {
    const parsed = updateProductSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed.error), 'VALIDATION_ERROR')
    const data = guardCost(parsed.data, canSeeCost(req))

    const existing = await prisma.product.findUnique({ where: { id: pathParam(req, 'id') } })
    if (!existing) throw new HttpError(404, 'Product not found', 'NOT_FOUND')

    if (data.categoryId) {
      const category = await prisma.category.findUnique({ where: { id: data.categoryId } })
      if (!category) throw new HttpError(400, 'Selected category does not exist', 'VALIDATION_ERROR')
    }

    try {
      const product = await prisma.product.update({
        where: { id: existing.id },
        data: {
          ...data,
          ...(data.sku !== undefined && { sku: data.sku?.trim() ? data.sku.trim() : null }),
        },
        include: withCategory,
      })
      res.json({ data: toProductDto(product, canSeeCost(req)), error: null })
    } catch (error) {
      rethrowUniqueViolation(error, ['sku', 'A product with that code already exists'])
    }
  })
)

/** Deactivate, never destroy — future order lines will reference this row. */
router.delete(
  '/:id',
  requirePermission('products:write'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.product.findUnique({ where: { id: pathParam(req, 'id') } })
    if (!existing) throw new HttpError(404, 'Product not found', 'NOT_FOUND')

    const product = await prisma.product.update({
      where: { id: existing.id },
      data: { isActive: false },
      include: withCategory,
    })
    res.json({ data: toProductDto(product, canSeeCost(req)), error: null })
  })
)

router.post(
  '/:id/image',
  requirePermission('products:write'),
  upload.single('image'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'No image was uploaded', 'VALIDATION_ERROR')

    const existing = await prisma.product.findUnique({ where: { id: pathParam(req, 'id') } })
    if (!existing) throw new HttpError(404, 'Product not found', 'NOT_FOUND')

    let filename: string
    try {
      filename = await saveProductImage(req.file.buffer)
    } catch {
      // sharp throws on anything it can't decode — a renamed .exe lands here.
      throw new HttpError(400, 'That file could not be read as an image', 'INVALID_FILE')
    }

    const product = await prisma.product.update({
      where: { id: existing.id },
      data: { imageFile: filename },
      include: withCategory,
    })
    // Only remove the old file once the new one is recorded.
    await deleteProductImage(existing.imageFile)

    res.json({ data: toProductDto(product, canSeeCost(req)), error: null })
  })
)

router.delete(
  '/:id/image',
  requirePermission('products:write'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.product.findUnique({ where: { id: pathParam(req, 'id') } })
    if (!existing) throw new HttpError(404, 'Product not found', 'NOT_FOUND')

    const product = await prisma.product.update({
      where: { id: existing.id },
      data: { imageFile: null },
      include: withCategory,
    })
    await deleteProductImage(existing.imageFile)

    res.json({ data: toProductDto(product, canSeeCost(req)), error: null })
  })
)

export default router

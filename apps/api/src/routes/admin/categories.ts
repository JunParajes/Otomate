import { Router } from 'express'
import { createCategorySchema, updateCategorySchema } from '@otomate/shared'
import { prisma } from '../../prisma/client'
import { requirePermission } from '../../middleware/auth'
import { asyncHandler } from '../../middleware/async-handler'
import { HttpError } from '../../middleware/error-handler'
import { firstIssue, pathParam } from '../../lib/http'
import { toCategoryDto } from '../../lib/serializers'
import { rethrowUniqueViolation } from './guards'

const router = Router()

router.get(
  '/',
  requirePermission('products:read'),
  asyncHandler(async (_req, res) => {
    const categories = await prisma.category.findMany({
      include: { _count: { select: { products: true } } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    })
    res.json({
      data: categories.map(c => ({ ...toCategoryDto(c), productCount: c._count.products })),
      error: null,
    })
  })
)

router.post(
  '/',
  requirePermission('categories:write'),
  asyncHandler(async (req, res) => {
    const parsed = createCategorySchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed.error), 'VALIDATION_ERROR')
    try {
      const category = await prisma.category.create({
        data: { ...parsed.data, description: parsed.data.description ?? null },
      })
      res.status(201).json({ data: { ...toCategoryDto(category), productCount: 0 }, error: null })
    } catch (error) {
      rethrowUniqueViolation(error, 'name', 'A category with that name already exists')
    }
  })
)

router.patch(
  '/:id',
  requirePermission('categories:write'),
  asyncHandler(async (req, res) => {
    const parsed = updateCategorySchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed.error), 'VALIDATION_ERROR')

    const existing = await prisma.category.findUnique({ where: { id: pathParam(req, 'id') } })
    if (!existing) throw new HttpError(404, 'Category not found', 'NOT_FOUND')

    try {
      const category = await prisma.category.update({
        where: { id: existing.id },
        data: parsed.data,
        include: { _count: { select: { products: true } } },
      })
      res.json({ data: { ...toCategoryDto(category), productCount: category._count.products }, error: null })
    } catch (error) {
      rethrowUniqueViolation(error, 'name', 'A category with that name already exists')
    }
  })
)

/**
 * Product.categoryId is ON DELETE RESTRICT, so a bare delete surfaces a raw FK
 * error. Refuse with a count instead, and point at deactivation.
 */
router.delete(
  '/:id',
  requirePermission('categories:write'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.category.findUnique({
      where: { id: pathParam(req, 'id') },
      include: { _count: { select: { products: true } } },
    })
    if (!existing) throw new HttpError(404, 'Category not found', 'NOT_FOUND')

    if (existing._count.products > 0) {
      throw new HttpError(
        409,
        `${existing._count.products} product(s) are still in this category. Move them first, or deactivate the category instead.`,
        'CATEGORY_IN_USE'
      )
    }

    await prisma.category.delete({ where: { id: existing.id } })
    res.json({ data: { success: true }, error: null })
  })
)

export default router

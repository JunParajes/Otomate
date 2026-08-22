import { Router } from 'express'
import { authenticate } from '../../middleware/auth'
import usersRouter from './users'
import rolesRouter from './roles'
import branchesRouter from './branches'
import permissionsRouter from './permissions'
import categoriesRouter from './categories'
import productsRouter from './products'
import employeesRouter from './employees'
import dsirRouter from './dsir'

const router = Router()

// Everything under /api/admin requires a valid session; individual routes then
// gate on specific permissions (which Super Admin bypasses).
router.use(authenticate)
router.use('/users', usersRouter)
router.use('/roles', rolesRouter)
router.use('/branches', branchesRouter)
router.use('/permissions', permissionsRouter)
router.use('/categories', categoriesRouter)
router.use('/products', productsRouter)
router.use('/employees', employeesRouter)
router.use('/dsir', dsirRouter)

export default router

import { Router } from 'express'
import { authenticate } from '../../middleware/auth'
import usersRouter from './users'
import rolesRouter from './roles'
import branchesRouter from './branches'
import permissionsRouter from './permissions'

const router = Router()

// Everything under /api/admin requires a valid session; individual routes then
// gate on specific permissions (which Super Admin bypasses).
router.use(authenticate)
router.use('/users', usersRouter)
router.use('/roles', rolesRouter)
router.use('/branches', branchesRouter)
router.use('/permissions', permissionsRouter)

export default router

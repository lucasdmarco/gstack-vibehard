import { Router } from 'express'
import healthRoutes from './health'
import userRoutes from './users'

const router = Router()

router.use(healthRoutes)
router.use('/users', userRoutes)

export default router

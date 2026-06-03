import { Router } from 'express'
import { success } from '../lib/response'

const router = Router()

router.get('/health', (_req, res) => {
  success(res, {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  })
})

router.get('/health/ready', (_req, res) => {
  success(res, { ready: true })
})

export default router

import { Hono } from 'hono'

export const healthRoutes = new Hono()

healthRoutes.get('/health', (c) => {
  return c.json({
    success: true,
    data: { status: 'ok', timestamp: new Date().toISOString() },
  })
})

healthRoutes.get('/health/ready', (c) => {
  return c.json({ success: true, data: { ready: true } })
})

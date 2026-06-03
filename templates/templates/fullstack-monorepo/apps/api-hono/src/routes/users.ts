import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { db } from '@my/db-turso'
import { users } from '@my/db-turso/schema'
import { eq, like, count } from 'drizzle-orm'

export const userRoutes = new Hono()

const createUserSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email(),
  avatarUrl: z.string().optional(),
})

const querySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
})

userRoutes.get('/', zValidator('query', querySchema), async (c) => {
  const { page, limit: lim, search } = c.req.valid('query')
  const offset = (page - 1) * lim
  const where = search ? like(users.email, `%${search}%`) : undefined
  const [total] = await db.select({ count: count() }).from(users).where(where)
  const data = await db.select().from(users).where(where).limit(lim).offset(offset)
  return c.json({
    success: true,
    data,
    meta: { total: total.count, page, limit: lim, totalPages: Math.ceil(total.count / lim) },
  })
})

userRoutes.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1)
  if (!user) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } }, 404)
  return c.json({ success: true, data: user })
})

userRoutes.post('/', zValidator('json', createUserSchema), async (c) => {
  const body = c.req.valid('json')
  try {
    const [user] = await db.insert(users).values(body as any).returning()
    return c.json({ success: true, data: user }, 201)
  } catch (err: any) {
    if (err?.message?.includes('UNIQUE')) {
      return c.json({ success: false, error: { code: 'CONFLICT', message: 'Email already exists' } }, 409)
    }
    throw err
  }
})

userRoutes.put('/:id', zValidator('json', createUserSchema.partial()), async (c) => {
  const id = c.req.param('id')
  const body = c.req.valid('json')
  const [user] = await db.update(users).set(body as any).where(eq(users.id, id)).returning()
  if (!user) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } }, 404)
  return c.json({ success: true, data: user })
})

userRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const [user] = await db.delete(users).where(eq(users.id, id)).returning()
  if (!user) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } }, 404)
  return c.json({ success: true, data: { deleted: true } })
})

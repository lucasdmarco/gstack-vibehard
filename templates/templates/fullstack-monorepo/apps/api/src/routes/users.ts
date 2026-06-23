import { Router } from 'express'
import { z } from 'zod'
import { validate } from '../middleware/validate'
import { AppError } from '../middleware/error'
import { success, created, paginated } from '../lib/response'
import { db } from '@my/db'
import { users } from '@my/db/schema'
import { eq, like, count } from 'drizzle-orm'

const router = Router()

const createUserSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email(),
  avatarUrl: z.string().url().optional(),
})

const updateUserSchema = createUserSchema.partial()

const querySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
})

router.get('/', validate({ query: querySchema }), async (req, res, next) => {
  try {
    const { page, limit: limitVal, search } = req.query as unknown as z.infer<typeof querySchema>
    const offset = (page - 1) * limitVal

    const where = search ? like(users.email, `%${search}%`) : undefined
    const [total] = await db.select({ count: count() }).from(users).where(where)
    const data = await db.select().from(users).where(where).limit(limitVal).offset(offset)

    paginated(res, data, total.count, page, limitVal)
  } catch (err) {
    next(err)
  }
})

router.get('/:id', async (req, res, next) => {
  try {
    const user = await db.select().from(users).where(eq(users.id, req.params.id as string)).limit(1)
    if (!user.length) throw AppError.notFound('User not found')
    success(res, user[0])
  } catch (err) {
    next(err)
  }
})

router.post('/', validate({ body: createUserSchema }), async (req, res, next) => {
  try {
    const [user] = await db.insert(users).values(req.body as any).returning()
    created(res, user)
  } catch (err: any) {
    if (err?.code === '23505') {
      next(AppError.conflict('Email already exists'))
    } else {
      next(err)
    }
  }
})

router.put('/:id', validate({ body: updateUserSchema }), async (req, res, next) => {
  try {
    const [user] = await db.update(users)
      .set(req.body as any)
      .where(eq(users.id, req.params.id as string))
      .returning()
    if (!user) throw AppError.notFound('User not found')
    success(res, user)
  } catch (err) {
    next(err)
  }
})

router.delete('/:id', async (req, res, next) => {
  try {
    const [user] = await db.delete(users).where(eq(users.id, req.params.id as string)).returning()
    if (!user) throw AppError.notFound('User not found')
    success(res, { deleted: true })
  } catch (err) {
    next(err)
  }
})

export default router

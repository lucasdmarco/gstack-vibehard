import { FastifyPluginAsync } from 'fastify'
import { db } from '@my/db'
import { users } from '@my/db/schema'
import { eq, like, count } from 'drizzle-orm'

export const userRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', {
    schema: {
      tags: ['Users'],
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', default: 1 },
          limit: { type: 'integer', default: 20 },
          search: { type: 'string' },
        },
      },
    },
  }, async (req) => {
    const { page = 1, limit: lim = 20, search } = req.query as any
    const offset = (page - 1) * lim
    const where = search ? like(users.email, `%${search}%`) : undefined
    const [total] = await db.select({ count: count() }).from(users).where(where)
    const data = await db.select().from(users).where(where).limit(lim).offset(offset)
    return {
      success: true,
      data,
      meta: { total: total.count, page, limit: lim, totalPages: Math.ceil(total.count / lim) },
    }
  })

  app.get('/:id', {
    schema: {
      tags: ['Users'],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const { id } = req.params as any
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1)
    if (!user) { reply.status(404); return { success: false, error: { code: 'NOT_FOUND', message: 'User not found' } } }
    return { success: true, data: user }
  })

  app.post('/', {
    schema: {
      tags: ['Users'],
      body: {
        type: 'object',
        required: ['name', 'email'],
        properties: {
          name: { type: 'string' },
          email: { type: 'string' },
          avatarUrl: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    try {
      const [user] = await db.insert(users).values(req.body as any).returning()
      reply.status(201)
      return { success: true, data: user }
    } catch (err: any) {
      if (err?.code === '23505') {
        reply.status(409)
        return { success: false, error: { code: 'CONFLICT', message: 'Email already exists' } }
      }
      throw err
    }
  })

  app.put('/:id', {
    schema: {
      tags: ['Users'],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        properties: { name: { type: 'string' }, email: { type: 'string' }, avatarUrl: { type: 'string' } },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as any
    const [user] = await db.update(users).set(req.body as any).where(eq(users.id, id)).returning()
    if (!user) { reply.status(404); return { success: false, error: { code: 'NOT_FOUND', message: 'User not found' } } }
    return { success: true, data: user }
  })

  app.delete('/:id', {
    schema: {
      tags: ['Users'],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    },
  }, async (req, reply) => {
    const { id } = req.params as any
    const [user] = await db.delete(users).where(eq(users.id, id)).returning()
    if (!user) { reply.status(404); return { success: false, error: { code: 'NOT_FOUND', message: 'User not found' } } }
    return { success: true, data: { deleted: true } }
  })
}

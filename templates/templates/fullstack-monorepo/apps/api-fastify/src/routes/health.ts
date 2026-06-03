import { FastifyPluginAsync } from 'fastify'

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', {
    schema: {
      tags: ['Health'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                status: { type: 'string' },
                timestamp: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, async () => {
    return {
      success: true,
      data: { status: 'ok', timestamp: new Date().toISOString() },
    }
  })

  app.get('/health/ready', {
    schema: { tags: ['Health'] },
  }, async () => {
    return { success: true, data: { ready: true } }
  })
}

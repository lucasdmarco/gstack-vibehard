import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import { userRoutes } from './routes/users.js'
import { healthRoutes } from './routes/health.js'

const app = Fastify({ logger: true })
const port = parseInt(process.env.API_PORT || '3001', 10)

await app.register(cors, { origin: process.env.CORS_ORIGIN || false })

await app.register(swagger, {
  openapi: {
    info: { title: 'API (Fastify)', version: '1.0.0' },
    servers: [{ url: `http://localhost:${port}` }],
  },
})

await app.register(swaggerUi, { routePrefix: '/api/docs' })

await app.register(healthRoutes, { prefix: '/api' })
await app.register(userRoutes, { prefix: '/api/users' })

app.setErrorHandler((err, _req, reply) => {
  if (err.validation) {
    return reply.status(422).send({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: err.validation,
      },
    })
  }
  app.log.error(err)
  reply.status(err.statusCode ?? 500).send({
    success: false,
    error: {
      code: err.code ?? 'INTERNAL_ERROR',
      message: err.message ?? 'Internal server error',
    },
  })
})

app.listen({ port, host: '0.0.0.0' }).then(() => {
  console.log(`Fastify API running on http://localhost:${port}`)
  console.log(`Docs: http://localhost:${port}/api/docs`)
})

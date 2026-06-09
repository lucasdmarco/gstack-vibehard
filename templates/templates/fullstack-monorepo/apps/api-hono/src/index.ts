import 'dotenv/config'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { healthRoutes } from './routes/health.js'
import { userRoutes } from './routes/users.js'

const app = new Hono()
const port = parseInt(process.env.API_PORT || '3001', 10)

app.use('/*', cors({ origin: process.env.CORS_ORIGIN || false }))
app.get('/api/openapi.json', (c) => c.json(openapiSpec))

app.route('/api', healthRoutes)
app.route('/api/users', userRoutes)

app.onError((err, c) => {
  console.error(err)
  return c.json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: err.message },
  }, 500)
})

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Hono API running on http://localhost:${info.port}`)
  console.log(`OpenAPI: http://localhost:${info.port}/api/openapi.json`)
})

const openapiSpec = {
  openapi: '3.1.0',
  info: { title: 'API (Hono)', version: '1.0.0' },
  servers: [{ url: `http://localhost:${port}` }],
  paths: {
    '/api/health': {
      get: { tags: ['Health'], summary: 'Health check', responses: { '200': { description: 'OK' } } },
    },
    '/api/users': {
      get: {
        tags: ['Users'], summary: 'List users',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer' } },
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
        ],
        responses: { '200': { description: 'Users list' } },
      },
      post: {
        tags: ['Users'], summary: 'Create user',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, email: { type: 'string' }, avatarUrl: { type: 'string' } }, required: ['name', 'email'] } } },
        },
        responses: { '201': { description: 'Created' } },
      },
    },
    '/api/users/{id}': {
      get: { tags: ['Users'], summary: 'Get user', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'User' } } },
      put: { tags: ['Users'], summary: 'Update user', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Updated' } } },
      delete: { tags: ['Users'], summary: 'Delete user', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Deleted' } } },
    },
  },
}

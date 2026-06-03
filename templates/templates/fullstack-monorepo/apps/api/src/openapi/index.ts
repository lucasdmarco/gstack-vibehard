export const openapiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'API',
    version: '1.0.0',
    description: 'Fullstack monorepo API',
  },
  servers: [
    { url: 'http://localhost:3001', description: 'Development' },
  ],
  paths: {
    '/api/health': {
      get: {
        tags: ['Health'],
        summary: 'Health check',
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        status: { type: 'string' },
                        timestamp: { type: 'string' },
                        uptime: { type: 'number' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/health/ready': {
      get: {
        tags: ['Health'],
        summary: 'Readiness check',
        responses: { '200': { description: 'Ready' } },
      },
    },
    '/api/users': {
      get: {
        tags: ['Users'],
        summary: 'List users',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Paginated users list' },
        },
      },
      post: {
        tags: ['Users'],
        summary: 'Create user',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'email'],
                properties: {
                  name: { type: 'string' },
                  email: { type: 'string', format: 'email' },
                  avatarUrl: { type: 'string', format: 'uri' },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Created' },
          '409': { description: 'Conflict (email exists)' },
        },
      },
    },
    '/api/users/{id}': {
      get: {
        tags: ['Users'],
        summary: 'Get user by ID',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'User' },
          '404': { description: 'Not found' },
        },
      },
      put: {
        tags: ['Users'],
        summary: 'Update user',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  email: { type: 'string' },
                  avatarUrl: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Updated' },
          '404': { description: 'Not found' },
        },
      },
      delete: {
        tags: ['Users'],
        summary: 'Delete user',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Deleted' },
          '404': { description: 'Not found' },
        },
      },
    },
  },
}

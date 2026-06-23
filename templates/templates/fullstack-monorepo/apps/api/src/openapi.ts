export const openapiSpec = {
  openapi: '3.1.0',
  info: { title: 'API (Express)', version: '1.0.0' },
  servers: [{ url: `http://localhost:${process.env.API_PORT || 3001}` }],
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

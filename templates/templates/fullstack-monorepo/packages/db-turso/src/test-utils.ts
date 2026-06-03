import { createTestDb } from './index'
import * as schema from './schema'

let ctx: ReturnType<typeof createTestDb> | null = null

export async function setupTestDb() {
  ctx = createTestDb()
  return ctx
}

export async function teardownTestDb() {
  if (ctx) {
    for (const table of Object.values(schema)) {
      if (table && typeof table === 'object' && 'name' in table) {
        await ctx.db.delete(table as any)
      }
    }
    ctx.client.close()
    ctx = null
  }
}

export function getTestDb() {
  if (!ctx) throw new Error('Call setupTestDb() first')
  return ctx.db
}

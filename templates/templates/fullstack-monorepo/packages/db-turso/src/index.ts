import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import * as schema from './schema'

const client = createClient({ url: process.env.DATABASE_URL! })
export const db = drizzle(client, { schema })
export { schema }

export function createTestDb() {
  const testUrl = process.env.DATABASE_URL_TEST
  if (!testUrl) throw new Error('DATABASE_URL_TEST not set')
  const testClient = createClient({ url: testUrl })
  return { db: drizzle(testClient, { schema }), client: testClient }
}

import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL!
const client = postgres(connectionString)
export const db = drizzle(client, { schema })
export { schema }

export function createTestDb() {
  const testUrl = process.env.DATABASE_URL_TEST
  if (!testUrl) throw new Error('DATABASE_URL_TEST not set')
  const testClient = postgres(testUrl)
  return { db: drizzle(testClient, { schema }), client: testClient }
}

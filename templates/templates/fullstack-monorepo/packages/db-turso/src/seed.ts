import 'dotenv/config'
import { db } from './index'
import * as schema from './schema'
import { randomUUID } from 'crypto'

async function seed() {
  console.log('Seeding Turso database...')

  const [user] = await db.insert(schema.users).values({
    id: randomUUID(),
    name: 'Admin',
    email: 'admin@example.com',
    avatarUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }).returning()

  console.log(`Created user: ${user.id} (${user.email})`)
  console.log('Seed complete.')
  process.exit(0)
}

seed().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})

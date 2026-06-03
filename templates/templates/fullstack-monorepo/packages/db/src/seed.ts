import 'dotenv/config'
import { db } from './index'
import * as schema from './schema'

async function seed() {
  console.log('Seeding database...')

  const [user] = await db.insert(schema.users).values({
    name: 'Admin',
    email: 'admin@example.com',
  }).returning()

  console.log(`Created user: ${user.id} (${user.email})`)
  console.log('Seed complete.')
  process.exit(0)
}

seed().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})

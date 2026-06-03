import 'dotenv/config'
import { setupTestDb, teardownTestDb } from '@my/db/test-utils'
import { beforeAll, afterAll } from 'vitest'

beforeAll(async () => {
  await setupTestDb()
})

afterAll(async () => {
  await teardownTestDb()
})

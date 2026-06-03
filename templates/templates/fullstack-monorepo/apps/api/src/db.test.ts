import { describe, it, expect } from 'vitest'
import { getTestDb } from '@my/db/test-utils'
import { users } from '@my/db/schema'

describe('database', () => {
  it('should connect and query', async () => {
    const db = getTestDb()
    const result = await db.select().from(users)
    expect(Array.isArray(result)).toBe(true)
  })
})

import { defineConfig } from 'drizzle-kit'

const isTest = process.env.DB_ENV === 'test'
const url = isTest ? process.env.DATABASE_URL_TEST! : process.env.DATABASE_URL!

export default defineConfig({
  schema: './src/schema.ts',
  out: '../../supabase/migrations',
  dialect: 'postgresql',
  dbCredentials: { url },
})

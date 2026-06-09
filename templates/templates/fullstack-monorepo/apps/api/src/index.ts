import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import routes from './routes/index.js'
import { errorHandler, notFoundHandler } from './middleware/error.js'
import { openapiSpec } from './openapi.js'

const app = express()
const port = process.env.API_PORT || 3001

app.use(cors({ origin: process.env.CORS_ORIGIN || false }))
app.use(express.json())

app.get('/api/openapi.json', (_req, res) => {
  res.json(openapiSpec)
})

app.use('/api', routes)

app.use(notFoundHandler)
app.use(errorHandler)

app.listen(port, () => {
  console.log(`API running on http://localhost:${port}`)
  console.log(`OpenAPI: http://localhost:${port}/api/openapi.json`)
})

import express from 'express'
import cors from 'cors'
import healthRouter from './routes/health'
import authRouter from './routes/auth'
import usersRouter from './routes/users'
import { errorHandler, notFoundHandler } from './middleware/error-handler'

const app = express()
const port = process.env.API_PORT ?? 3001

app.use(cors({ origin: process.env.WEB_URL ?? '*' }))
app.use(express.json())

app.use('/health', healthRouter)
app.use('/api/auth', authRouter)
app.use('/api/users', usersRouter)

app.use(notFoundHandler)
app.use(errorHandler)

// Last-resort guards: log and keep serving rather than dying on a stray rejection.
process.on('unhandledRejection', reason => {
  console.error('[unhandledRejection]', reason)
})
process.on('uncaughtException', err => {
  console.error('[uncaughtException]', err)
})

app.listen(port, () => {
  console.log(`API running on port ${port}`)
})

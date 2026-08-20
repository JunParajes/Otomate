import express from 'express'
import cors from 'cors'
import healthRouter from './routes/health.js'
import authRouter from './routes/auth.js'
import usersRouter from './routes/users.js'

const app = express()
const port = process.env.API_PORT ?? 3001

app.use(cors({ origin: process.env.WEB_URL ?? '*' }))
app.use(express.json())

app.use('/health', healthRouter)
app.use('/api/auth', authRouter)
app.use('/api/users', usersRouter)

app.use((_req, res) => {
  res.status(404).json({ data: null, error: { message: 'Not found' } })
})

app.listen(port, () => {
  console.log(`API running on port ${port}`)
})

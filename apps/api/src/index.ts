import express from 'express'
import cors from 'cors'
import path from 'node:path'
import healthRouter from './routes/health'
import authRouter from './routes/auth'
import usersRouter from './routes/users'
import adminRouter from './routes/admin'
import { errorHandler, notFoundHandler } from './middleware/error-handler'
import { PUBLIC_PREFIX, UPLOAD_ROOT, ensureUploadDirs } from './lib/images'

const app = express()
const port = process.env.API_PORT ?? 3001

// `??` only falls back on null/undefined, so an unset-but-present WEB_URL (an
// empty string, which is what compose passes for a missing variable) would set
// origin:'' and reject every browser request. Treat blank as "not configured".
const webOrigin = process.env.WEB_URL?.trim() || '*'
app.use(cors({ origin: webOrigin }))
app.use(express.json())

// Product images are served unauthenticated: browsers do not send an
// Authorization header for <img src>, and these are photographs of bread.
// immutable is safe because filenames are content-unique (uuid.webp).
app.use(
  PUBLIC_PREFIX,
  express.static(path.join(UPLOAD_ROOT, 'products'), {
    maxAge: '30d',
    immutable: true,
    index: false,
    dotfiles: 'deny',
  })
)

app.use('/health', healthRouter)
app.use('/api/auth', authRouter)
app.use('/api/users', usersRouter)
app.use('/api/admin', adminRouter)

app.use(notFoundHandler)
app.use(errorHandler)

// Last-resort guards: log and keep serving rather than dying on a stray rejection.
process.on('unhandledRejection', reason => {
  console.error('[unhandledRejection]', reason)
})
process.on('uncaughtException', err => {
  console.error('[uncaughtException]', err)
})

ensureUploadDirs()
  .then(() => {
    app.listen(port, () => {
      console.log(`API running on port ${port}`)
    })
  })
  .catch(err => {
    console.error('[fatal] could not prepare upload directory', err)
    process.exit(1)
  })

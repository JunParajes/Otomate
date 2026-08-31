/**
 * The Express app, assembled but not started.
 *
 * Separate from index.ts so tests can mount it with supertest without opening a
 * port, installing signal handlers, or racing a second instance. index.ts owns
 * everything about *running* it: the listener, the upload directory, and the
 * graceful shutdown.
 */
import express from 'express'
import cors from 'cors'
import path from 'node:path'
import healthRouter from './routes/health'
import authRouter from './routes/auth'
import usersRouter from './routes/users'
import adminRouter from './routes/admin'
import { errorHandler, notFoundHandler } from './middleware/error-handler'
import { apiLimiter } from './middleware/rate-limit'
import { PUBLIC_PREFIX, UPLOAD_ROOT } from './lib/images'

const app = express()

// One hop: Traefik. Without this every request appears to come from the Docker
// bridge address and the whole internet shares a single rate-limit bucket.
// Deliberately `1` and not `true` — `true` trusts a client-supplied
// X-Forwarded-For outright, which would let anyone forge their way past a limit.
app.set('trust proxy', 1)

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
app.use('/api', apiLimiter)
app.use('/api/auth', authRouter)
app.use('/api/users', usersRouter)
app.use('/api/admin', adminRouter)

app.use(notFoundHandler)
app.use(errorHandler)

export default app

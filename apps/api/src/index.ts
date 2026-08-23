import express from 'express'
import cors from 'cors'
import path from 'node:path'
import healthRouter from './routes/health'
import authRouter from './routes/auth'
import usersRouter from './routes/users'
import adminRouter from './routes/admin'
import { errorHandler, notFoundHandler } from './middleware/error-handler'
import { apiLimiter } from './middleware/rate-limit'
import { PUBLIC_PREFIX, UPLOAD_ROOT, ensureUploadDirs } from './lib/images'
import { prisma } from './prisma/client'

const app = express()
const port = process.env.API_PORT ?? 3001

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

// Last-resort guards: log and keep serving rather than dying on a stray rejection.
process.on('unhandledRejection', reason => {
  console.error('[unhandledRejection]', reason)
})
process.on('uncaughtException', err => {
  console.error('[uncaughtException]', err)
})

ensureUploadDirs()
  .then(() => {
    const server = app.listen(port, () => {
      console.log(`API running on port ${port}`)
    })

    /**
     * `docker stop` sends SIGTERM, and Node's default is to exit immediately —
     * killing whatever request is mid-flight. During a rolling deploy that could
     * be a DSIR being saved, so the write is lost with no error the user can
     * act on. Stop accepting new connections, let the in-flight ones finish,
     * then close the database pool.
     *
     * This is also why the API needs no Traefik retry middleware: a retry can
     * re-send a request the server already processed, which for a save means
     * writing it twice.
     */
    let shuttingDown = false
    const shutdown = (signal: string) => {
      if (shuttingDown) return
      shuttingDown = true
      console.log(`[${signal}] draining in-flight requests...`)

      server.close(async () => {
        try {
          await prisma.$disconnect()
        } catch (err) {
          console.error('[shutdown] could not close the database pool', err)
        }
        console.log('[shutdown] done')
        process.exit(0)
      })

      // A stuck connection must not hold the deploy open forever. rollout.sh
      // stops containers with a 15s timeout, so give up before Docker does and
      // exit on our own terms.
      setTimeout(() => {
        console.error('[shutdown] forced exit — a connection did not close in time')
        process.exit(1)
      }, 10_000).unref()
    }

    process.on('SIGTERM', () => shutdown('SIGTERM'))
    process.on('SIGINT', () => shutdown('SIGINT'))
  })
  .catch(err => {
    console.error('[fatal] could not prepare upload directory', err)
    process.exit(1)
  })
